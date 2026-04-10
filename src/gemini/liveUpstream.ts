import WebSocket from 'ws';

const GEMINI_LIVE_PATH =
  '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export type GeminiLiveUpstreamOptions = {
  apiKey: string;
};

/**
 * Opens a WebSocket to Gemini Multimodal Live API (Google AI). Send `buildInitialConfigMessage` on `open`.
 * @see https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket
 */
export function createGeminiLiveConnection(opts: GeminiLiveUpstreamOptions): WebSocket {
  const url = `wss://generativelanguage.googleapis.com${GEMINI_LIVE_PATH}?key=${encodeURIComponent(opts.apiKey)}`;
  return new WebSocket(url);
}

export function buildInitialConfigMessage(opts: {
  modelId: string;
  systemInstructionText: string;
}): string {
  const model = opts.modelId.startsWith('models/') ? opts.modelId : `models/${opts.modelId}`;
  /** @see https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket */
  const message = {
    config: {
      model,
      responseModalities: ['AUDIO'],
      systemInstruction: {
        parts: [{ text: opts.systemInstructionText }],
      },
    },
  };
  return JSON.stringify(message);
}
