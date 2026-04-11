import http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import pino from 'pino';
import { verifyUserJwt } from './auth/verifyUserJwt.js';
import { startLiveConnection, buildInitialConfigMessage } from './gemini/liveUpstream.js';
import {
  parseClientMessage,
  shouldPassthroughToGemini,
  handleClientControlMessage,
} from './session/voiceBridge.js';
import { DEFAULT_BUSINESS_VOICE_SYSTEM_PROMPT } from './session/businessVoicePrompt.js';

export type VoiceGatewayEnv = {
  port: number;
  geminiApiKey: string;
  geminiLiveModel: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  logLevel: string;
};

const LISTEN_HOST = '0.0.0.0';
const VOICE_WS_PATH = '/voice';

function rawToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  const view = data as ArrayBufferView;
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('utf8');
}

function safeCloseClient(ws: WebSocket, code: number, reason: string) {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.close(code, reason);
  } catch {
    /* ignore */
  }
}

export function createVoiceGatewayServer(env: VoiceGatewayEnv) {
  const log = pino({ level: env.logLevel });

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'walletx-voice-gateway' }));
  });

  const wss = new WebSocketServer({
    server,
    path: VOICE_WS_PATH,
  });

  wss.on('connection', (clientWs: WebSocket, request: http.IncomingMessage) => {
    void (async () => {
      try {
        await handleVoiceConnection(clientWs, request, env, log);
      } catch (err) {
        log.error({ err }, 'voice connection handler failed');
        safeCloseClient(clientWs, 1011, 'internal_error');
      }
    })();
  });

  return {
    server,
    log,
    listen: () => server.listen(env.port, LISTEN_HOST),
  };
}

