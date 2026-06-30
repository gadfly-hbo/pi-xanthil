import { readFileSync } from "node:fs";

const WIKI_PATH = "docs/wiki.html";
const html = readFileSync(WIKI_PATH, "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];

if (scripts.length === 0) {
  console.error(`${WIKI_PATH}: no inline <script> blocks found`);
  process.exit(1);
}

let failed = false;
for (const [index, match] of scripts.entries()) {
  const body = match[1];
  try {
    new Function(body);
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${WIKI_PATH}: script ${index} syntax error: ${message}`);
  }
}

if (failed) process.exit(1);
console.log(`${WIKI_PATH}: ${scripts.length} inline script(s) ok`);
