import assert from "node:assert/strict";
import test from "node:test";
import { expandCommand } from "./command-expand.ts";
import type { XanCommand } from "./types.ts";

function command(overrides: Partial<XanCommand>): XanCommand {
  return {
    id: "cmd_1",
    name: "brief",
    enabled: true,
    template: "Analyze {{1}} with {{2}}. Args={{args}}",
    source: "custom",
    ...overrides,
  };
}

test("expandCommand expands positional arguments", () => {
  const result = expandCommand("/brief sales \"north region\"", [command({})]);

  assert.equal(result.expandedText, "Analyze sales with north region. Args=sales \"north region\"");
  assert.deepEqual(result.skillSlugs, []);
});

test("expandCommand expands named parameters and returns skill slugs", () => {
  const result = expandCommand("/brief --dataset=orders --scope \"last 30 days\"", [
    command({
      template: "Dataset={{param.dataset}} Scope={{param.scope}}",
      skillSlugs: ["retention-analysis"],
    }),
  ]);

  assert.equal(result.expandedText, "Dataset=orders Scope=last 30 days");
  assert.deepEqual(result.skillSlugs, ["retention-analysis"]);
});

test("expandCommand expands quoted equals named parameters", () => {
  const result = expandCommand("/brief --dataset=\"north orders\" --metric=gmv", [
    command({ template: "Dataset={{param.dataset}} Metric={{param.metric}}" }),
  ]);

  assert.equal(result.expandedText, "Dataset=north orders Metric=gmv");
});

test("expandCommand passes through unknown or disabled commands", () => {
  assert.deepEqual(expandCommand("/missing a b", [command({})]), {
    expandedText: "/missing a b",
    skillSlugs: [],
  });
  assert.deepEqual(expandCommand("/brief a b", [command({ enabled: false })]), {
    expandedText: "/brief a b",
    skillSlugs: [],
  });
});

test("expandCommand leaves missing arguments empty", () => {
  const result = expandCommand("/brief only-one", [
    command({ template: "First={{1}} Second={{2}} Named={{param.metric}}" }),
  ]);

  assert.equal(result.expandedText, "First=only-one Second= Named=");
});
