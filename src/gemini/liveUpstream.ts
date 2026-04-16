import WebSocket from 'ws';

const GEMINI_LIVE_PATH =
  '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BiDiGenerateContent';

export type GeminiLiveUpstreamOptions = {
  apiKey: string;
};

/**
 * Opens a WebSocket to Gemini Multimodal Live API (Google AI). Send `buildInitialConfigMessage` on `open`.
 * @see https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket
 */
export function startLiveConnection(opts: GeminiLiveUpstreamOptions): WebSocket {
  try {
    const key = opts.apiKey;
    const url = `wss://generativelanguage.googleapis.com${GEMINI_LIVE_PATH}?key=${encodeURIComponent(key)}`;
    // Log only a short prefix of the key for debugging; never log the full secret.
    // This helps confirm that GOOGLE_API_KEY is wired correctly in hosted environments.
    console.log('[voice-gateway] Connecting to Gemini Live', {
      url,
      keyPrefix: key ? key.slice(0, 4) : '',
    });
    return new WebSocket(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to start Gemini Live WebSocket: ${message}`);
  }
}

/** @deprecated Prefer {@link startLiveConnection} */
export function createGeminiLiveConnection(opts: GeminiLiveUpstreamOptions): WebSocket {
  return startLiveConnection(opts);
}

export function buildInitialConfigMessage(opts: {
  modelId: string;
  systemInstructionText: string;
  voiceName?: string;
}): string {
  const model = opts.modelId.startsWith('models/') ? opts.modelId : `models/${opts.modelId}`;
  const selectedVoice = (opts.voiceName || 'Kore').trim() || 'Kore';
  /**
   * First client frame must be `setup` (BidiGenerateContentSetup), not `config`.
   * @see https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket
   */
  const message = {
    setup: {
      model,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: selectedVoice,
            },
          },
        },
      },
      systemInstruction: {
        parts: [{ text: opts.systemInstructionText }],
      },
    },
  };
  return JSON.stringify(message);
}
