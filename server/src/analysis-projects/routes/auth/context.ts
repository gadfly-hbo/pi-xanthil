/**
 * Auth context stub for pi-Xanthil.
 * Re-exports TrustedActorContext from application shared.
 * Stubs deriveClientVersion (originally extracted from request headers).
 */
export type { TrustedActorContext } from "../../application/shared/runtime.ts";

/**
 * Stub for deriveClientVersion.
 * Returns null since WorkCanger auth is not migrated.
 */
export function deriveClientVersion(_headers?: unknown): string | null {
  return null;
}
