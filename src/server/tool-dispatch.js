const readOnlyTools = new Set(['read', 'find', 'context_search', 'context_links', 'tool_output_search', 'tool_output_fetch']);
const batchKind = call => readOnlyTools.has(call.name) ? 'read' : null;

export async function dispatchToolCalls(calls, execute) {
  const results = [];
  for (let index = 0; index < calls.length;) {
    const kind = batchKind(calls[index]);
    let end = index + 1;
    // Never move a call across a mutation, unknown MCP tool, or dependency boundary.
    if (kind) while (end < calls.length && batchKind(calls[end]) === kind) end++;
    if (!kind) results.push(await execute(calls[index]));
    else {
      const settled = await Promise.allSettled(calls.slice(index, end).map(call => Promise.resolve().then(() => execute(call))));
      const failure = settled.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      results.push(...settled.map(result => result.value));
    }
    index = end;
  }
  return results;
}
