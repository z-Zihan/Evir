// Fallbacks for provider capability fields when the provider record carries no
// explicit value. Both the chat stream path and the model switch coordinator
// must budget against the same default or switching and streaming disagree.
export const DEFAULT_MAX_CONTEXT_TOKENS = 128_000;
