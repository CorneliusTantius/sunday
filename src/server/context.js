// Conservative estimate, not a provider tokenizer. JSON includes attachments and tool schemas.
export function estimateContext(systemPrompt, messages, tools = []) {
  return Math.ceil((systemPrompt.length + JSON.stringify(messages).length + JSON.stringify(tools).length) / 3) + messages.length * 12;
}
export function shouldCompact(tokens, window) {
  return Number.isFinite(tokens) && window > 0 && tokens >= window * 0.75;
}
export function measuredInput(usage) {
  return (usage?.input || 0) + (usage?.cacheRead || 0) + (usage?.cacheWrite || 0);
}
