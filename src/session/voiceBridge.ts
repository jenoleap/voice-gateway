import type { ClientToGatewayMessage } from '../protocol/wire.js';

const PASSTHROUGH_KEYS = new Set([
  'realtimeInput',
  'clientContent',
  'toolResponse',
]);

export function parseClientMessage(raw: string): ClientToGatewayMessage | null {
  try {
    return JSON.parse(raw) as ClientToGatewayMessage;
  } catch {
    return null;
  }
}

export function shouldPassthroughToGemini(obj: Record<string, unknown>): boolean {
  return [...PASSTHROUGH_KEYS].some((k) => k in obj);
}

export function handleClientControlMessage(
  obj: Record<string, unknown>,
  sendToClient: (json: object) => void
): boolean {
  if (obj.type === 'ping') {
    sendToClient({ type: 'pong', id: obj.id });
    return true;
  }
  if (obj.type === 'session.meta') {
    sendToClient({ type: 'gateway.meta.ack' });
    return true;
  }
  return false;
}
