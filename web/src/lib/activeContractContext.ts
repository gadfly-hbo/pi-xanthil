// Cross-subtab persisted "active contract context" — module-level singleton.
// BusinessRequirementPane writes; ChatPane reads on mount to pre-select.
// Does NOT touch App.tsx or TabContext.

export type ActiveContractContext = {
  pathId: number;
  markdownPath: string;
  jsonPath?: string;
} | null;

let _active: ActiveContractContext = null;

export function setActiveContractContext(ctx: ActiveContractContext): void {
  _active = ctx;
}

export function getActiveContractContext(): ActiveContractContext {
  return _active;
}
