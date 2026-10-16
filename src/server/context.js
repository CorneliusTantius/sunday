import { calculateContextTokens, DEFAULT_COMPACTION_SETTINGS, estimateTokens, findCutPoint, generateSummary, shouldCompact as piShouldCompact } from '@earendil-works/pi-coding-agent';

export function estimateContext(systemPrompt, messages, tools = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'assistant' && message.usage && calculateContextTokens(message.usage) > 0 && !['error', 'aborted'].includes(message.stopReason)) {
      return calculateContextTokens(message.usage) + messages.slice(i + 1).reduce((sum, item) => sum + estimateTokens(item), 0);
    }
  }
  return estimateTokens({ role: 'user', content: systemPrompt + JSON.stringify(tools) }) + messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}
export function shouldCompact(tokens, window) {
  return Number.isFinite(tokens) && window > 0 && piShouldCompact(tokens, window, DEFAULT_COMPACTION_SETTINGS);
}
export function measuredInput(usage) {
  return usage ? calculateContextTokens(usage) : 0;
}
export function compactionCut(messages) {
  const entries = messages.map((message, i) => ({ type: 'message', id: String(i), message }));
  return findCutPoint(entries, 0, entries.length, DEFAULT_COMPACTION_SETTINGS.keepRecentTokens).firstKeptEntryIndex;
}
export async function summarizeContext(messages, model, models, signal) {
  return generateSummary(messages, model, DEFAULT_COMPACTION_SETTINGS.reserveTokens, undefined, undefined, signal, undefined, undefined, undefined,
    (model, context, options) => models.streamSimple(model, context, { ...options, timeoutMs: 120000 }));
}
export function isContextOverflow(error) {
  return /context[_ ]length[_ ]exceeded|maximum context length|context window|prompt is too long|input is too long|too many tokens|request exceeds.*tokens/i.test(error?.message || '');
}
