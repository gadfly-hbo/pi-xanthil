import assert from "node:assert/strict";
import test from "node:test";
import { computeFieldProfiles } from "./crowd-import.ts";

test("computeFieldProfiles exposes top values for low-cardinality fields", () => {
  const profiles = computeFieldProfiles({
    columns: ["city"],
    rows: [
      { city: "Shanghai" },
      { city: "Shanghai" },
      { city: "Beijing" },
      { city: "" },
    ],
  });

  assert.equal(profiles.length, 1);
  assert.deepEqual(profiles[0]?.topValues, [
    { value: "Shanghai", count: 2, ratio: 0.5 },
    { value: "Beijing", count: 1, ratio: 0.25 },
  ]);
});

test("computeFieldProfiles suppresses top values for high-cardinality raw identifiers", () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    user_id: `u_${String(i + 1).padStart(4, "0")}`,
  }));

  const profiles = computeFieldProfiles({ columns: ["user_id"], rows });

  assert.equal(profiles[0]?.uniqueCount, 200);
  assert.deepEqual(profiles[0]?.topValues, []);
});

test("computeFieldProfiles suppresses top values for identifier-like fields even in small samples", () => {
  const profiles = computeFieldProfiles({
    columns: ["user_id", "phone"],
    rows: [
      { user_id: "u_001", phone: "13800000001" },
      { user_id: "u_002", phone: "13800000002" },
    ],
  });

  assert.deepEqual(profiles.find((p) => p.field === "user_id")?.topValues, []);
  assert.deepEqual(profiles.find((p) => p.field === "phone")?.topValues, []);
});

test("computeFieldProfiles computes numeric ranges without spreading full arrays", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ score: String(i - 500) }));

  const profiles = computeFieldProfiles({ columns: ["score"], rows });

  assert.equal(profiles[0]?.inferredType, "number");
  assert.deepEqual(profiles[0]?.numericRange, { min: -500, max: 499 });
});
