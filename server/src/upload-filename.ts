const MOJIBAKE_LATIN1_RE = /[\u00C0-\u00FF]/;
const CJK_RE = /[\u3400-\u9FFF]/;

export function decodeUploadOriginalName(name: string | undefined | null): string {
  const raw = name || "upload";
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  if (!decoded.includes("\uFFFD") && CJK_RE.test(decoded) && MOJIBAKE_LATIN1_RE.test(raw)) {
    return decoded;
  }
  return raw;
}
