/**
 * HTTP tests for /api/analysis-projects/v1/capabilities AgentHarness registry reflection.
 *
 * Uses a synthetic static registry only. Default runtime must report a
 * genuinely empty agentHarness list; an injected registry must be reflected
 * accurately without adapter internals.
 */
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAnalysisProjectsRuntime, type AnalysisProjectsRuntimeHandle } from "../runtime/index.ts";
import { createStaticAgentHarnessRegistry } from "../adapters/agentharness/index.ts";
import type { AgentHarnessCapabilityDescriptor, AgentHarnessSourceAdapter } from "../contracts/agentharness-port.ts";
import { createFakeWorkspacePort } from "./application-helpers.ts";

const runtimes: AnalysisProjectsRuntimeHandle[] = [];

afterEach(async () => {
  while (runtimes.length > 0) {
    await runtimes.pop()!.close();
  }
});

async function startRuntime(options: Parameters<typeof createAnalysisProjectsRuntime>[0]) {
  const runtime = await createAnalysisProjectsRuntime(options);
  runtimes.push(runtime);
  const addr = runtime.address!;
  return { baseUrl: `http://${addr.host}:${addr.port}`, dataRoot: options.dataRoot };
}

const SYNTHETIC_DESCRIPTOR: AgentHarnessCapabilityDescriptor = {
  capabilityId: "xanthil.synthetic",
  contractVersion: "1.0",
  displayName: "Synthetic Test Capability",
  allowedSafetyClasses: ["derived"],
  readOnly: true,
};

const SYNTHETIC_ADAPTER: AgentHarnessSourceAdapter = {
  describe: () => SYNTHETIC_DESCRIPTOR,
  check: () => ({
    status: "available",
    observedContractVersion: "1.0",
    observedSourceVersion: null,
    diagnosticCode: null,
    diagnosticSummary: null,
  }),
  read: () => {
    throw new Error("read must not execute during capabilities lookup.");
  },
};

describe("HTTP: AgentHarness capabilities", () => {
  test("default runtime reports a genuinely empty agentHarness registry", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-cap-default-"));
    try {
      const { baseUrl } = await startRuntime({
        dataRoot,
        workspacePort: createFakeWorkspacePort(),
        host: "127.0.0.1",
        port: 0,
      });
      const res = await fetch(`${baseUrl}/api/analysis-projects/v1/capabilities`);
      const body = await res.json() as { data: { sourceCapabilities: { agentHarness: unknown[] } } };
      assert.equal(res.status, 200);
      assert.deepEqual(body.data.sourceCapabilities.agentHarness, []);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test("injected registry is reflected accurately without adapter internals", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-cap-injected-"));
    try {
      const registry = createStaticAgentHarnessRegistry([
        { descriptor: SYNTHETIC_DESCRIPTOR, adapter: SYNTHETIC_ADAPTER },
      ]);
      const { baseUrl } = await startRuntime({
        dataRoot,
        workspacePort: createFakeWorkspacePort(),
        agentHarnessRegistry: registry,
        host: "127.0.0.1",
        port: 0,
      });
      const res = await fetch(`${baseUrl}/api/analysis-projects/v1/capabilities`);
      const body = await res.json() as {
        data: { sourceCapabilities: { agentHarness: Record<string, unknown>[] } };
      };
      assert.equal(res.status, 200);
      assert.equal(body.data.sourceCapabilities.agentHarness.length, 1);
      const entry = body.data.sourceCapabilities.agentHarness[0];
      assert.deepEqual(entry, {
        capabilityId: "xanthil.synthetic",
        contractVersion: "1.0",
        displayName: "Synthetic Test Capability",
        allowedSafetyClasses: ["derived"],
        readOnly: true,
      });
      // Public shape only: no adapter, no path, no connection detail.
      assert.deepEqual(Object.keys(entry).sort(), [
        "allowedSafetyClasses", "capabilityId", "contractVersion", "displayName", "readOnly",
      ]);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test("registry reflection participates in ETag computation", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-cap-etag-"));
    try {
      const registry = createStaticAgentHarnessRegistry([
        { descriptor: SYNTHETIC_DESCRIPTOR, adapter: SYNTHETIC_ADAPTER },
      ]);
      const { baseUrl } = await startRuntime({
        dataRoot,
        workspacePort: createFakeWorkspacePort(),
        agentHarnessRegistry: registry,
        host: "127.0.0.1",
        port: 0,
      });
      const url = `${baseUrl}/api/analysis-projects/v1/capabilities`;
      const first = await fetch(url);
      const etag = first.headers.get("etag");
      assert.ok(etag, "capabilities response must carry an ETag");
      const second = await fetch(url, { headers: { "If-None-Match": etag! } });
      assert.equal(second.status, 304);
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test("a throwing registry fails closed to an empty list", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "xanthil-cap-throw-"));
    try {
      const badRegistry = {
        listCapabilities: (): readonly AgentHarnessCapabilityDescriptor[] => {
          throw new Error("registry internals must not leak: /secret/path token=sk-123");
        },
        resolve: () => null,
      };
      const { baseUrl } = await startRuntime({
        dataRoot,
        workspacePort: createFakeWorkspacePort(),
        agentHarnessRegistry: badRegistry,
        host: "127.0.0.1",
        port: 0,
      });
      const res = await fetch(`${baseUrl}/api/analysis-projects/v1/capabilities`);
      const body = await res.json() as { data: { sourceCapabilities: { agentHarness: unknown[] } } };
      assert.equal(res.status, 200);
      assert.deepEqual(body.data.sourceCapabilities.agentHarness, []);
      assert.ok(!JSON.stringify(body).includes("/secret/path"));
      assert.ok(!JSON.stringify(body).includes("sk-123"));
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});
