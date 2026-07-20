/**
 * AgentHarness capability registry implementations.
 *
 * The default registry is genuinely empty (WCA-07): no fabricated
 * DataBase/OntoBase/MemoryBase/KnowledgeBase/Console capabilities.
 * A static registry exists so the runtime seam and tests can inject
 * explicitly declared capabilities without any external connection.
 */
import {
  isAgentHarnessSafetyClass,
  isValidCapabilityId,
  isValidContractVersion,
  type AgentHarnessCapabilityDescriptor,
  type AgentHarnessCapabilityRegistry,
  type AgentHarnessSourceAdapter,
} from "../../contracts/agentharness-port.ts";

/** Genuinely empty registry: no capabilities, resolution always fails closed. */
export function createEmptyAgentHarnessRegistry(): AgentHarnessCapabilityRegistry {
  return {
    listCapabilities: () => [],
    resolve: () => null,
  };
}

export interface StaticAgentHarnessRegistryEntry {
  readonly descriptor: AgentHarnessCapabilityDescriptor;
  readonly adapter: AgentHarnessSourceAdapter;
}

function assertValidDescriptor(descriptor: AgentHarnessCapabilityDescriptor): void {
  if (!isValidCapabilityId(descriptor.capabilityId)) {
    throw new Error("Static registry entry has an invalid capabilityId.");
  }
  if (!isValidContractVersion(descriptor.contractVersion)) {
    throw new Error("Static registry entry has an invalid contractVersion.");
  }
  if (typeof descriptor.displayName !== "string" || descriptor.displayName.trim().length === 0) {
    throw new Error("Static registry entry has an empty displayName.");
  }
  if (!Array.isArray(descriptor.allowedSafetyClasses) || descriptor.allowedSafetyClasses.length === 0) {
    throw new Error("Static registry entry must declare at least one allowed safety class.");
  }
  for (const safetyClass of descriptor.allowedSafetyClasses) {
    if (!isAgentHarnessSafetyClass(safetyClass)) {
      throw new Error("Static registry entry declares an unknown safety class.");
    }
  }
  if (descriptor.readOnly !== true) {
    throw new Error("Static registry entry must be read-only.");
  }
}

/**
 * Registry over explicitly declared entries. Entries are validated at
 * construction time; invalid entries fail closed by throwing during wiring,
 * never at request time.
 */
export function createStaticAgentHarnessRegistry(
  entries: readonly StaticAgentHarnessRegistryEntry[],
): AgentHarnessCapabilityRegistry {
  const byIdentity = new Map<string, StaticAgentHarnessRegistryEntry>();
  for (const entry of entries) {
    assertValidDescriptor(entry.descriptor);
    const identity = `${entry.descriptor.capabilityId} ${entry.descriptor.contractVersion}`;
    if (byIdentity.has(identity)) {
      throw new Error(`Duplicate AgentHarness capability registration: ${entry.descriptor.capabilityId} ${entry.descriptor.contractVersion}`);
    }
    byIdentity.set(identity, entry);
  }
  const descriptors = entries.map((entry) => entry.descriptor);
  return {
    listCapabilities: () => descriptors.map((descriptor) => ({ ...descriptor, allowedSafetyClasses: [...descriptor.allowedSafetyClasses] })),
    resolve: (capabilityId, contractVersion) =>
      byIdentity.get(`${capabilityId} ${contractVersion}`)?.adapter ?? null,
  };
}
