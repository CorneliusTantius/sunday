const isDelegation = call => ['subagent_create', 'subagent_send_prompt'].includes(call.name);

export async function dispatchToolCalls(calls, execute) {
  const results = new Array(calls.length);
  const firstDelegation = calls.findIndex(isDelegation);
  const prefixEnd = firstDelegation < 0 ? calls.length : firstDelegation;

  for (let index = 0; index < prefixEnd; index++) results[index] = await execute(calls[index]);
  if (firstDelegation < 0) return results;

  const delegations = calls.map((call, index) => ({ call, index })).filter(({ call }) => isDelegation(call));
  const settled = await Promise.allSettled(delegations.map(({ call }) => execute(call)));
  const failure = settled.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  settled.forEach((result, index) => { results[delegations[index].index] = result.value; });

  for (let index = firstDelegation; index < calls.length; index++) {
    if (!isDelegation(calls[index])) results[index] = await execute(calls[index]);
  }
  return results;
}
