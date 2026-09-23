// Persisted history owns completed turns. Cached live items are not another
// history page: older entries must never reappear after the latest 12 turns.
export function conversationItems(history, activeTurn) {
  if (!history) return [];
  const items = new Map();
  for (const turn of history.turns || [])
    for (const item of turn.items || []) items.set(item.id, item);
  for (const [id, item] of history.live || []) {
    if (activeTurn && item.turnId === activeTurn) items.set(id, item);
  }
  return [...items.values()];
}

export function mergeRecentHistory(previous, result) {
  const recent = [...(result.data || [])].reverse();
  const turns = new Map((previous?.turns || []).map(t => [t.id, t]));
  for (const turn of recent) turns.set(turn.id, turn);
  // A refresh of the newest turns must not move pagination back over older
  // turns the reader has already loaded.
  const oldest = previous?.turns?.[0];
  const keepCursor = oldest && !recent.some(t => t.id === oldest.id);
  return {
    compactHistory: !!result.compactHistory || !!previous?.compactHistory,
    turns: [...turns.values()].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)),
    cursor: previous?.cursor === null || keepCursor ? previous.cursor : result.nextCursor,
    live: new Map(),
  };
}
