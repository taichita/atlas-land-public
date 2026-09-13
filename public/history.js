export function mergeRecentHistory(previous, result) {
  const recent = [...(result.data || [])].reverse();
  const turns = new Map((previous?.turns || []).map(t => [t.id, t]));
  for (const turn of recent) turns.set(turn.id, turn);
  // A refresh of the newest turns must not move pagination back over older
  // turns the reader has already loaded.
  const oldest = previous?.turns?.[0];
  const keepCursor = oldest && !recent.some(t => t.id === oldest.id);
  return {
    turns: [...turns.values()].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)),
    cursor: previous?.cursor === null || keepCursor ? previous.cursor : result.nextCursor,
    live: new Map(),
  };
}
