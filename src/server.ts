import http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import pino from 'pino';
import { verifyUserJwt } from './auth/verifyUserJwt.js';
import { createGeminiLiveConnection, buildInitialConfigMessage } from './gemini/liveUpstream.js';
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

function rawToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  const view = data as ArrayBufferView;
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('utf8');
}

export function createVoiceGatewayServer(env: VoiceGatewayEnv) {
  const log = pino({ level: env.logLevel });

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'walletx-voice-gateway' }));
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    try {
      const host = request.headers.host ?? 'localhost';
      const url = new URL(request.url ?? '/', `http://${host}`);
      if (url.pathname !== '/voice') {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } catch (e) {
      log.warn({ e }, 'upgrade failed');
      socket.destroy();
    }
  });

  wss.on('connection', async (clientWs: WebSocket, request: http.IncomingMessage) => {
    const host = request.headers.host ?? 'localhost';
    const url = new URL(request.url ?? '/', `http://${host}`);
    const token = url.searchParams.get('token')?.trim() ?? '';

    const authRequired = Boolean(env.supabaseUrl && env.supabaseAnonKey);
    if (authRequired) {
      if (!token) {
        log.warn('reject: missing token');
        clientWs.close(4401, 'missing_token');
        return;
      }
      const auth = await verifyUserJwt(env.supabaseUrl, env.supabaseAnonKey, token);
      if (!auth) {
        log.warn('reject: invalid token');
        clientWs.close(4401, 'invalid_token');
        return;
      }
    }

    if (!env.geminiApiKey) {
      log.error('GEMINI_API_KEY not configured');
      clientWs.close(1011, 'server_misconfigured');
      return;
    }

    const sendToClient = (json: object) => {
      if (clientWs.readyState === clientWs.OPEN) {
        clientWs.send(JSON.stringify(json));
      }
    };

    let metaHint = '';
    let upstream: WebSocket | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let configSent = false;
    /** JSON lines to Gemini while upstream is still connecting */
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

    function wireUpstream(u: WebSocket) {
      u.on('message', (data) => {
        const text = rawToString(data);
        try {
          const payload = JSON.parse(text) as Record<string, unknown>;
          sendToClient({ type: 'gemini', payload });
        } catch {
          sendToClient({
            type: 'gateway.error',
            code: 'upstream_non_json',
            message: 'Gemini sent a non-JSON frame',
          });
        }
      });

      u.on('error', (err) => {
        log.error({ err }, 'gemini upstream error');
        sendToClient({
          type: 'gateway.error',
          code: 'upstream_error',
          message: err instanceof Error ? err.message : 'upstream_error',
        });
      });

      u.on('close', () => {
        if (clientWs.readyState === clientWs.OPEN) {
          clientWs.close(1000, 'upstream_closed');
        }
      });
    }

    function openUpstream() {
      if (upstream || configSent) return;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      const u = createGeminiLiveConnection({
        apiKey: env.geminiApiKey,
      });
      upstream = u;
      wireUpstream(u);

      u.on('open', () => {
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

    /** Let session.meta arrive before first config (short debounce). */
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
        enqueueToGemini(obj);
        return;
      }

      log.warn({ keys: Object.keys(obj) }, 'unhandled client message');
    });

    clientWs.on('close', () => cleanup('client_closed'));
    clientWs.on('error', (err) => {
      log.warn({ err }, 'client ws error');
      cleanup('client_error');
    });
  });

  return { server, log, listen: () => server.listen(env.port) };
}
