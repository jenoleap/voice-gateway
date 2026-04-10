import 'dotenv/config';
import { createVoiceGatewayServer } from './server.js';

const PORT = Number(process.env.PORT ?? 8791);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() ?? '';
const GEMINI_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL?.trim() || 'gemini-2.5-flash-native-audio-preview-12-2025';

const { server, log, listen } = createVoiceGatewayServer({
  port: PORT,
  geminiApiKey: GEMINI_API_KEY,
  geminiLiveModel: GEMINI_LIVE_MODEL,
  supabaseUrl: process.env.SUPABASE_URL?.trim() ?? '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() ?? '',
  logLevel: process.env.LOG_LEVEL ?? 'info',
});

listen();
server.on('listening', () => {
  log.info({ port: PORT }, 'walletx-voice-gateway listening');
});

if (!GEMINI_API_KEY) {
  log.warn('GEMINI_API_KEY is empty — voice sessions will fail until set (server-side .env only)');
}
