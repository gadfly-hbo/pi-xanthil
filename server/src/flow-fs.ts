import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export interface TreeNode {
  name: string;
  path: string;   // relative path from flow folder root, posix-style ("a/b/c.md")
  kind: "file" | "dir";
  size?: number;
  mtime: number;
  children?: TreeNode[];
}

const HIDE = new Set([".DS_Store"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB cap on text reads to keep the editor snappy

/**
 * Walk a folder into a tree. Hidden folders (starting with ".") are kept because
 * pi workflows include `.pi/` which is meaningful — only OS junk is filtered.
 */
export function readTree(rootAbs: string): TreeNode {
  const st = statSync(rootAbs);
  const root: TreeNode = {
    name: "",
    path: "",
    kind: "dir",
    mtime: st.mtimeMs,
    children: [],
  };
  if (st.isDirectory()) walk(rootAbs, "", root);
  return root;
}

function walk(absDir: string, relDir: string, parent: TreeNode): void {
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return;
  }
  entries.sort((a, b) => a.localeCompare(b, "zh"));
  for (const name of entries) {
    if (HIDE.has(name)) continue;
    const abs = join(absDir, name);
    let s;
    try {
      s = statSync(abs);
    } catch {
      continue;
    }
    const rel = relDir ? `${relDir}/${name}` : name;
    if (s.isDirectory()) {
      const node: TreeNode = { name, path: rel, kind: "dir", mtime: s.mtimeMs, children: [] };
      parent.children!.push(node);
      walk(abs, rel, node);
    } else if (s.isFile()) {
      parent.children!.push({ name, path: rel, kind: "file", size: s.size, mtime: s.mtimeMs });
    }
  }
  // Directories before files at each level — matches the OS finder convention.
  parent.children!.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh");
  });
}

/**
 * Resolve a user-supplied relative path against the flow root and reject anything
 * that escapes the root (path traversal guard).
 */
export function safeResolve(rootAbs: string, relPath: string): string {
  const cleaned = relPath.replace(/^[/\\]+/, "");
  const abs = resolve(rootAbs, cleaned);
  const rel = relative(rootAbs, abs);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) {
    throw new Error("path escapes flow root");
  }
  return abs;
}

export function readFlowFile(rootAbs: string, relPath: string): { content: string; truncated: boolean; size: number } {
  const abs = safeResolve(rootAbs, relPath);
  const s = statSync(abs);
  if (!s.isFile()) throw new Error("not a file");
  if (s.size > MAX_FILE_BYTES) {
    const buf = readFileSync(abs).subarray(0, MAX_FILE_BYTES);
    return { content: buf.toString("utf8"), truncated: true, size: s.size };
  }
  return { content: readFileSync(abs, "utf8"), truncated: false, size: s.size };
}

interface InferWorkflowNode {
  id: string;
  label: string;
  prompt: string;
  model: string;
  position?: { x: number; y: number };
}

interface InferWorkflowEdge {
  id: string;
  source: string;
  target: string;
}

interface InferWorkflowDef {
  version: 1;
  defaultModel: string;
  nodes: InferWorkflowNode[];
  edges: InferWorkflowEdge[];
}

const SKIP_DIRS = new Set(["runs", ".pi-sessions", "node_modules"]);
const SKIP_FILES = new Set([".DS_Store", "workflow.json"]);

