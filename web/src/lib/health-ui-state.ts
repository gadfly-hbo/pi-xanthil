// Module-level store for health UI cross-pane state (run selection).
// ponytail: 简单模块变量，不引 useState/Context——两个 pane 不同时 mount（tab 切换），
// 用 module 变量 + mount 时读初始值即可。将来需要多 pane 同步可升级到 zustand。
let _selectedRunId: string | null = null;

export function getHealthSelectedRunId(): string | null {
  return _selectedRunId;
}

export function setHealthSelectedRunId(id: string | null): void {
  _selectedRunId = id;
}
