# WalletX Voice Gateway

Separate from `wa-sales-gateway`. Bridges the **React Native app** ↔ **Gemini Multimodal Live API** over WebSockets so the **Gemini API key never ships in the Expo bundle**.

## Quick start

```bash
cd voice-gateway
cp .env.example .env
# Set GEMINI_API_KEY, GEMINI_LIVE_MODEL, and PORT (e.g. PORT=8791).
# Optional: GEMINI_LIVE_VOICE (Kore/Zephyr/Aoide), GEMINI_LIVE_FALLBACK_VOICE (e.g. Aoide),
# and SUPABASE_URL + SUPABASE_ANON_KEY to require ?token=...
npm install
npm run dev
```

- HTTP health: `http://localhost:<PORT>/` (same HTTP server; Railway injects `PORT`)
- App WebSocket: `WebSocketServer` is mounted at **`/voice`** only (proper HTTP **101** Switching Protocols). Example: `ws://<host>:<PORT>/voice?token=<supabase_access_token>`
- The process binds to **`0.0.0.0`** so platform proxies (e.g. Railway) can reach it.

## Environment

| Variable | Required | Notes |
|----------|----------|--------|
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Yes | Server-side only; gateway prefers `GOOGLE_API_KEY` and falls back to `GEMINI_API_KEY` if unset |
| `GEMINI_LIVE_MODEL` | Yes | Live model id (no `models/` prefix); process exits at startup if missing |
| `GEMINI_LIVE_VOICE` | No | Primary voice name for `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` (default: `Kore`) |
| `GEMINI_LIVE_FALLBACK_VOICE` | No | Fallback voice on setup failure (default: `Aoide`) |
| `PORT` | Yes | `parseInt(process.env.PORT, 10)` — Railway sets this; use `8791` (or any free port) in `.env` locally |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` | No | If both set, connections **must** pass a valid user JWT in `token` |

## Protocol

See `src/protocol/wire.ts`. The app sends `session.meta`, `realtimeInput` (16 kHz PCM base64 per [Live API](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket)), and receives `gateway.ready`, `gemini` envelopes, and errors.  
Gateway upstream uses the **v1beta** BidiGenerateContent WebSocket path (`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BiDiGenerateContent`) and sends `setup.generationConfig.speechConfig` with your configured voice.

## Production

Run behind TLS (`wss://`) and restrict `GEMINI_API_KEY` by IP or use Vertex with service accounts if you migrate off Google AI Studio.