function tryReadFileText(rootAbs: string, relPath: string): string | null {
  try {
    const abs = safeResolve(rootAbs, relPath);
    const s = statSync(abs);
    if (!s.isFile() || s.size > MAX_FILE_BYTES) return null;
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function extractPromptFromMd(content: string): string {
  const lines = content.split(/\r?\n/);
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) start = end + 1;
  }
  const body = lines.slice(start).join("\n").trim();
  const firstHeading = body.search(/^#{1,3}\s+/m);
  if (firstHeading >= 0) return body.slice(firstHeading).trim();
  return body;
}

export function inferWorkflow(rootAbs: string): InferWorkflowDef {
  const tree = readTree(rootAbs);
  const nodes: InferWorkflowNode[] = [];
  const edges: InferWorkflowEdge[] = [];

  const topDirs: TreeNode[] = [];
  const topFiles: TreeNode[] = [];
  for (const child of tree.children ?? []) {
    if (child.kind === "dir" && SKIP_DIRS.has(child.name)) continue;
    if (child.kind === "file" && SKIP_FILES.has(child.name)) continue;
    if (child.name.startsWith(".") && child.name !== ".pi") continue;
    if (child.kind === "dir") topDirs.push(child);
    else topFiles.push(child);
  }

  const isMultiStepDir = (dir: TreeNode): boolean => {
    const subDirs = (dir.children ?? []).filter(
      (c) => c.kind === "dir" && !SKIP_DIRS.has(c.name) && !c.name.startsWith("."),
    );
    const subFiles = (dir.children ?? []).filter(
      (c) => c.kind === "file" && !SKIP_FILES.has(c.name) && !c.name.startsWith("."),
    );
    return subDirs.length >= 1 || subFiles.length >= 2;
  };

  const singleDir = topDirs.length === 1 && topFiles.length <= 1 && isMultiStepDir(topDirs[0]!);

  const candidates: Array<{ name: string; relPath: string; isDir: boolean }> = [];
  if (singleDir) {
    const wrapper = topDirs[0]!;
    for (const child of wrapper.children ?? []) {
      if (child.kind === "dir" && SKIP_DIRS.has(child.name)) continue;
      if (child.kind === "file" && SKIP_FILES.has(child.name)) continue;
      if (child.name.startsWith(".")) continue;
      candidates.push({ name: child.name, relPath: child.path, isDir: child.kind === "dir" });
    }
  } else {
    for (const d of topDirs) {
      candidates.push({ name: d.name, relPath: d.path, isDir: true });
    }
    for (const f of topFiles) {
      if (/\.(md|txt|prompt|js|ts|py|sh)$/i.test(f.name)) {
        candidates.push({ name: f.name, relPath: f.path, isDir: false });
      }
    }
  }

  candidates.sort((a, b) => a.name.localeCompare(b.name, "zh"));

  const numPrefix = /^(\d+)[-\s._]/;
  const sorted = [...candidates].sort((a, b) => {
    const na = a.name.match(numPrefix)?.[1];
    const nb = b.name.match(numPrefix)?.[1];
    if (na && nb) return Number(na) - Number(nb);
    if (na) return -1;
    if (nb) return 1;
    return a.name.localeCompare(b.name, "zh");
  });

  const labelFromName = (name: string): string => {
    return name
      .replace(/^\d+[-\s._]+/, "")
      .replace(/\.(md|txt|prompt|js|ts|py|sh)$/i, "")
      .replace(/[-_]/g, " ")
      .trim();
  };

  const idFromName = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/^\d+[-\s._]+/, "")
      .replace(/\.(md|txt|prompt|js|ts|py|sh)$/i, "")
      .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      || `node-${nodes.length}`;
  };

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    const id = idFromName(c.name) + (i > 0 ? `-${i}` : "");
    const label = labelFromName(c.name) || c.name;
    let prompt = "";

    if (c.isDir) {
      const readmePaths = ["README.md", "readme.md", "index.md", "00-概述.md", "00-总览.md"];
      for (const rp of readmePaths) {
        const text = tryReadFileText(rootAbs, `${c.relPath}/${rp}`);
        if (text) {
          prompt = extractPromptFromMd(text);
          break;
        }
      }
      if (!prompt) {
        const fileNames = (tree.children ?? [])
          .find((ch) => ch.path === c.relPath)
          ?.children?.filter((ch) => ch.kind === "file")
          .map((ch) => ch.name) ?? [];
        if (fileNames.length > 0) {
          prompt = `目录: ${c.name}\n包含文件: ${fileNames.join(", ")}`;
        }
      }
    } else {
      const text = tryReadFileText(rootAbs, c.relPath);
      if (text) {
        if (/\.(md|txt|prompt)$/i.test(c.name)) {
          prompt = extractPromptFromMd(text);
        } else {
          prompt = text.slice(0, 500).trim();
        }
      }
    }

    if (!prompt) prompt = label;

    nodes.push({
      id,
      label,
      prompt,
      model: "",
      position: { x: 80 + (i % 4) * 220, y: 60 + Math.floor(i / 4) * 160 },
    });
  }

  for (let i = 1; i < nodes.length; i++) {
    edges.push({
      id: `e-${nodes[i - 1]!.id}-${nodes[i]!.id}`,
      source: nodes[i - 1]!.id,
      target: nodes[i]!.id,
    });
  }

  return { version: 1, defaultModel: "", nodes, edges };
}

