/**
 * AgentHarness read-only adapter shell (WCA-07).
 *
 * Wraps a capability registry with the fail-closed port contract:
 * - Identity inputs are validated in their original form before resolution;
 *   no hash/namespace conversion may launder an invalid key.
 * - Unknown capability -> capability_not_supported.
 * - Known capability with unknown contract version -> capability_contract_mismatch.
 * - Adapter protocol violations (echo mismatch, unknown status/safety class,
 *   malformed result) -> capability_contract_mismatch.
 * - Adapter throws -> source_unavailable (check/read) or
 *   capability_not_supported (describe), always with a stable safe summary.
 * - Read safety class outside the descriptor's allowed set -> unsafe_evidence.
 * - Failure summaries are fixed strings; adapter error messages (which may
 *   contain stacks, absolute paths, or secrets) are never propagated.
 */
import {
  isAgentHarnessCheckStatus,
  isAgentHarnessSafetyClass,
  isValidCapabilityId,
  isValidContractVersion,
  isValidSourceObjectKey,
  type AgentHarnessAdapterPort,
  type AgentHarnessCapabilityDescriptor,
  type AgentHarnessCapabilityRegistry,
  type AgentHarnessCheckResult,
  type AgentHarnessDescribeResult,
  type AgentHarnessPortFailure,
  type AgentHarnessReadResult,
  type AgentHarnessSourceAdapter,
  type AgentHarnessSourceCheck,
  type AgentHarnessSourceRead,
} from "../../contracts/agentharness-port.ts";

const SUMMARY_UNKNOWN_CAPABILITY = "Unknown AgentHarness capability.";
const SUMMARY_CONTRACT_MISMATCH = "AgentHarness capability contract version is not supported.";
const SUMMARY_SOURCE_UNAVAILABLE = "AgentHarness source is unavailable.";
const SUMMARY_UNSAFE = "AgentHarness source content is not permitted by the capability safety policy.";

function failure(code: AgentHarnessPortFailure["code"], summary: string): AgentHarnessPortFailure {
  return { kind: "failure", code, summary };
}

function toSafeDescriptor(raw: AgentHarnessCapabilityDescriptor): AgentHarnessCapabilityDescriptor | null {
  if (!isValidCapabilityId(raw.capabilityId)) return null;
  if (!isValidContractVersion(raw.contractVersion)) return null;
  if (typeof raw.displayName !== "string" || raw.displayName.trim().length === 0) return null;
  if (!Array.isArray(raw.allowedSafetyClasses) || raw.allowedSafetyClasses.length === 0) return null;
  if (!raw.allowedSafetyClasses.every(isAgentHarnessSafetyClass)) return null;
  return {
    capabilityId: raw.capabilityId,
    contractVersion: raw.contractVersion,
    displayName: raw.displayName,
    allowedSafetyClasses: [...raw.allowedSafetyClasses],
    readOnly: true,
  };
}

function toSafeCheck(raw: AgentHarnessSourceCheck): AgentHarnessSourceCheck | null {
  if (!isAgentHarnessCheckStatus(raw?.status)) return null;
  const nullableString = (v: unknown): v is string | null => v === null || typeof v === "string";
  if (!nullableString(raw.observedContractVersion)) return null;
  if (!nullableString(raw.observedSourceVersion)) return null;
  if (!nullableString(raw.diagnosticCode)) return null;
  if (!nullableString(raw.diagnosticSummary)) return null;
  return {
    status: raw.status,
    observedContractVersion: raw.observedContractVersion,
    observedSourceVersion: raw.observedSourceVersion,
    diagnosticCode: raw.diagnosticCode,
    diagnosticSummary: raw.diagnosticSummary,
  };
}

function toSafeRead(raw: AgentHarnessSourceRead): AgentHarnessSourceRead | null {
  if (!isAgentHarnessSafetyClass(raw?.safetyClass)) return null;
  if (typeof raw.mediaType !== "string" || raw.mediaType.trim().length === 0) return null;
  if (raw.observedSourceVersion !== null && typeof raw.observedSourceVersion !== "string") return null;
  if (raw.declaredByteSize !== null && (typeof raw.declaredByteSize !== "number" || !Number.isInteger(raw.declaredByteSize) || raw.declaredByteSize < 0)) return null;
  if (typeof raw.openContent !== "function") return null;
  return {
    safetyClass: raw.safetyClass,
    mediaType: raw.mediaType,
    observedSourceVersion: raw.observedSourceVersion,
    declaredByteSize: raw.declaredByteSize,
    openContent: raw.openContent,
  };
}

