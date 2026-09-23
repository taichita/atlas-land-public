const compactThreads = new WeakMap();

// Retry only this read, never a send/approval. Keep large threads in summary
// mode so the observer does not fetch the same huge media payload every poll.
export async function readTurnHistory(bridge, params) {
  let compact = compactThreads.get(bridge);
  if (!compact) compactThreads.set(bridge, compact = new Set());
  const read = itemsView => bridge.call('thread/turns/list', { ...params, itemsView });
  if (!compact.has(params.threadId)) {
    try { return await read('full'); }
    catch (e) {
      if (e.code !== 'ATLAS_RESPONSE_TOO_LARGE') throw e;
      compact.add(params.threadId);
    }
  }
  return { ...await read('summary'), compactHistory: true };
}
