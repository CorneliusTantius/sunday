const isDelegation = call => ['subagent_create', 'subagent_send_prompt'].includes(call.name);

export async function dispatchToolCalls(calls, execute) {
  const results = [];
  for (let index = 0; index < calls.length;) {
    const batch = [calls[index++]];
    if (isDelegation(batch[0])) {
      while (index < calls.length && isDelegation(calls[index])) batch.push(calls[index++]);
    }
    const settled = await Promise.allSettled(batch.map(execute));
    const failure = settled.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    results.push(...settled.map(result => result.value));
  }
  return results;
}
