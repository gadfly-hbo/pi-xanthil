/**
 * HTTP body parsing and strict validation helpers.
 *
 * Contract (API-011, API-049, API-053):
 * - JSON body must be UTF-8, no BOM, no duplicate object keys, no unknown fields.
 * - Reject non-finite numbers and integers outside safe integer range.
 * - Path IDs must not appear in body.
 * - Content-Type must be application/json for JSON endpoints.
 */
import { ApplicationError } from "../contracts/envelope.ts";
import { isUuidV4 } from "../application/shared/runtime.ts";

export class BodyValidationError extends ApplicationError {}

export function readRequestBody(req: import("node:http").IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new BodyValidationError("payload_too_large", "Request body exceeds the maximum allowed size."));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (err) => reject(err));
  });
}

/** Detect duplicate keys in a JSON string without fully parsing values. */
function assertNoDuplicateKeys(json: string): void {
  const stack: Array<{ kind: "object"; keys: Set<string> } | { kind: "array" }> = [];
  let i = 0;
  const len = json.length;

  function skipWhitespace(): void {
    while (i < len && /\s/.test(json[i]!!)) i++;
  }

  function parseString(): string {
    if (json[i]!! !== '"') throw new Error("Expected string");
    i++;
    let result = "";
    while (i < len) {
      const c = json[i]!!;
      if (c === "\\") {
        i++;
        if (i >= len) throw new Error("Unterminated escape");
        const esc = json[i]!!;
        if (esc === "u") {
          i++;
          if (i + 4 > len) throw new Error("Invalid unicode escape");
          i += 4;
        } else {
          i++;
        }
      } else if (c === '"') {
        i++;
        return result;
      } else {
        result += c;
        i++;
      }
    }
    throw new Error("Unterminated string");
  }

  function parseValue(): void {
    skipWhitespace();
    if (i >= len) throw new Error("Unexpected end of JSON");
    const c = json[i]!!;
    if (c === "{") {
      i++;
      stack.push({ kind: "object", keys: new Set() });
      skipWhitespace();
      if (json[i]!! === "}") {
        i++;
        stack.pop();
        return;
      }
      while (true) {
        skipWhitespace();
        const key = parseString();
        const frame = stack[stack.length - 1];
        if (frame && frame.kind === "object") {
          if (frame.keys.has(key)) throw new Error(`Duplicate key: ${key}`);
          frame.keys.add(key);
        }
        skipWhitespace();
        if (json[i]!! !== ":") throw new Error("Expected ':'");
        i++;
        parseValue();
        skipWhitespace();
        if (json[i]!! === ",") {
          i++;
          continue;
        } else if (json[i]!! === "}") {
          i++;
          stack.pop();
          return;
        }
        throw new Error("Expected ',' or '}'");
      }
    } else if (c === "[") {
      i++;
      stack.push({ kind: "array" });
      skipWhitespace();
      if (json[i]!! === "]") {
        i++;
        stack.pop();
        return;
      }
      while (true) {
        parseValue();
        skipWhitespace();
        if (json[i]!! === ",") {
          i++;
          continue;
        } else if (json[i]!! === "]") {
          i++;
          stack.pop();
          return;
        }
        throw new Error("Expected ',' or ']'");
      }
    } else if (c === '"') {
      parseString();
    } else if (c === "t" || c === "f" || c === "n") {
      // true, false, null
      while (i < len && /[a-z]/.test(json[i]!!)) i++;
    } else if (c === "-" || (c >= "0" && c <= "9")) {
      while (i < len && /[\d.eE+\-]/.test(json[i]!!)) i++;
    } else {
      throw new Error(`Unexpected character: ${c}`);
    }
  }

  parseValue();
  skipWhitespace();
  if (i !== len) throw new Error("Trailing characters");
}

export function parseJsonStrict(body: Buffer): unknown {
  // BOM check
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
    throw new BodyValidationError("invalid_json", "JSON body must not contain a BOM.");
  }
  const text = body.toString("utf8");
  try {
    assertNoDuplicateKeys(text);
  } catch (err) {
    throw new BodyValidationError("invalid_json", `Duplicate key in JSON body: ${(err as Error).message}`);
  }
  try {
    const parsed = JSON.parse(text, validateJsonNumber);
    return parsed;
  } catch (err) {
    if (err instanceof BodyValidationError) throw err;
    throw new BodyValidationError("invalid_json", `Failed to parse JSON body: ${(err as Error).message}`);
  }
}

function validateJsonNumber(this: unknown, _key: string, value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new BodyValidationError("invalid_json", "JSON body contains a non-finite number.");
    if (Number.isInteger(value) && (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER)) {
      throw new BodyValidationError("invalid_json", "JSON body contains an unsafe integer.");
    }
  }
  return value;
}

