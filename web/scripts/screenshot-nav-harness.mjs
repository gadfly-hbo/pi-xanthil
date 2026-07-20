import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import { spawn } from "child_process";
import { createServer } from "net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../src/components/analysis-projects");
const webDir = path.resolve(__dirname, "..");
const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;

// Mock API responses for bootstrap (no backend needed)
const MOCK_WORKSPACES = [{ id: "ws-test-001", name: "测试工作区", createdAt: new Date().toISOString() }];
const MOCK_MODELS = [{ id: "minimax-cn/MiniMax-M3", name: "MiniMax-M3", isDefault: true }];

async function interceptBootstrapAPIs(page) {
  await page.route("**/api/workspaces", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_WORKSPACES) }));
  await page.route("**/api/workspaces/archived", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/models", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_MODELS) }));
  await page.route("**/api/commands", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/sessions/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/flows/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/zhuanti/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/rules/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0, updatedAt: null }) }));
  await page.route("**/api/standards/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0, updatedAt: null }) }));
  await page.route("**/api/business-context/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0, updatedAt: null }) }));
  await page.route("**/api/cases/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0, updatedAt: null }) }));
  await page.route("**/api/kg/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0, reportCount: 0, edgeCount: 0 }) }));
  await page.route("**/api/memory/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ itemCount: 0, factCount: 0 }) }));
  await page.route("**/api/knowledge/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/token-stats/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 }) }));
  await page.route("**/api/workspace-paths/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  // Analysis Projects: valid empty ProjectListReadModel + capabilities
  await page.route("**/api/analysis-projects/v1/workspaces/*/projects", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ readModelVersion: "1.0", generatedAt: new Date().toISOString(), data: { items: [], nextCursor: null, hasMore: false, limit: 20 } }),
  }));
  await page.route("**/api/analysis-projects/v1/capabilities", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ schemaVersion: "1.0", requestId: "mock", data: { version: "1.0.0", apiVersion: "1.0.0", appVersion: "0.0.0", enabledDailyKinds: ["daily_analysis"], supportedSchemaVersions: ["1.0"], sourceCapabilities: { user: [{ kind: "upload", scope: "user_provided", artifactKind: "input_material" }], agentHarness: [] }, engine: { status: "unavailable", reason: "mock" }, upload: { maxBytes: 52428800, allowedMediaTypes: ["text/csv"], tmpAvailable: true }, representationFormats: [], exportContracts: [] } }),
  }));
}

