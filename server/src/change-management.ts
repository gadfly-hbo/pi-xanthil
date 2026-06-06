// AnaX P3 change management utilities.
// Provides the linear DAG order and downstream-node computation for cascade logic.

const ANAX_NODE_ORDER = [
  "business", "plan", "data", "data_gate",
  "insight", "recommend", "review_gate", "verify", "archive",
] as const;

/** Returns all node IDs that are downstream of (i.e. after) fromNodeId in the AnaX DAG. */
export function getDownstreamNodeIds(fromNodeId: string): string[] {
  const idx = ANAX_NODE_ORDER.indexOf(fromNodeId as typeof ANAX_NODE_ORDER[number]);
  if (idx < 0) return [];
  return [...ANAX_NODE_ORDER.slice(idx + 1)];
}

/** True if nodeId is a valid AnaX node. */
export function isAnaxNode(nodeId: string): boolean {
  return ANAX_NODE_ORDER.includes(nodeId as typeof ANAX_NODE_ORDER[number]);
}
