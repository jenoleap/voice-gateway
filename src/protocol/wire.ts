/**
 * Wire protocol: WalletX app ↔ voice-gateway (JSON over WebSocket).
 * Gemini Live payloads use the shapes documented at:
 * https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket
 */

/** App → gateway: control + passthrough to Gemini where noted */
export type ClientToGatewayMessage =
  | ClientPing
  | ClientSessionMeta
  | GeminiClientRealtimePayload;

export type ClientPing = { type: 'ping'; id?: string };

/** Optional shop/context hints (gateway may merge into system instruction). */
export type ClientSessionMeta = {
  type: 'session.meta';
  locale?: string;
  shopName?: string | null;
};

/**
 * Forwarded verbatim to Gemini after the gateway sends the initial Live `config`.
 * @see https://ai.google.dev/api/live
 */
export type GeminiClientRealtimePayload = {
  realtimeInput?: {
    text?: string;
    audio?: { data: string; mimeType: string };
    video?: { data: string; mimeType: string };
    audioStreamEnd?: boolean;
    activityStart?: Record<string, never>;
    activityEnd?: Record<string, never>;
  };
  clientContent?: unknown;
};

export type GatewayToClientMessage =
  | GatewayPong
  | GatewayReady
  | GatewayMetaAck
  | GatewayError
  /** Raw JSON string from Gemini (passthrough) stored as parsed object */
  | GeminiServerPayload;

export type GatewayMetaAck = { type: 'gateway.meta.ack' };

export type GatewayPong = { type: 'pong'; id?: string };

export type GatewayReady = {
  type: 'gateway.ready';
  model: string;
  /** Gemini outputs native audio (24 kHz PCM LE per Google docs). */
  responseModalities: string[];
};

export type GatewayError = {
  type: 'gateway.error';
  code: string;
  message: string;
};

/** Passthrough of Gemini `BidiGenerateContentServerMessage` JSON. */
export type GeminiServerPayload = {
  type: 'gemini';
  payload: Record<string, unknown>;
};