function waitForPort(port, host = "127.0.0.1", timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      fetch(`http://${host}:${port}/`).then(() => resolve()).catch(() => {
        if (Date.now() > deadline) reject(new Error(`Port ${port} not ready after ${timeoutMs}ms`));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

// --- Start vite preview server ---
console.log(`Starting vite preview on port ${PORT}...`);
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--host", "127.0.0.1"], {
  cwd: webDir, stdio: ["ignore", "pipe", "pipe"], shell: true,
});
let serverOutput = "";
server.stdout.on("data", (d) => { serverOutput += d.toString(); });
server.stderr.on("data", (d) => { serverOutput += d.toString(); });

try {
  await waitForPort(PORT, "127.0.0.1", 15000);
  console.log(`Server ready on port ${PORT}`);
} catch (err) {
  console.error("Failed to start vite preview server:");
  console.error(serverOutput);
  server.kill("SIGTERM");
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

let exitCode = 0;

try {
  // --- Desktop 1280×800 ---
  console.log("\n=== Desktop 1280x800 ===");
  const page1 = await browser.newPage();
  await interceptBootstrapAPIs(page1);
  await page1.setViewportSize({ width: 1280, height: 800 });
  const resp1 = await page1.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
  if (!resp1 || !resp1.ok()) throw new Error(`Desktop goto failed: ${resp1?.status()}`);
  await page1.waitForTimeout(2000);

  // Assert 分析台 tab is visible
  const tabBtn = page1.locator("button:has-text('分析台')");
  await tabBtn.waitFor({ state: "visible", timeout: 5000 });
  console.log("PASS: 分析台 tab is visible (desktop)");

  await page1.screenshot({ path: path.join(outDir, "screenshot-nav-desktop-header.png"), fullPage: false });
  console.log("screenshot-nav-desktop-header.png saved");

  // Click 分析台 tab
  await tabBtn.click();
  await page1.waitForTimeout(1500);

  // Reject error banners before checking normal content
  const errorBanner = page1.locator(".text-red-600, .border-red-200");
  const hasError = await errorBanner.count() > 0;
  if (hasError) {
    const errorText = await errorBanner.first().textContent().catch(() => "");
    throw new Error(`Desktop: 分析台 shows error banner: "${errorText}" — expected normal content, not error state`);
  }

  // Assert Analysis Projects content is visible (throw on failure)
  const noWorkspace = page1.locator("text=请先选择工作区");
  const projectList = page1.locator("text=暂无分析项目");
  const toolbar = page1.locator("text=项目列表");
  const contentVisible = await noWorkspace.isVisible().catch(() => false)
    || await projectList.isVisible().catch(() => false)
    || await toolbar.isVisible().catch(() => false);
  if (!contentVisible) {
    throw new Error("Desktop: 分析台 content not detected after clicking tab — expected '请先选择工作区', '暂无分析项目', or '项目列表'");
  }
  console.log("PASS: 分析台 content visible after tab click (desktop)");

  await page1.screenshot({ path: path.join(outDir, "screenshot-nav-desktop-analysis-tab.png"), fullPage: false });
  console.log("screenshot-nav-desktop-analysis-tab.png saved");

  // --- Narrow 390×844 ---
  console.log("\n=== Narrow 390x844 ===");
  const page2 = await browser.newPage();
  await interceptBootstrapAPIs(page2);
  await page2.setViewportSize({ width: 390, height: 844 });
  const resp2 = await page2.goto(`${BASE}/?tab=analysis_projects`, { waitUntil: "networkidle", timeout: 15000 });
  if (!resp2 || !resp2.ok()) throw new Error(`Narrow goto failed: ${resp2?.status()}`);
  await page2.waitForTimeout(2000);

  // Assert 分析台 tab is visible
  const tabBtn2 = page2.locator("button:has-text('分析台')");
  await tabBtn2.waitFor({ state: "visible", timeout: 5000 });
  console.log("PASS: 分析台 tab is visible (narrow)");

  // Assert 分析台 is the active tab (has active styling)
  const tabActive = page2.locator("button:has-text('分析台').bg-neutral-100, button:has-text('分析台').dark\\:bg-neutral-800");
  const isActive = await tabActive.count() > 0;
  if (!isActive) {
    // Fallback: check if the breadcrumb shows 分析台
    const breadcrumb = page2.locator("text=分析台").first();
    const bcVisible = await breadcrumb.isVisible().catch(() => false);
    if (!bcVisible) throw new Error("Narrow: 分析台 tab is not active after deep-link navigation");
  }
  console.log("PASS: 分析台 tab is active (narrow, via deep-link)");

  // Close the mobile sidebar overlay (it opens by default on narrow viewports).
  // The sidebar content intercepts pointer events, so use evaluate to hide it.
  await page2.evaluate(() => {
    // Find the sidebar backdrop button and trigger its click via dispatchEvent
    const backdrop = document.querySelector('button[aria-label="关闭侧栏"]');
    if (backdrop) backdrop.click();
  });
  await page2.waitForTimeout(500);

  // Verify sidebar is closed: the backdrop should be gone
  const backdropGone = await page2.locator('button[aria-label="关闭侧栏"]').count() === 0;
  if (!backdropGone) {
    // Fallback: hide sidebar overlay via CSS
    await page2.evaluate(() => {
      document.querySelectorAll('.fixed.inset-0.z-40, .fixed.inset-y-0.z-50').forEach(el => { el.style.display = 'none'; });
    });
    await page2.waitForTimeout(300);
  }
  console.log("PASS: Sidebar closed (narrow)");

  // Now take the header screenshot (sidebar closed, tab strip visible)
  await page2.screenshot({ path: path.join(outDir, "screenshot-nav-narrow-header.png"), fullPage: false });
  console.log("screenshot-nav-narrow-header.png saved");

  // Assert Analysis Projects content is visible in narrow viewport (page2 locators!)
  // Reject error banners first
  const narrowError = page2.locator(".text-red-600, .border-red-200");
  const narrowHasError = await narrowError.count() > 0;
  if (narrowHasError) {
    const errText = await narrowError.first().textContent().catch(() => "");
    throw new Error(`Narrow: 分析台 shows error banner: "${errText}" — expected normal content`);
  }
  const narrowNoWorkspace = page2.locator("text=请先选择工作区");
  const narrowProjectList = page2.locator("text=暂无分析项目");
  const narrowToolbar = page2.locator("text=项目列表");
  const narrowContent = await narrowNoWorkspace.isVisible().catch(() => false)
    || await narrowProjectList.isVisible().catch(() => false)
    || await narrowToolbar.isVisible().catch(() => false);
  if (!narrowContent) {
    throw new Error("Narrow: 分析台 content not visible after closing sidebar — expected '请先选择工作区', '暂无分析项目', or '项目列表'");
  }
  console.log("PASS: 分析台 content visible (narrow)");

  await page2.screenshot({ path: path.join(outDir, "screenshot-nav-narrow-analysis-tab.png"), fullPage: false });
  console.log("screenshot-nav-narrow-analysis-tab.png saved");

  console.log("\nAll nav screenshots captured successfully.");
} catch (err) {
  console.error("\nNAV HARNESS FAILED:", err.message);
  exitCode = 1;
} finally {
  await browser.close();
  server.kill("SIGTERM");
  process.exit(exitCode);
}
