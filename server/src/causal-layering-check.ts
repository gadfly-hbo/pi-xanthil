export interface CausalLayeringFinding {
  kind:
    | "observation_causal_word"
    | "observation_inference_word"
    | "inference_missing_support"
    | "inference_missing_falsification"
    | "action_orphan";
  segment: string;
  line?: number;
}

const CAUSAL_WORDS = /因为|所以|导致|因此|由于|从而|引发|推动|造成|进而/g;
const INFERENCE_WORDS = /说明|表明|反映|意味着/g;

const SECTION_HEADERS = [
  /一[、.]\s*观察\s*Observation/i,
  /二[、.]\s*推断\s*Inference/i,
  /三[、.]\s*建议\s*Action/i,
];

interface Section {
  header: string;
  startLine: number;
  lines: string[];
}

function splitSections(text: string): Section[] {
  const lines = text.split(/\r?\n/);
  const sections: Section[] = [];
  let currentSection: Section | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const matched = SECTION_HEADERS.findIndex((re) => re.test(line));
    if (matched >= 0) {
      if (currentSection) sections.push(currentSection);
      currentSection = { header: line.trim(), startLine: i + 1, lines: [] };
    } else if (currentSection) {
      currentSection.lines.push(line);
    }
  }
  if (currentSection) sections.push(currentSection);
  return sections;
}

function findSection(sections: Section[], pattern: RegExp): Section | undefined {
  return sections.find((s) => pattern.test(s.header));
}

function stripListMarker(line: string): string {
  return line
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\d+[.)、]\s+/, "")
    .trim();
}

export function checkCausalLayering(text: string): CausalLayeringFinding[] {
  const findings: CausalLayeringFinding[] = [];
  const sections = splitSections(text);

  const obsSection = findSection(sections, /观察.*Observation/i);
  if (obsSection) {
    for (let i = 0; i < obsSection.lines.length; i++) {
      const line = obsSection.lines[i]!;
      const lineNum = obsSection.startLine + i;

      let match: RegExpExecArray | null;
      CAUSAL_WORDS.lastIndex = 0;
      while ((match = CAUSAL_WORDS.exec(line)) !== null) {
        findings.push({
          kind: "observation_causal_word",
          segment: line.trim().slice(0, 120),
          line: lineNum,
        });
      }

      INFERENCE_WORDS.lastIndex = 0;
      while ((match = INFERENCE_WORDS.exec(line)) !== null) {
        findings.push({
          kind: "observation_inference_word",
          segment: line.trim().slice(0, 120),
          line: lineNum,
        });
      }
    }
  }

  const infSection = findSection(sections, /推断.*Inference/i);
  if (infSection) {
    const infText = infSection.lines.join("\n");
    const infBlocks = infText.split(/(?=【假设】)/);
    for (const block of infBlocks) {
      const trimmed = block.trim();
      if (!trimmed || trimmed.length < 10) continue;
      const hasHypothesis = /【假设】/.test(trimmed);
      const hasSupport = /【支撑[^】]*#\d/.test(trimmed);
      const hasFalsification = /【证伪条件/.test(trimmed);
      if (!hasHypothesis) continue;
      if (!hasSupport) {
        findings.push({
          kind: "inference_missing_support",
          segment: trimmed.slice(0, 120),
        });
      }
      if (!hasFalsification) {
        findings.push({
          kind: "inference_missing_falsification",
          segment: trimmed.slice(0, 120),
        });
      }
    }
  }

  const actSection = findSection(sections, /建议.*Action/i);
  if (actSection) {
    for (let i = 0; i < actSection.lines.length; i++) {
      const line = actSection.lines[i]!;
      const trimmed = stripListMarker(line);
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.length < 5) continue;
      if (!/基于推断\s*#?\d|（基于推断|\(基于推断/.test(trimmed)) {
        findings.push({
          kind: "action_orphan",
          segment: trimmed.slice(0, 120),
          line: actSection.startLine + i,
        });
      }
    }
  }

  return findings;
}
