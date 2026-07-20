/**
 * Capability manifest handler.
 *
 * Contract (API-059, API-018, API-050, API-052):
 * - GET /api/v1/capabilities returns runtime capabilities from configuration and
 *   registries, non-materialized, with no model/token/prompt/path/data-dir leak.
 * - Cache-Control: private, no-cache; ETag on canonical data excluding requestId.
 * - Harness registry is genuinely empty for v0.0 (no fabricated capabilities).
 */
import type { RequestContext } from "../router.ts";
import { sendJson, computeCanonicalDataEtag, matchesEtag } from "../envelope.ts";
import { UPLOAD_MAX_BYTES, ALLOWED_USER_MEDIA_TYPES } from "../../application/evidence/evidence-service.ts";
import type { AgentHarnessCapabilityRegistry } from "../../contracts/agentharness-port.ts";

export function createCapabilitiesHandler(engineAvailable: boolean, agentHarnessRegistry: AgentHarnessCapabilityRegistry | null = null) {
  return async function handleCapabilities(ctx: RequestContext): Promise<void> {
    // Reflect the injected registry truthfully. Default (no registry) is a
    // genuinely empty list; registry failures fail closed to empty.
    let agentHarnessCapabilities: readonly unknown[] = [];
    if (agentHarnessRegistry) {
      try {
        agentHarnessCapabilities = agentHarnessRegistry.listCapabilities().map((d) => ({
          capabilityId: d.capabilityId,
          contractVersion: d.contractVersion,
          displayName: d.displayName,
          allowedSafetyClasses: [...d.allowedSafetyClasses],
          readOnly: true as const,
        }));
      } catch {
        agentHarnessCapabilities = [];
      }
    }
    const data = {
      version: "1.0.0",
      apiVersion: "1.0.0",
      appVersion: "0.0.0",
      enabledDailyKinds: ["daily_analysis"],
      supportedSchemaVersions: ["1.0"],
      sourceCapabilities: {
        user: [
          { kind: "upload", scope: "user_provided", artifactKind: "input_material" },
        ],
        agentHarness: agentHarnessCapabilities, // Reflects the injected registry; genuinely empty by default (no fabricated DataBase/OntoBase/MemoryBase/KnowledgeBase/Console capabilities).
      },
      engine: engineAvailable
        ? { status: "available" as const, adapter: "pi" as const }
        : { status: "unavailable" as const, reason: "Analysis Engine adapter is not enabled" },
      upload: {
        maxBytes: UPLOAD_MAX_BYTES,
        allowedMediaTypes: Array.from(ALLOWED_USER_MEDIA_TYPES),
        tmpAvailable: true,
      },
      representationFormats: [],
      exportContracts: [],
    };
    const etag = computeCanonicalDataEtag(data);
    if (matchesEtag(ctx.req, etag)) {
      sendJson(ctx.res, 304, {}, { requestId: ctx.requestId, etag, cacheControl: "private, no-cache" });
      return;
    }
    sendJson(ctx.res, 200, {
      schemaVersion: "1.0",
      requestId: ctx.requestId,
      data,
    }, { requestId: ctx.requestId, etag, cacheControl: "private, no-cache" });
  };
}

export const handleCapabilities = createCapabilitiesHandler(false);
