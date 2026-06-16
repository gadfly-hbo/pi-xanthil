import type { XanCommand } from "./types.ts";

export interface CommandExpandResult {
  expandedText: string;
  skillSlugs: string[];
}

interface ParsedArgs {
  argsText: string;
  positional: string[];
  named: Record<string, string>;
}

export function expandCommand(text: string, commands: XanCommand[]): CommandExpandResult {
  const parsed = parseCommandPrefix(text);
  if (!parsed) return { expandedText: text, skillSlugs: [] };

  const command = commands.find((candidate) => candidate.enabled && candidate.name === parsed.name);
  if (!command) return { expandedText: text, skillSlugs: [] };

  const args = parseArgs(parsed.argsText);
  return {
    expandedText: expandTemplate(command.template, args),
    skillSlugs: [...(command.skillSlugs ?? [])],
  };
}

function parseCommandPrefix(text: string): { name: string; argsText: string } | null {
  if (!text.startsWith("/")) return null;
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) return null;
  return { name: match[1] ?? "", argsText: match[2] ?? "" };
}

function parseArgs(argsText: string): ParsedArgs {
  const tokens = tokenize(argsText);
  const positional: string[] = [];
  const named: Record<string, string> = {};

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (!token.startsWith("--") || token.length <= 2) {
      positional.push(token);
      continue;
    }

    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      const key = body.slice(0, eq).trim();
      if (key) named[key] = body.slice(eq + 1);
      continue;
    }

    const key = body.trim();
    if (!key) continue;
    const next = tokens[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      named[key] = next;
      i++;
    } else {
      named[key] = "";
    }
  }

  return { argsText, positional, named };
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (escaped) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}

function expandTemplate(template: string, args: ParsedArgs): string {
  return template.replace(/\{\{\s*(args|\d+|param\.[A-Za-z0-9_-]+)\s*\}\}/g, (_all, rawKey: string) => {
    if (rawKey === "args") return args.argsText;
    if (/^\d+$/.test(rawKey)) return args.positional[Number(rawKey) - 1] ?? "";
    const paramKey = rawKey.slice("param.".length);
    return args.named[paramKey] ?? "";
  });
}