export function writeFlowFile(rootAbs: string, relPath: string, content: string): void {
  const abs = safeResolve(rootAbs, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

export function copyLocalFolderIntoFlow(srcAbs: string, dstRoot: string): { sourceName: string; count: number } {
  const srcRoot = resolve(srcAbs.replace(/^file:\/\//, ""));
  const srcStat = statSync(srcRoot);
  if (!srcStat.isDirectory()) throw new Error("source path is not a directory");

  const dstAbs = resolve(dstRoot);
  const srcToDst = relative(srcRoot, dstAbs);
  const dstToSrc = relative(dstAbs, srcRoot);
  if (!srcToDst.startsWith("..") || !dstToSrc.startsWith("..")) {
    throw new Error("source and flow folder must be separate directories");
  }

  let count = 0;
  const copy = (relDir: string): void => {
    const absDir = relDir ? join(srcRoot, relDir) : srcRoot;
    for (const name of readdirSync(absDir)) {
      if (HIDE.has(name) || name === ".pi-sessions" || name === "runs") continue;
      const rel = relDir ? `${relDir}/${name}` : name;
      const src = join(srcRoot, rel);
      const st = statSync(src);
      if (st.isDirectory()) {
        copy(rel);
      } else if (st.isFile()) {
        const dst = join(dstAbs, rel);
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
        count += 1;
      }
    }
  };
  copy("");
  return { sourceName: basename(srcRoot) || "local-folder", count };
}

/**
 * Move every file from `srcRoot` into `dstRoot`, preserving relative layout.
 * Used by the upload pipeline: multer drops files in a tmp dir keyed by their
 * `webkitRelativePath`, and we want to land them under the flow's folder root.
 */
export function moveAllFiles(
  srcRoot: string,
  dstRoot: string,
  fileRels: Array<{ tmpPath: string; relPath: string }>,
): void {
  mkdirSync(dstRoot, { recursive: true });
  for (const { tmpPath, relPath } of fileRels) {
    const cleaned = relPath.replace(/^[/\\]+/, "");
    if (!cleaned || cleaned.split(/[\\/]/).includes("..")) continue;
    const dst = join(dstRoot, cleaned);
    mkdirSync(dirname(dst), { recursive: true });
    // Use streaming copy then unlink to handle cross-device tmp dirs safely.
    const data = readFileSync(tmpPath);
    writeFileSync(dst, data);
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // best-effort cleanup
    }
  }
  // Drop the now-empty tmp root.
  try {
    rmSync(srcRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** Copy a flow folder snapshot into a run directory, excluding volatile subtrees. */
export function copyFlowSnapshot(srcRoot: string, dstRoot: string): void {
  mkdirSync(dstRoot, { recursive: true });
  copyDir(srcRoot, dstRoot, "");
}

function copyDir(srcRoot: string, dstRoot: string, relDir: string): void {
  const absSrc = relDir ? join(srcRoot, relDir) : srcRoot;
  const absDst = relDir ? join(dstRoot, relDir) : dstRoot;
  mkdirSync(absDst, { recursive: true });

  let entries: string[];
  try {
    entries = readdirSync(absSrc);
  } catch {
    return;
  }

  for (const name of entries) {
    if (name === "runs" || name === ".pi-sessions" || HIDE.has(name)) continue;
    const childRel = relDir ? `${relDir}/${name}` : name;
    const srcPath = join(srcRoot, childRel);
    const dstPath = join(dstRoot, childRel);
    let s;
    try {
      s = statSync(srcPath);
    } catch {
      continue;
    }
    if (s.isDirectory()) copyDir(srcRoot, dstRoot, childRel);
    else if (s.isFile()) {
      mkdirSync(dirname(dstPath), { recursive: true });
      copyFileSync(srcPath, dstPath);
    }
  }
}
