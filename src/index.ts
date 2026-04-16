import 'dotenv/config';
import pino from 'pino';
import { createVoiceGatewayServer } from './server.js';

const bootstrapLog = pino({ level: process.env.LOG_LEVEL ?? 'info' });

process.on('uncaughtException', (err) => {
  bootstrapLog.fatal({ err }, 'uncaughtException');
});
process.on('unhandledRejection', (reason, promise) => {
  bootstrapLog.fatal({ reason, promise: String(promise) }, 'unhandledRejection');
});

const portRaw = process.env.PORT;
const portTrimmed = portRaw !== undefined && portRaw !== null ? String(portRaw).trim() : '';
const PORT = portTrimmed === '' ? 8791 : parseInt(portTrimmed, 10);
if (!Number.isFinite(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`Invalid PORT "${portTrimmed || portRaw}": must be an integer 1–65535.`);
}
if (portTrimmed === '') {
  bootstrapLog.info(
    { port: PORT },
    'PORT not set; using default 8791 for local dev (Railway injects PORT in production).'
  );
}

const GEMINI_API_KEY =
  process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || '';
if (!GEMINI_API_KEY) {
  throw new Error(
    'GOOGLE_API_KEY (or GEMINI_API_KEY) is required (Google AI Studio / Gemini API key, server-side only).'
  );
}

const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL?.trim() ?? '';
if (!GEMINI_LIVE_MODEL) {
  throw new Error(
    'GEMINI_LIVE_MODEL is required (e.g. gemini-3.1-flash-live-preview). See Gemini Live API docs.'
  );
}
const GEMINI_LIVE_VOICE = process.env.GEMINI_LIVE_VOICE?.trim() || 'Kore';
const GEMINI_LIVE_FALLBACK_VOICE = process.env.GEMINI_LIVE_FALLBACK_VOICE?.trim() || 'Aoide';

const { server, log, listen } = createVoiceGatewayServer({
  port: PORT,
  geminiApiKey: GEMINI_API_KEY,
  geminiLiveModel: GEMINI_LIVE_MODEL,
  geminiLiveVoice: GEMINI_LIVE_VOICE,
  geminiLiveFallbackVoice: GEMINI_LIVE_FALLBACK_VOICE,
  supabaseUrl: process.env.SUPABASE_URL?.trim() ?? '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() ?? '',
  logLevel: process.env.LOG_LEVEL ?? 'info',
});

listen();
server.on('listening', () => {
  const addr = server.address();
  const bind =
    addr && typeof addr === 'object'
      ? { host: addr.address, port: addr.port }
      : { host: '0.0.0.0', port: PORT };
  log.info(bind, 'walletx-voice-gateway listening');
});
