import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const harnessPath = path.resolve(__dirname, "../src/components/analysis-projects/test-harness.html");
const outDir = path.resolve(__dirname, "../src/components/analysis-projects");

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

const shots = [
  { mode: "list",        vp: { width: 1280, height: 800 }, file: "screenshot-desktop-list.png" },
  { mode: "empty",       vp: { width: 1280, height: 800 }, file: "screenshot-desktop-empty.png" },
  { mode: "list",        vp: { width: 390,  height: 844 }, file: "screenshot-narrow-list.png" },
  { mode: "noworkspace", vp: { width: 390,  height: 844 }, file: "screenshot-narrow-noworkspace.png" },
  { mode: "detail-gate", vp: { width: 1280, height: 1200 }, file: "screenshot-desktop-detail-gate.png" },
  { mode: "detail-plan", vp: { width: 1280, height: 1200 }, file: "screenshot-desktop-detail-plan.png" },
  { mode: "detail-gate", vp: { width: 390,  height: 1200 }, file: "screenshot-narrow-detail-gate.png" },
  { mode: "detail-no-materials", vp: { width: 1280, height: 1200 }, file: "screenshot-desktop-detail-no-materials.png" },
  { mode: "detail-no-materials", vp: { width: 390,  height: 1200 }, file: "screenshot-narrow-detail-no-materials.png" },
  { mode: "empty",       vp: { width: 390,  height: 844 }, file: "screenshot-narrow-empty.png" },
  { mode: "capabilities",vp: { width: 1280, height: 800 }, file: "screenshot-desktop-capabilities.png" },
  { mode: "closure-list",vp: { width: 1280, height: 800 }, file: "screenshot-desktop-closure-list.png" },
  { mode: "closure-detail", vp: { width: 1280, height: 1200 }, file: "screenshot-desktop-closure-detail.png" },
];

for (const shot of shots) {
  const page = await browser.newPage();
  await page.setViewportSize(shot.vp);
  await page.goto(`file://${harnessPath}?mode=${shot.mode}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(outDir, shot.file), fullPage: false });
  console.log(`${shot.file} saved (${shot.vp.width}x${shot.vp.height})`);
  await page.close();
}

await browser.close();
console.log("All screenshots saved.");