async function handleVoiceConnection(
  clientWs: WebSocket,
  request: http.IncomingMessage,
  env: VoiceGatewayEnv,
  log: pino.Logger
) {
  const host = request.headers.host ?? 'localhost';
  const url = new URL(request.url ?? VOICE_WS_PATH, `http://${host}`);
  const token = url.searchParams.get('token')?.trim() ?? '';

  const authRequired = Boolean(env.supabaseUrl && env.supabaseAnonKey);
  if (authRequired) {
    if (!token) {
      log.warn('reject: missing token');
      safeCloseClient(clientWs, 4401, 'missing_token');
      return;
    }
    const auth = await verifyUserJwt(env.supabaseUrl, env.supabaseAnonKey, token);
    if (!auth) {
      log.warn('reject: invalid token');
      safeCloseClient(clientWs, 4401, 'invalid_token');
      return;
    }
  }

  const sendToClient = (json: object) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(json));
    }
  };

  let metaHint = '';
  let upstream: WebSocket | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let configSent = false;
  const pendingOutbound: string[] = [];

  const cleanup = (reason: string) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    try {
      upstream?.close();
    } catch {
      /* ignore */
    }
    upstream = null;
    try {
      clientWs.close();
    } catch {
      /* ignore */
    }
    log.info({ reason }, 'voice session ended');
  };

  function buildSystemText(): string {
    if (!metaHint.trim()) return DEFAULT_BUSINESS_VOICE_SYSTEM_PROMPT;
    return `${DEFAULT_BUSINESS_VOICE_SYSTEM_PROMPT}\n\nSession context: ${metaHint}`;
  }

  function openUpstream() {
    if (upstream || configSent) return;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    let u: WebSocket;
    try {
      u = startLiveConnection({ apiKey: env.geminiApiKey });
    } catch (err) {
      log.error({ err }, 'gemini startLiveConnection failed');
      sendToClient({
        type: 'gateway.error',
        code: 'gemini_connect_failed',
        message: err instanceof Error ? err.message : 'gemini_connect_failed',
      });
      safeCloseClient(clientWs, 1011, 'gemini_connect_failed');
      return;
    }

    upstream = u;

    u.on('open', () => {
      try {
        const setupPayload = buildInitialConfigMessage({
          modelId: env.geminiLiveModel,
          systemInstructionText: buildSystemText(),
        });
        u.send(setupPayload);
        configSent = true;
        sendToClient({
          type: 'gateway.ready',
          model: env.geminiLiveModel,
          responseModalities: ['AUDIO'],
        });
        log.info('gemini upstream open, config sent');
        while (pendingOutbound.length > 0 && u.readyState === u.OPEN) {
          const line = pendingOutbound.shift();
          if (line) u.send(line);
        }
      } catch (err) {
        log.error({ err }, 'gemini handshake / config send failed');
        sendToClient({
          type: 'gateway.error',
          code: 'gemini_setup_failed',
          message: err instanceof Error ? err.message : 'gemini_setup_failed',
        });
        safeCloseClient(clientWs, 1011, 'gemini_setup_failed');
      }
    });

    u.on('error', (err) => {
      log.error({ err }, 'gemini upstream error');
      sendToClient({
        type: 'gateway.error',
        code: 'upstream_error',
        message: err instanceof Error ? err.message : 'upstream_error',
      });
      safeCloseClient(clientWs, 1011, 'upstream_error');
    });

    /** `ws` uses `message`; browser WebSocket uses `data` — same binary/text payloads. */
    u.on('message', (data) => {
      const text = rawToString(data);
      try {
        const payload = JSON.parse(text) as Record<string, unknown>;
        sendToClient({ type: 'gemini', payload });
      } catch {
        log.warn({ preview: text.slice(0, 200) }, 'upstream non-json frame');
        sendToClient({
          type: 'gateway.error',
          code: 'upstream_non_json',
          message: 'Gemini sent a non-JSON frame',
        });
        safeCloseClient(clientWs, 1011, 'upstream_non_json');
      }
    });

    u.on('close', (code, reasonBuf) => {
      const reasonStr = reasonBuf instanceof Buffer ? reasonBuf.toString('utf8') : String(reasonBuf ?? '');
      if (clientWs.readyState !== WebSocket.OPEN) return;
      const clean = code === 1000 || code === 1001;
      if (clean) {
        try {
          clientWs.close(1000, 'upstream_closed');
        } catch {
          /* ignore */
        }
        return;
      }
      log.warn({ code, reason: reasonStr }, 'gemini upstream closed abnormally');
      safeCloseClient(clientWs, 1011, 'upstream_abnormal');
    });
  }

  function enqueueToGemini(obj: Record<string, unknown>) {
    const line = JSON.stringify(obj);
    const up = upstream;
    if (up && up.readyState === WebSocket.OPEN) {
      up.send(line);
      return;
    }
    pendingOutbound.push(line);
    openUpstream();
  }

  function scheduleDebouncedOpen() {
    if (upstream || configSent) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => openUpstream(), 350);
  }

  scheduleDebouncedOpen();

  clientWs.on('message', (data) => {
    const text = rawToString(data);
    const parsed = parseClientMessage(text);
    if (!parsed || typeof parsed !== 'object') {
      log.warn({ text: text.slice(0, 200) }, 'invalid client json');
      return;
    }
    const obj = parsed as Record<string, unknown>;

    if (handleClientControlMessage(obj, sendToClient)) {
      if (obj.type === 'session.meta') {
        const locale = typeof obj.locale === 'string' ? obj.locale : '';
        const shop = typeof obj.shopName === 'string' ? obj.shopName : '';
        metaHint = [shop && `Shop: ${shop}`, locale && `Locale: ${locale}`].filter(Boolean).join('. ');
        scheduleDebouncedOpen();
      }
      return;
    }

    if (shouldPassthroughToGemini(obj)) {
      try {
        enqueueToGemini(obj);
      } catch (err) {
        log.error({ err }, 'enqueue to gemini failed');
        safeCloseClient(clientWs, 1011, 'stream_error');
      }
      return;
    }

    log.warn({ keys: Object.keys(obj) }, 'unhandled client message');
  });

  clientWs.on('close', () => cleanup('client_closed'));
  clientWs.on('error', (err) => {
    log.warn({ err }, 'client ws error');
    cleanup('client_error');
  });
}