export function validateObjectBody(
  parsed: unknown,
  allowedFields: readonly string[],
  requiredFields: readonly string[] = [],
): Record<string, unknown> {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BodyValidationError("invalid_json", "Request body must be a JSON object.");
  }
  const obj = parsed as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!allowedFields.includes(key)) {
      throw new BodyValidationError("validation_failed", `Unknown field in body: ${key}`, {
        fieldErrors: [{ fieldPath: `/${key}`, code: "unknown_field", summary: `Unknown field: ${key}` }],
      });
    }
  }
  for (const key of requiredFields) {
    if (!(key in obj) || obj[key] === undefined) {
      throw new BodyValidationError("validation_failed", `Missing required field: ${key}`, {
        fieldErrors: [{ fieldPath: `/${key}`, code: "required", summary: `Missing required field: ${key}` }],
      });
    }
  }
  return obj;
}

export function validateIdempotencyKey(header: string | undefined): string {
  if (!header || !isUuidV4(header)) {
    throw new BodyValidationError("validation_failed", "Idempotency-Key must be a UUID v4.", {
      fieldErrors: [{ fieldPath: "/headers/Idempotency-Key", code: "invalid_uuid", summary: "Idempotency-Key must be a UUID v4" }],
    });
  }
  return header;
}

export function validateUuidPathParam(value: string | undefined, name: string): string {
  if (!value || !isUuidV4(value)) {
    throw new BodyValidationError("resource_not_found", `${name} is not a valid resource id.`);
  }
  return value;
}

export function validateBcp47Locale(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(value)) {
    throw new BodyValidationError("validation_failed", "locale must be a valid BCP 47 language tag.", {
      fieldErrors: [{ fieldPath: "/locale", code: "format", summary: "locale must be a valid BCP 47 tag" }],
    });
  }
  return value;
}

export function validateIanaTimezone(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BodyValidationError("validation_failed", "timezone must be a non-empty IANA timezone identifier.", {
      fieldErrors: [{ fieldPath: "/timezone", code: "required", summary: "timezone must be a non-empty IANA identifier" }],
    });
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value.trim() });
  } catch {
    throw new BodyValidationError("validation_failed", "timezone is not a valid IANA timezone identifier.", {
      fieldErrors: [{ fieldPath: "/timezone", code: "invalid_timezone", summary: "timezone is not a valid IANA identifier" }],
    });
  }
  return value.trim();
}

export function validateMediaType(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z][a-zA-Z0-9!#$&\^_+.-]*\/[a-zA-Z][a-zA-Z0-9!#$&\^_+.-]*$/.test(value)) {
    throw new BodyValidationError("validation_failed", "mediaType must be a valid MIME type.", {
      fieldErrors: [{ fieldPath: "/mediaType", code: "format", summary: "mediaType must be a valid MIME type" }],
    });
  }
  return value;
}

export function validateNonEmptyString(value: unknown, fieldPath: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BodyValidationError("validation_failed", `${fieldPath} must be a non-empty string.`, {
      fieldErrors: [{ fieldPath, code: "empty", summary: `${fieldPath} must be a non-empty string` }],
    });
  }
  return value.trim();
}

export function validateBoolean(value: unknown, fieldPath: string): boolean {
  if (typeof value !== "boolean") {
    throw new BodyValidationError("validation_failed", `${fieldPath} must be a boolean.`, {
      fieldErrors: [{ fieldPath, code: "type", summary: `${fieldPath} must be a boolean` }],
    });
  }
  return value;
}

export function validateStringArray(value: unknown, fieldPath: string): string[] {
  if (!Array.isArray(value)) {
    throw new BodyValidationError("validation_failed", `${fieldPath} must be an array.`, {
      fieldErrors: [{ fieldPath, code: "type", summary: `${fieldPath} must be an array` }],
    });
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      throw new BodyValidationError("validation_failed", `${fieldPath}[${i}] must be a string.`, {
        fieldErrors: [{ fieldPath: `${fieldPath}[${i}]`, code: "type", summary: "Array element must be a string" }],
      });
    }
  }
  return value as string[];
}

export function validatePositiveInteger(value: unknown, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BodyValidationError("validation_failed", `${fieldPath} must be a positive integer.`, {
      fieldErrors: [{ fieldPath, code: "range", summary: `${fieldPath} must be a positive integer` }],
    });
  }
  return value;
}

export function validateNonNegativeInteger(value: unknown, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new BodyValidationError("validation_failed", `${fieldPath} must be a non-negative integer.`, {
      fieldErrors: [{ fieldPath, code: "range", summary: `${fieldPath} must be a non-negative integer` }],
    });
  }
  return value;
}