/**
 * Create the read-only AgentHarness adapter port over a capability registry.
 * The port exposes exactly describeCapability / checkSource / readSource and
 * never throws; all outcomes are discriminated-union results.
 */
export function createAgentHarnessPort(
  registry: AgentHarnessCapabilityRegistry,
): AgentHarnessAdapterPort {
  const resolveAdapter = (
    capabilityId: string,
    contractVersion: string,
  ): { kind: "resolved"; adapter: AgentHarnessSourceAdapter; descriptor: AgentHarnessCapabilityDescriptor } | AgentHarnessPortFailure => {
    if (!isValidCapabilityId(capabilityId)) {
      return failure("capability_not_supported", SUMMARY_UNKNOWN_CAPABILITY);
    }
    if (!isValidContractVersion(contractVersion)) {
      return failure("capability_contract_mismatch", SUMMARY_CONTRACT_MISMATCH);
    }
    let descriptors: readonly AgentHarnessCapabilityDescriptor[];
    let adapter: AgentHarnessSourceAdapter | null;
    try {
      descriptors = registry.listCapabilities();
      adapter = registry.resolve(capabilityId, contractVersion);
    } catch {
      // Registry failure: fail closed with a stable safe summary.
      return failure("capability_not_supported", SUMMARY_UNKNOWN_CAPABILITY);
    }
    if (!adapter) {
      const knownCapability = descriptors.some((d) => d.capabilityId === capabilityId);
      return knownCapability
        ? failure("capability_contract_mismatch", SUMMARY_CONTRACT_MISMATCH)
        : failure("capability_not_supported", SUMMARY_UNKNOWN_CAPABILITY);
    }
    const descriptor = descriptors.find(
      (d) => d.capabilityId === capabilityId && d.contractVersion === contractVersion,
    );
    if (!descriptor) {
      // Inconsistent registry: adapter resolved without a declared descriptor.
      return failure("capability_contract_mismatch", SUMMARY_CONTRACT_MISMATCH);
    }
    return { kind: "resolved", adapter, descriptor };
  };

  return {
    async describeCapability(capabilityId, contractVersion) {
      const resolved = resolveAdapter(capabilityId, contractVersion);
      if (resolved.kind === "failure") return resolved;
      let raw: AgentHarnessCapabilityDescriptor;
      try {
        raw = await resolved.adapter.describe();
      } catch {
        return failure("capability_not_supported", SUMMARY_UNKNOWN_CAPABILITY);
      }
      const descriptor = toSafeDescriptor(raw);
      if (!descriptor) {
        return failure("capability_contract_mismatch", SUMMARY_CONTRACT_MISMATCH);
      }
      if (descriptor.capabilityId !== capabilityId || descriptor.contractVersion !== contractVersion) {
        // Echo mismatch: adapter answered for a different identity.
        return failure("capability_contract_mismatch", SUMMARY_CONTRACT_MISMATCH);
      }
      return { kind: "success", descriptor };
    },

    async checkSource(capabilityId, contractVersion, sourceObjectKey) {
      if (!isValidSourceObjectKey(sourceObjectKey)) {
        return failure("source_unavailable", SUMMARY_SOURCE_UNAVAILABLE);
      }
      const resolved = resolveAdapter(capabilityId, contractVersion);
      if (resolved.kind === "failure") return resolved;
      let raw: AgentHarnessSourceCheck;
      try {
        raw = await resolved.adapter.check(sourceObjectKey);
      } catch {
        return failure("source_unavailable", SUMMARY_SOURCE_UNAVAILABLE);
      }
      const check = toSafeCheck(raw);
      if (!check) {
        return failure("capability_contract_mismatch", SUMMARY_CONTRACT_MISMATCH);
      }
      return { kind: "success", check };
    },

    async readSource(capabilityId, contractVersion, sourceObjectKey) {
      if (!isValidSourceObjectKey(sourceObjectKey)) {
        return failure("source_unavailable", SUMMARY_SOURCE_UNAVAILABLE);
      }
      const resolved = resolveAdapter(capabilityId, contractVersion);
      if (resolved.kind === "failure") return resolved;
      let raw: AgentHarnessSourceRead;
      try {
        raw = await resolved.adapter.read(sourceObjectKey);
      } catch {
        return failure("source_unavailable", SUMMARY_SOURCE_UNAVAILABLE);
      }
      const read = toSafeRead(raw);
      if (!read) {
        return failure("capability_contract_mismatch", SUMMARY_CONTRACT_MISMATCH);
      }
      if (!resolved.descriptor.allowedSafetyClasses.includes(read.safetyClass)) {
        return failure("unsafe_evidence", SUMMARY_UNSAFE);
      }
      return { kind: "success", read };
    },
  };
}
