import assert from "node:assert/strict";
import test from "node:test";
import { distillSubSkillsFromTraces, type SkillTrace } from "./skill-distillation.ts";

test("distillSubSkillsFromTraces extracts diverse 2-5 action micro-skills and relations", () => {
  const traces: SkillTrace[] = [
    {
      id: "s1",
      outcome: "success",
      actions: [
        { text: "Inspect schema columns" },
        { text: "Draft SELECT aggregation" },
        { text: "Validate SQL result rows" },
        { text: "Write concise finding" },
      ],
    },
    {
      id: "s2",
      outcome: "success",
      actions: [
        { text: "Inspect schema columns" },
        { text: "Draft SELECT aggregation" },
        { text: "Validate SQL result rows" },
        { text: "Write concise finding" },
      ],
    },
    {
      id: "s3",
      outcome: "success",
      actions: [
        { text: "Choose comparison chart" },
        { text: "Encode metric on y axis" },
        { text: "Check dashboard interaction" },
      ],
    },
    {
      id: "f1",
      outcome: "failure",
      failureReason: "SQL used unsafe DELETE",
      actions: [
        { text: "Inspect schema columns" },
        { text: "Draft SELECT aggregation" },
        { text: "Validate SQL result rows" },
      ],
    },
  ];

  const result = distillSubSkillsFromTraces(traces, { minSupport: 1, maxCandidates: 4 });

  assert.ok(result.candidates.length >= 2);
  assert.ok(result.candidates.every((candidate) => candidate.actions.length >= 2 && candidate.actions.length <= 5));
  assert.ok(result.candidates.some((candidate) => candidate.actions.join(" ").includes("inspect schema columns")));
  assert.ok(result.candidates.some((candidate) => candidate.actions.join(" ").includes("choose comparison chart")));
  assert.ok(result.candidates.some((candidate) => candidate.targetedPatch?.includes("unsafe DELETE")));
  assert.ok(result.relations.some((relation) => relation.similarity > 0 && ["reuse", "merge", "keep_diverse"].includes(relation.decision)));
});

