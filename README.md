# WalletX Voice Gateway

Separate from `wa-sales-gateway`. Bridges the **React Native app** ↔ **Gemini Multimodal Live API** over WebSockets so the **Gemini API key never ships in the Expo bundle**.

## Quick start

```bash
cd voice-gateway
cp .env.example .env
# Set GEMINI_API_KEY (Google AI Studio). Optional: SUPABASE_URL + SUPABASE_ANON_KEY to require ?token=...
npm install
npm run dev
```

- HTTP health: `http://localhost:8791/`
- App WebSocket path: `ws://<host>:8791/voice?token=<supabase_access_token>`

## Environment

| Variable | Required | Notes |
|----------|----------|--------|
| `GEMINI_API_KEY` | Yes | Server-side only |
| `GEMINI_LIVE_MODEL` | No | Default in `src/index.ts`; update if Google renames preview models |
| `PORT` | No | Default `8791` |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` | No | If both set, connections **must** pass a valid user JWT in `token` |

## Protocol

See `src/protocol/wire.ts`. The app sends `session.meta`, `realtimeInput` (16 kHz PCM base64 per [Live API](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket)), and receives `gateway.ready`, `gemini` envelopes, and errors.

## Production

Run behind TLS (`wss://`) and restrict `GEMINI_API_KEY` by IP or use Vertex with service accounts if you migrate off Google AI Studio.
