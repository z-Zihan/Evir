/**
 * Default per-event idle budget for streamAssistant: if the provider sends no
 * stream event of any kind for this long, the connection is treated as
 * stalled and the turn is aborted as a TIMEOUT. Independent of the whole-turn
 * `timeoutMs` budget. Kept outside chat-stream so call sites can import it
 * while tests mock chat-stream.
 */
export const STREAM_IDLE_TIMEOUT_MS = 60_000;
