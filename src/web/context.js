export function formatTokens(value) {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(value);
}

export function getContextMetrics(contextUsage, sessionConfig, messages, prompt, modelContextWindow) {
  const matchingModel = Boolean(contextUsage && sessionConfig && contextUsage.model === sessionConfig.model && contextUsage.provider === sessionConfig.provider);
  const countIsCurrent = Number.isInteger(contextUsage?.messageCount) && contextUsage.messageCount >= messages.length - 1;
  // Server estimates after compaction count internal history that is not displayed as chat messages.
  const contextUsageCurrent = matchingModel && countIsCurrent && (contextUsage.measured === false || contextUsage.messageCount <= messages.length);
  const measuredUsage = contextUsageCurrent && contextUsage.measured !== false;
  const contextWindow = modelContextWindow || (contextUsageCurrent ? contextUsage.contextWindow : 0);
  const estimatedCharacters = prompt.length + messages.reduce((total, message) => total + (message.content?.length || 0) + (message.fileReferences || []).reduce((size, ref) => size + (ref.content?.length || 0), 0) + (message.toolCalls || []).reduce((size, call) => size + JSON.stringify(call.arguments || {}).length + String(call.result || '').length, 0), 0);
  const contextTokens = contextUsageCurrent ? contextUsage.tokens + Math.ceil(prompt.length / 3) : Math.ceil(estimatedCharacters / 3);
  const contextPercent = contextWindow ? Math.min(100, Math.round(contextTokens / contextWindow * 100)) : 0;
  return { measuredUsage, contextWindow, contextTokens, contextPercent };
}
