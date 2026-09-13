export function hasConversation(t) {
  return !!(t.hasConversation || t.turnStartedAt || t.events?.some(e => e.type === "turn") || t.preview?.trim());
}
export function taskLane(t) {
  if (t.stored) return "stored";
  if (["running", "starting", "queued"].includes(t.state)) return "working";
  return "attention";
}
export const laneNames = { working: "作業中", attention: "あなたの番", stored: "保管" };
