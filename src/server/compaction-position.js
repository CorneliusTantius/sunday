function contextMessageCount(message) {
  if (message?.role === 'user') return 1;
  if (message?.role !== 'assistant') return 0;
  const calls = Array.isArray(message.toolCalls)
    ? message.toolCalls.filter(call => call && typeof call.id === 'string' && typeof call.name === 'string' && typeof call.result === 'string').length
    : 0;
  return calls * 2 + (message.content ? 1 : 0);
}

// `through` counts internal model-context entries, while the UI groups tool
// activity into one assistant transcript message. Place the summary after the
// transcript message containing the boundary, if the boundary falls within it.
export function compactionMessageIndex(messages, through = 0) {
  let contextCount = 0;
  let index = 0;
  while (index < messages.length && contextCount < through) {
    contextCount += contextMessageCount(messages[index]);
    index++;
  }
  return index;
}
