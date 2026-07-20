/**
 * Deterministic canonical JSON UTF-8 serializer.
 *
 * Contract requirements (P0-64, schema-v1-and-migrations.md):
 * - Recursively sort object keys by Unicode code point.
 * - Preserve array order.
 * - No extra whitespace.
 * - UTF-8 encoded output.
 * - Reject undefined, function, symbol, BigInt, non-finite number, circular references.
 * - Must NOT rely on JSON.stringify insertion order.
 */

const SEEN = Symbol("xanthil.analysisProjects.canonicalJson.seen");

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

function isObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object";
}

/**
 * Compare two strings by UTF-16 code unit order (RFC 8785 §3.2.3).
 * Object member names are sorted lexicographically by their UTF-16 code units,
 * NOT by Unicode code point. For BMP characters the two orders coincide; they
 * differ for supplementary-plane characters (surrogate pairs).
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
function compareUtf16Units(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  const min = aLen < bLen ? aLen : bLen;
  for (let i = 0; i < min; i++) {
    const diff = a.charCodeAt(i) - b.charCodeAt(i);
    if (diff !== 0) return diff;
  }
  return aLen - bLen;
}

/**
 * Reject strings containing lone (unpaired) surrogates. RFC 8785 requires
 * input to be valid Unicode; ill-formed UTF-16 must fail closed.
 */
function assertNoLoneSurrogates(val: string, path: string): void {
  for (let i = 0; i < val.length; i++) {
    const code = val.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // high surrogate must be followed by a low surrogate
      const next = val.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new CanonicalJsonError(`Lone high surrogate at ${path}: not valid Unicode (RFC 8785)`);
      }
      i++; // consume the paired low surrogate
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // low surrogate without preceding high surrogate
      throw new CanonicalJsonError(`Lone low surrogate at ${path}: not valid Unicode (RFC 8785)`);
    }
  }
}

/**
 * Serialize a single JSON value to canonical string form.
 * Uses a WeakSet for circular reference detection.
 */
function serializeValue(
  val: unknown,
  path: string,
  ancestors: WeakSet<object>,
): string {
  switch (typeof val) {
    case "string":
      assertNoLoneSurrogates(val, path);
      return JSON.stringify(val);
    case "number":
      if (!Number.isFinite(val)) {
        throw new CanonicalJsonError(
          `Non-finite number at ${path}: ${val}`,
        );
      }
      return JSON.stringify(val);
    case "boolean":
      return JSON.stringify(val);
    case "bigint":
      throw new CanonicalJsonError(`BigInt at ${path}: not allowed`);
    case "symbol":
      throw new CanonicalJsonError(`Symbol at ${path}: not allowed`);
    case "function":
      throw new CanonicalJsonError(`Function at ${path}: not allowed`);
    case "undefined":
      throw new CanonicalJsonError(`undefined at ${path}: not allowed`);
    case "object":
      break;
  }

  if (val === null) {
    return "null";
  }

  if (!isObject(val)) {
    throw new CanonicalJsonError(`Unknown type at ${path}`);
  }

  if (ancestors.has(val)) {
    throw new CanonicalJsonError(`Circular reference at ${path}`);
  }

  ancestors.add(val);

  try {
    if (Array.isArray(val)) {
      const parts: string[] = [];
      for (let i = 0; i < val.length; i++) {
        parts.push(serializeValue(val[i], `${path}[${i}]`, ancestors));
      }
      return `[${parts.join(",")}]`;
    }

    // Object: sort keys by UTF-16 code unit (RFC 8785 §3.2.3)
    const keys = Object.keys(val).sort(compareUtf16Units);
    const parts: string[] = [];
    for (const key of keys) {
      assertNoLoneSurrogates(key, `${path}.<key>`);
      const value = (val as Record<string, unknown>)[key];
      // Contract: reject undefined - do NOT silently skip like JSON.stringify
      if (value === undefined) {
        throw new CanonicalJsonError(
          `undefined at ${path}.${key}: not allowed in canonical JSON`,
        );
      }
      parts.push(
        `${JSON.stringify(key)}:${serializeValue(value, `${path}.${key}`, ancestors)}`,
      );
    }
    return `{${parts.join(",")}}`;
  } finally {
    ancestors.delete(val);
  }
}

/**
 * Serialize a value to canonical JSON string.
 * Object keys are sorted by Unicode code point; arrays preserve order.
 * Throws CanonicalJsonError for unsupported types or circular references.
 */
export function canonicalJsonStringify(val: unknown): string {
  const ancestors = new WeakSet<object>();
  return serializeValue(val, "$", ancestors);
}

/**
 * Serialize a value to canonical JSON UTF-8 bytes (Uint8Array).
 */
export function canonicalJsonSerialize(val: unknown): Uint8Array {
  const str = canonicalJsonStringify(val);
  return new TextEncoder().encode(str);
}
