/**
 * AgentHarness read-only adapter port tests (WCA-07).
 *
 * Uses synthetic adapter fixtures only. No real AgentHarness, WorkCanger,
 * draw_data, clean_data, or user Evidence is touched.
 *
 * Covers:
 * - default empty registry: describe/check/read fail closed
 * - malformed identity inputs fail closed with stable codes
 * - unknown capability vs unknown contract version
 * - adapter echo mismatch / protocol violations -> capability_contract_mismatch
 * - adapter throws with secrets/paths in message -> no leak in summary
 * - safety policy: disallowed safetyClass -> unsafe_evidence
 * - read-only protocol: port exposes exactly 3 operations
 * - static source scan: no writeback verbs, no forbidden dependencies
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  createAgentHarnessPort,
  createEmptyAgentHarnessRegistry,
  createStaticAgentHarnessRegistry,
} from "../adapters/agentharness/index.ts";
import type {
  AgentHarnessCapabilityDescriptor,
  AgentHarnessPortFailure,
  AgentHarnessSourceAdapter,
  AgentHarnessSourceCheck,
  AgentHarnessSourceRead,
} from "../contracts/agentharness-port.ts";

const SUMMARIES = {
  unknown: "Unknown AgentHarness capability.",
  mismatch: "AgentHarness capability contract version is not supported.",
  unavailable: "AgentHarness source is unavailable.",
  unsafe: "AgentHarness source content is not permitted by the capability safety policy.",
} as const;

const DESCRIPTOR: AgentHarnessCapabilityDescriptor = {
  capabilityId: "xanthil.synthetic",
  contractVersion: "1.0",
  displayName: "Synthetic Test Capability",
  allowedSafetyClasses: ["derived"],
  readOnly: true,
};

function makeCheck(overrides: Partial<AgentHarnessSourceCheck> = {}): AgentHarnessSourceCheck {
  return {
    status: "available",
    observedContractVersion: "1.0",
    observedSourceVersion: "rev-1",
    diagnosticCode: null,
    diagnosticSummary: null,
    ...overrides,
  };
}

function makeRead(overrides: Partial<AgentHarnessSourceRead> = {}): AgentHarnessSourceRead {
  return {
    safetyClass: "derived",
    mediaType: "application/json",
    observedSourceVersion: "rev-1",
    declaredByteSize: 4,
    openContent: async function* () {
      yield new Uint8Array([1, 2, 3, 4]);
    },
    ...overrides,
  };
}

function makeHappyAdapter(): AgentHarnessSourceAdapter {
  return {
    describe: () => DESCRIPTOR,
    check: () => makeCheck(),
    read: () => makeRead(),
  };
}

function staticRegistry(adapter: AgentHarnessSourceAdapter = makeHappyAdapter()) {
  return createStaticAgentHarnessRegistry([{ descriptor: DESCRIPTOR, adapter }]);
}

function expectFailure(result: { kind: string }, code: AgentHarnessPortFailure["code"], summary: string) {
  assert.equal(result.kind, "failure");
  const f = result as AgentHarnessPortFailure;
  assert.equal(f.code, code);
  assert.equal(f.summary, summary);
}

// ============================================================================
// Default registry (empty / unavailable)
// ============================================================================

describe("AgentHarness port: default empty registry", () => {
  const port = createAgentHarnessPort(createEmptyAgentHarnessRegistry());

  test("describeCapability fails closed capability_not_supported", async () => {
    expectFailure(await port.describeCapability("xanthil.synthetic", "1.0"), "capability_not_supported", SUMMARIES.unknown);
  });

  test("checkSource fails closed capability_not_supported", async () => {
    expectFailure(await port.checkSource("xanthil.synthetic", "1.0", "obj/1"), "capability_not_supported", SUMMARIES.unknown);
  });

  test("readSource fails closed capability_not_supported", async () => {
    expectFailure(await port.readSource("xanthil.synthetic", "1.0", "obj/1"), "capability_not_supported", SUMMARIES.unknown);
  });
});

// ============================================================================
// Identity input validation (original form, fail closed)
// ============================================================================

describe("AgentHarness port: identity input validation", () => {
  const port = createAgentHarnessPort(staticRegistry());

  test("malformed capabilityId -> capability_not_supported", async () => {
    for (const bad of ["", "BAD ID", "UPPER", "has space", "a/b", "-lead"]) {
      expectFailure(await port.describeCapability(bad, "1.0"), "capability_not_supported", SUMMARIES.unknown);
    }
  });

  test("malformed contractVersion -> capability_contract_mismatch", async () => {
    for (const bad of ["", "1", "v1.0", "1.0.0", "latest", "1.x"]) {
      expectFailure(await port.describeCapability("xanthil.synthetic", bad), "capability_contract_mismatch", SUMMARIES.mismatch);
    }
  });

  test("malformed sourceObjectKey -> source_unavailable (check + read)", async () => {
    for (const bad of ["", "has space", "white\tspace", "x".repeat(513)]) {
      expectFailure(await port.checkSource("xanthil.synthetic", "1.0", bad), "source_unavailable", SUMMARIES.unavailable);
      expectFailure(await port.readSource("xanthil.synthetic", "1.0", bad), "source_unavailable", SUMMARIES.unavailable);
    }
  });

  test("invalid identity is never converted or laundered before failing closed", async () => {
    // A key that fails the original-form check must fail even though it could
    // be hashed/namespaced into a valid-looking identity.
    const result = await port.readSource("xanthil.synthetic", "1.0", "illegal key with spaces");
    expectFailure(result, "source_unavailable", SUMMARIES.unavailable);
  });
});

// ============================================================================
// Unknown capability / version
// ============================================================================

describe("AgentHarness port: unknown capability and version", () => {
  const port = createAgentHarnessPort(staticRegistry());

  test("unknown capabilityId -> capability_not_supported", async () => {
    expectFailure(await port.describeCapability("no.such.capability", "1.0"), "capability_not_supported", SUMMARIES.unknown);
  });

  test("known capability, unknown contractVersion -> capability_contract_mismatch", async () => {
    expectFailure(await port.describeCapability("xanthil.synthetic", "2.0"), "capability_contract_mismatch", SUMMARIES.mismatch);
    expectFailure(await port.checkSource("xanthil.synthetic", "2.0", "obj/1"), "capability_contract_mismatch", SUMMARIES.mismatch);
    expectFailure(await port.readSource("xanthil.synthetic", "2.0", "obj/1"), "capability_contract_mismatch", SUMMARIES.mismatch);
  });
});

// ============================================================================
// Happy paths
// ============================================================================

describe("AgentHarness port: happy paths", () => {
  const port = createAgentHarnessPort(staticRegistry());

  test("describeCapability returns a whitelisted descriptor", async () => {
    const result = await port.describeCapability("xanthil.synthetic", "1.0");
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(result.descriptor, DESCRIPTOR);
    assert.deepEqual(Object.keys(result.descriptor).sort(), [
      "allowedSafetyClasses", "capabilityId", "contractVersion", "displayName", "readOnly",
    ]);
  });

  test("checkSource returns a valid check result", async () => {
    const result = await port.checkSource("xanthil.synthetic", "1.0", "obj/1");
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.check.status, "available");
    assert.equal(result.check.observedSourceVersion, "rev-1");
  });

  test("checkSource source_not_found is a success check result, not a failure", async () => {
    const adapter: AgentHarnessSourceAdapter = {
      describe: () => DESCRIPTOR,
      check: () => makeCheck({ status: "source_not_found", observedSourceVersion: null }),
      read: () => makeRead(),
    };
    const p = createAgentHarnessPort(staticRegistry(adapter));
    const result = await p.checkSource("xanthil.synthetic", "1.0", "obj/missing");
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.check.status, "source_not_found");
  });

  test("readSource returns opaque content stream and whitelisted fields", async () => {
    const result = await port.readSource("xanthil.synthetic", "1.0", "obj/1");
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(Object.keys(result.read).sort(), [
      "declaredByteSize", "mediaType", "observedSourceVersion", "openContent", "safetyClass",
    ]);
    const chunks: Uint8Array[] = [];
    for await (const chunk of result.read.openContent()) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from([1, 2, 3, 4]));
  });
});

// ============================================================================
// Adapter protocol violations (fail closed)
// ============================================================================

describe("AgentHarness port: adapter protocol violations", () => {
  test("describe echo mismatch -> capability_contract_mismatch", async () => {
    const adapter: AgentHarnessSourceAdapter = {
      describe: () => ({ ...DESCRIPTOR, contractVersion: "9.9" }),
      check: () => makeCheck(),
      read: () => makeRead(),
    };
    const port = createAgentHarnessPort(staticRegistry(adapter));
    expectFailure(await port.describeCapability("xanthil.synthetic", "1.0"), "capability_contract_mismatch", SUMMARIES.mismatch);
  });

  test("check with unknown status -> capability_contract_mismatch", async () => {
    const adapter: AgentHarnessSourceAdapter = {
      describe: () => DESCRIPTOR,
      check: () => makeCheck({ status: "weird_status" as AgentHarnessSourceCheck["status"] }),
      read: () => makeRead(),
    };
    const port = createAgentHarnessPort(staticRegistry(adapter));
    expectFailure(await port.checkSource("xanthil.synthetic", "1.0", "obj/1"), "capability_contract_mismatch", SUMMARIES.mismatch);
  });

  test("read with malformed result -> capability_contract_mismatch", async () => {
    const adapter: AgentHarnessSourceAdapter = {
      describe: () => DESCRIPTOR,
      check: () => makeCheck(),
      read: () => makeRead({ openContent: "not-a-function" as unknown as AgentHarnessSourceRead["openContent"] }),
    };
    const port = createAgentHarnessPort(staticRegistry(adapter));
    expectFailure(await port.readSource("xanthil.synthetic", "1.0", "obj/1"), "capability_contract_mismatch", SUMMARIES.mismatch);
  });

  test("describe with invalid descriptor -> capability_contract_mismatch", async () => {
    const adapter: AgentHarnessSourceAdapter = {
      describe: () => ({ ...DESCRIPTOR, displayName: "" }),
      check: () => makeCheck(),
      read: () => makeRead(),
    };
    const port = createAgentHarnessPort(staticRegistry(adapter));
    expectFailure(await port.describeCapability("xanthil.synthetic", "1.0"), "capability_contract_mismatch", SUMMARIES.mismatch);
  });

  test("inconsistent registry (adapter resolved without descriptor) -> capability_contract_mismatch", async () => {
    const inconsistent = {
      listCapabilities: (): readonly AgentHarnessCapabilityDescriptor[] => [],
      resolve: (): AgentHarnessSourceAdapter => makeHappyAdapter(),
    };
    const port = createAgentHarnessPort(inconsistent);
    expectFailure(await port.describeCapability("xanthil.synthetic", "1.0"), "capability_contract_mismatch", SUMMARIES.mismatch);
    expectFailure(await port.checkSource("xanthil.synthetic", "1.0", "obj/1"), "capability_contract_mismatch", SUMMARIES.mismatch);
    expectFailure(await port.readSource("xanthil.synthetic", "1.0", "obj/1"), "capability_contract_mismatch", SUMMARIES.mismatch);
  });
});

// ============================================================================
// Safety policy
// ============================================================================

describe("AgentHarness port: safety policy", () => {
  test("read safetyClass outside allowedSafetyClasses -> unsafe_evidence", async () => {
    const adapter: AgentHarnessSourceAdapter = {
      describe: () => DESCRIPTOR,
      check: () => makeCheck(),
      read: () => makeRead({ safetyClass: "restricted_raw" }),
    };
    const port = createAgentHarnessPort(staticRegistry(adapter));
    expectFailure(await port.readSource("xanthil.synthetic", "1.0", "obj/1"), "unsafe_evidence", SUMMARIES.unsafe);
  });

  test("restricted_raw read succeeds only when the descriptor allows it", async () => {
    const restrictedDescriptor: AgentHarnessCapabilityDescriptor = {
      ...DESCRIPTOR,
      allowedSafetyClasses: ["restricted_raw"],
    };
    const adapter: AgentHarnessSourceAdapter = {
      describe: () => restrictedDescriptor,
      check: () => makeCheck(),
      read: () => makeRead({ safetyClass: "restricted_raw" }),
    };
    const port = createAgentHarnessPort(
      createStaticAgentHarnessRegistry([{ descriptor: restrictedDescriptor, adapter }]),
    );
    const result = await port.readSource("xanthil.synthetic", "1.0", "obj/1");
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.read.safetyClass, "restricted_raw");
    // Opaque contract: the read exposes bytes via openContent only; no parsed
    // rows/columns/samples field exists on the result type.
    assert.equal(typeof result.read.openContent, "function");
  });

  test("read with unknown safetyClass -> capability_contract_mismatch", async () => {
    const adapter: AgentHarnessSourceAdapter = {
      describe: () => DESCRIPTOR,
      check: () => makeCheck(),
      read: () => makeRead({ safetyClass: "top_secret" as AgentHarnessSourceRead["safetyClass"] }),
    };
    const port = createAgentHarnessPort(staticRegistry(adapter));
    expectFailure(await port.readSource("xanthil.synthetic", "1.0", "obj/1"), "capability_contract_mismatch", SUMMARIES.mismatch);
  });
});

// ============================================================================
// No-leak: adapter errors must not propagate internals
// ============================================================================

describe("AgentHarness port: no-leak failure summaries", () => {
  const SECRET_PATH = "/Users/alice/secret-harness/data.sqlite";
  const SECRET_TOKEN = "token=sk-live-abc123";

  function throwingAdapter(): AgentHarnessSourceAdapter {
    const bomb = (): never => {
      throw new Error(`connect failed at ${SECRET_PATH} with ${SECRET_TOKEN}\n    at internal.frame (secret.ts:1:1)`);
    };
    return { describe: bomb, check: bomb, read: bomb };
  }

  test("adapter throw on describe -> capability_not_supported without internals", async () => {
    const port = createAgentHarnessPort(staticRegistry(throwingAdapter()));
    const result = await port.describeCapability("xanthil.synthetic", "1.0");
    expectFailure(result, "capability_not_supported", SUMMARIES.unknown);
    const f = result as AgentHarnessPortFailure;
    assert.ok(!f.summary.includes(SECRET_PATH));
    assert.ok(!f.summary.includes(SECRET_TOKEN));
    assert.ok(!f.summary.includes("secret.ts"));
  });

  test("adapter throw on check/read -> source_unavailable without internals", async () => {
    const port = createAgentHarnessPort(staticRegistry(throwingAdapter()));
    for (const result of [
      await port.checkSource("xanthil.synthetic", "1.0", "obj/1"),
      await port.readSource("xanthil.synthetic", "1.0", "obj/1"),
    ]) {
      expectFailure(result, "source_unavailable", SUMMARIES.unavailable);
      const f = result as AgentHarnessPortFailure;
      assert.ok(!f.summary.includes(SECRET_PATH));
      assert.ok(!f.summary.includes(SECRET_TOKEN));
      assert.ok(!f.summary.includes("secret.ts"));
    }
  });

  test("registry throw -> fail closed without internals", async () => {
    const badRegistry = {
      listCapabilities: (): readonly AgentHarnessCapabilityDescriptor[] => {
        throw new Error(`registry db at ${SECRET_PATH} corrupted, ${SECRET_TOKEN}`);
      },
      resolve: () => null,
    };
    const port = createAgentHarnessPort(badRegistry);
    const result = await port.describeCapability("xanthil.synthetic", "1.0");
    expectFailure(result, "capability_not_supported", SUMMARIES.unknown);
    assert.ok(!(result as AgentHarnessPortFailure).summary.includes(SECRET_PATH));
  });
});

// ============================================================================
// Registry construction-time validation
// ============================================================================

describe("AgentHarness static registry: construction-time validation", () => {
  test("duplicate capability identity fails closed at wiring time", () => {
    assert.throws(
      () =>
        createStaticAgentHarnessRegistry([
          { descriptor: DESCRIPTOR, adapter: makeHappyAdapter() },
          { descriptor: DESCRIPTOR, adapter: makeHappyAdapter() },
        ]),
      /Duplicate AgentHarness capability registration/,
    );
  });

  test("invalid descriptor fails closed at wiring time", () => {
    for (const bad of [
      { ...DESCRIPTOR, capabilityId: "BAD ID" },
      { ...DESCRIPTOR, contractVersion: "latest" },
      { ...DESCRIPTOR, displayName: "" },
      { ...DESCRIPTOR, allowedSafetyClasses: [] },
      { ...DESCRIPTOR, allowedSafetyClasses: ["bogus" as never] },
      { ...DESCRIPTOR, readOnly: false as never },
    ]) {
      assert.throws(() => createStaticAgentHarnessRegistry([{ descriptor: bad, adapter: makeHappyAdapter() }]));
    }
  });

  test("listCapabilities returns defensive copies", () => {
    const registry = staticRegistry();
    const list = registry.listCapabilities();
    const first = list[0];
    assert.ok(first);
    assert.notEqual(first.allowedSafetyClasses, DESCRIPTOR.allowedSafetyClasses);
    assert.deepEqual(first, DESCRIPTOR);
  });
});

// ============================================================================
// Read-only protocol
// ============================================================================

describe("AgentHarness port: read-only protocol", () => {
  test("port exposes exactly describeCapability / checkSource / readSource", () => {
    const port = createAgentHarnessPort(staticRegistry());
    assert.deepEqual(Object.keys(port).sort(), ["checkSource", "describeCapability", "readSource"]);
    for (const key of Object.keys(port)) {
      assert.equal(typeof (port as unknown as Record<string, unknown>)[key], "function");
    }
  });
});

// ============================================================================
// Static regression scan: no writeback verbs, no forbidden dependencies
// ============================================================================

describe("AgentHarness adapter: static regression scan", () => {
  const adapterDir = fileURLToPath(new URL("../adapters/agentharness/", import.meta.url));
  const contractFile = fileURLToPath(new URL("../contracts/agentharness-port.ts", import.meta.url));
  const adapterSources = readdirSync(adapterDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: `adapters/agentharness/${f}`, src: readFileSync(join(adapterDir, f), "utf8") }));
  const contractSource = { file: "contracts/agentharness-port.ts", src: readFileSync(contractFile, "utf8") };
  const all = [...adapterSources, contractSource];

  // Docblocks legitimately name the forbidden concepts ("no write...", "LLM");
  // scan code only.
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  test("no external package imports; only port-contract and sibling imports", () => {
    const importRe = /from\s+"([^"]+)"/g;
    for (const { file, src } of all) {
      for (const match of src.matchAll(importRe)) {
        const target = match[1] ?? "";
        if (file.startsWith("adapters/")) {
          assert.ok(
            target === "../../contracts/agentharness-port.ts" || target.startsWith("./"),
            `${file} imports forbidden module: ${target}`,
          );
        } else {
          assert.fail(`${file} (contract) must not import anything, found: ${target}`);
        }
      }
    }
  });

  test("no writeback or mutation method definitions/calls", () => {
    const verbRe = /\b(write|writeback|update|delete|mutate|push|sync|importToHarness)[A-Za-z]*\s*\(/;
    for (const { file, src } of all) {
      assert.ok(!verbRe.test(stripComments(src)), `${file} contains a writeback-verb call matching ${verbRe}`);
    }
  });

  test("no DB, HTTP, LLM, engine, importer, or data-exploration dependencies", () => {
    const depRe = /node:sqlite|DatabaseSync|\bfetch\s*\(|pi-engine|extraction-tools|DataExploration|importer|\bllm\b/i;
    for (const { file, src } of all) {
      assert.ok(!depRe.test(stripComments(src)), `${file} references a forbidden dependency matching ${depRe}`);
    }
  });
});
