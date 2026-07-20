/**
 * Tests for canonical JSON serializer.
 * Contract: recursive key sort by Unicode code point, preserve array order,
 * no extra whitespace, reject unsupported types, circular reference detection.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJsonStringify,
  canonicalJsonSerialize,
  CanonicalJsonError,
} from "../persistence/canonical-json.ts";
import { sha256HexBytes } from "../persistence/sha256.ts";

describe("canonicalJsonStringify - basic types", () => {
  test("null", () => {
    assert.equal(canonicalJsonStringify(null), "null");
  });

  test("boolean", () => {
    assert.equal(canonicalJsonStringify(true), "true");
    assert.equal(canonicalJsonStringify(false), "false");
  });

  test("number", () => {
    assert.equal(canonicalJsonStringify(42), "42");
    assert.equal(canonicalJsonStringify(-1), "-1");
    assert.equal(canonicalJsonStringify(3.14), "3.14");
    assert.equal(canonicalJsonStringify(0), "0");
  });

  test("string", () => {
    assert.equal(canonicalJsonStringify("hello"), '"hello"');
    assert.equal(canonicalJsonStringify(""), '""');
    assert.equal(canonicalJsonStringify("a\"b"), '"a\\"b"');
  });

  test("empty object", () => {
    assert.equal(canonicalJsonStringify({}), "{}");
  });

  test("empty array", () => {
    assert.equal(canonicalJsonStringify([]), "[]");
  });
});

describe("canonicalJsonStringify - key sorting", () => {
  test("object keys sorted by Unicode code point regardless of insertion order", () => {
    const a = { c: 1, a: 2, b: 3 };
    const b = { a: 2, b: 3, c: 1 };
    const c = { b: 3, c: 1, a: 2 };

    const sa = canonicalJsonStringify(a);
    const sb = canonicalJsonStringify(b);
    const sc = canonicalJsonStringify(c);

    assert.equal(sa, sb, "a and b should produce same canonical form");
    assert.equal(sb, sc, "b and c should produce same canonical form");
    assert.equal(sa, '{"a":2,"b":3,"c":1}');
  });

  test("same keys different insertion order produce same hash", () => {
    const obj1 = { z: 1, y: 2, x: 3, w: 4, v: 5 };
    const obj2 = { v: 5, w: 4, x: 3, y: 2, z: 1 };

    const hash1 = sha256HexBytes(canonicalJsonSerialize(obj1));
    const hash2 = sha256HexBytes(canonicalJsonSerialize(obj2));

    assert.equal(hash1, hash2, "different insertion order must produce same hash");
  });

  test("nested object keys sorted recursively", () => {
    const obj = { outer: { z: 1, a: 2 }, inner: { b: 3, a: 1 } };
    const result = canonicalJsonStringify(obj);
    assert.equal(result, '{"inner":{"a":1,"b":3},"outer":{"a":2,"z":1}}');
  });

  test("Unicode code point ordering (not byte ordering)", () => {
    // 'Z' (90) < 'a' (97) in ASCII, so Z comes before a
    const obj = { a: 1, Z: 2 };
    assert.equal(canonicalJsonStringify(obj), '{"Z":2,"a":1}');
  });
});

describe("canonicalJsonStringify - RFC 8785 conformance", () => {
  test("keys sorted by UTF-16 code unit, not Unicode code point", () => {
    // U+F900 (豈, BMP, single UTF-16 unit 0xF900) vs U+1D4D0 (𝓐, supplementary,
    // surrogate pair \uD835\uDCD0). Under UTF-16 unit sorting the supplementary
    // key's high surrogate 0xD835 < 0xF900, so 𝓐 sorts BEFORE 豈. Under code
    // point sorting 0xF900 < 0x1D4D0 would put 豈 first. RFC 8785 mandates the
    // former.
    const obj: Record<string, number> = {};
    obj["\uF900"] = 1; // 豈
    obj["\uD835\uDCD0"] = 2; // 𝓐
    const result = canonicalJsonStringify(obj);
    assert.equal(result, '{"\uD835\uDCD0":2,"\uF900":1}');
  });

  test("lone high surrogate rejected", () => {
    assert.throws(() => canonicalJsonStringify({ "\uD800": 1 }), /Lone high surrogate/);
  });

  test("lone low surrogate rejected", () => {
    assert.throws(() => canonicalJsonStringify({ "\uDC00": 1 }), /Lone low surrogate/);
  });

  test("paired surrogates (valid supplementary) accepted", () => {
    const s = "\uD835\uDCD0"; // 𝓐
    const out = canonicalJsonStringify(s);
    // Accepted (no throw) and round-trips through JSON.parse.
    assert.equal(JSON.parse(out), s);
  });

  test("RFC 8785 example: nested object canonical form", () => {
    // From RFC 8785 §3.2.2.2 example structure (simplified, ASCII): keys sorted.
    const obj = { c: 1, b: [1, 2], a: { z: 1, y: 2 } };
    assert.equal(canonicalJsonStringify(obj), '{"a":{"y":2,"z":1},"b":[1,2],"c":1}');
  });
});

describe("canonicalJsonStringify - array order preserved", () => {
  test("array order is significant", () => {
    const a = [1, 2, 3];
    const b = [3, 2, 1];

    const hashA = sha256HexBytes(canonicalJsonSerialize(a));
    const hashB = sha256HexBytes(canonicalJsonSerialize(b));

    assert.notEqual(hashA, hashB, "different array order must produce different hash");
  });

  test("array elements are serialized in order", () => {
    assert.equal(canonicalJsonStringify([1, 2, 3]), "[1,2,3]");
  });

  test("nested arrays preserve order", () => {
    const obj = { items: [{ b: 2, a: 1 }, { d: 4, c: 3 }] };
    const result = canonicalJsonStringify(obj);
    assert.equal(result, '{"items":[{"a":1,"b":2},{"c":3,"d":4}]}');
  });
});

describe("canonicalJsonStringify - no extra whitespace", () => {
  test("no spaces after colons or commas", () => {
    const obj = { a: 1, b: [2, 3] };
    assert.equal(canonicalJsonStringify(obj), '{"a":1,"b":[2,3]}');
  });
});

describe("canonicalJsonStringify - rejection of unsupported types", () => {
  test("undefined is rejected", () => {
    assert.throws(() => canonicalJsonStringify(undefined), CanonicalJsonError);
  });

  test("function is rejected", () => {
    assert.throws(() => canonicalJsonStringify(() => 42), CanonicalJsonError);
  });

  test("symbol is rejected", () => {
    assert.throws(() => canonicalJsonStringify(Symbol("x")), CanonicalJsonError);
  });

  test("BigInt is rejected", () => {
    assert.throws(() => canonicalJsonStringify(42n), CanonicalJsonError);
  });

  test("NaN is rejected", () => {
    assert.throws(() => canonicalJsonStringify(NaN), CanonicalJsonError);
  });

  test("Infinity is rejected", () => {
    assert.throws(() => canonicalJsonStringify(Infinity), CanonicalJsonError);
    assert.throws(() => canonicalJsonStringify(-Infinity), CanonicalJsonError);
  });

  test("undefined values in objects are rejected (not silently skipped)", () => {
    const obj = { a: 1, b: undefined, c: 3 };
    assert.throws(() => canonicalJsonStringify(obj), CanonicalJsonError);
  });

  test("function value in object is rejected", () => {
    const obj = { a: 1, b: () => 42 };
    assert.throws(() => canonicalJsonStringify(obj), CanonicalJsonError);
  });
});

describe("canonicalJsonStringify - circular reference detection", () => {
  test("direct circular reference", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    assert.throws(() => canonicalJsonStringify(obj), CanonicalJsonError);
  });

  test("indirect circular reference", () => {
    const a: Record<string, unknown> = { name: "a" };
    const b: Record<string, unknown> = { name: "b" };
    a.ref = b;
    b.ref = a;
    assert.throws(() => canonicalJsonStringify(a), CanonicalJsonError);
  });

  test("same object referenced twice (not circular) works", () => {
    const child = { x: 1 };
    const parent = { a: child, b: child };
    const result = canonicalJsonStringify(parent);
    assert.equal(result, '{"a":{"x":1},"b":{"x":1}}');
  });
});

describe("canonicalJsonStringify - complex objects", () => {
  test("mixed nested structure", () => {
    const obj = {
      schemaVersion: "1.0",
      identity: { id: "abc", type: "requirement" },
      scope: { inScope: ["a", "b"], outOfScope: [] },
      nested: { z: { y: { x: 1 } }, a: 2 },
    };
    const result = canonicalJsonStringify(obj);
    // Verify keys are sorted at every level
    assert.match(result, /"a":2.*"z":/);
    assert.match(result, /"identity":\{.*"scope":\{/);
    assert.ok(result.indexOf('"identity"') < result.indexOf('"nested"'));
    assert.ok(result.indexOf('"identity"') < result.indexOf('"schemaVersion"'));
  });

  test("deterministic across multiple calls", () => {
    const obj = { b: [3, 2, 1], a: { z: 1, y: 2 } };
    const r1 = canonicalJsonStringify(obj);
    const r2 = canonicalJsonStringify(obj);
    assert.equal(r1, r2);
  });
});
