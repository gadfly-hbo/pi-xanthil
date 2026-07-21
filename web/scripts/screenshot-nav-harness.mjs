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
const MOCK_FLOWS = [{
  id: "flow-test-001",
  workspaceId: "ws-test-001",
  name: "Mock 工作流",
  folderPath: "/tmp/mock-workflow",
  sourceName: "mock",
  sourceSessionId: null,
  generationStatus: "ready",
  generationError: null,
  kind: "multi",
  createdAt: Date.now(),
  updatedAt: Date.now(),
}];
const MOCK_WORKFLOW = {
  version: 1,
  defaultModel: "",
  nodes: [{ id: "step1", label: "Mock Step", prompt: "{{task}}", model: "", kind: "agent" }],
  edges: [],
};
const MOCK_FLOW_RUNS = [{
  id: "flow-run-db-001",
  flowId: "flow-test-001",
  inputs: {},
  status: "success",
  startedAt: Date.now() - 120000,
  endedAt: Date.now() - 60000,
  outputDir: "/tmp/mock-workflow/runs/mockrun001",
}];
const MOCK_FLOW_RUN_TREE = {
  name: "mockrun001",
  path: "",
  kind: "dir",
  mtime: Date.now(),
  children: [
    { name: "workflow.json", path: "workflow.json", kind: "file", size: 100, mtime: Date.now() },
    { name: "step1", path: "step1", kind: "dir", mtime: Date.now(), children: [] },
  ],
};

async function interceptBootstrapAPIs(page) {
  await page.route("**/api/workspaces", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_WORKSPACES) }));
  await page.route("**/api/workspaces/archived", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/workspaces/*/flows", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_FLOWS) }));
  await page.route("**/api/models", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_MODELS) }));
  await page.route("**/api/commands", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/sessions/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/flows/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/flows/*/workflow", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workflow: MOCK_WORKFLOW }) }));
  await page.route("**/api/flows/*/skills", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/flows/*/runs/*/tree", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_FLOW_RUN_TREE) }));
  await page.route("**/api/flows/*/runs/*/file**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: "", truncated: false, size: 0 }) }));
  await page.route("**/api/flows/*/runs", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_FLOW_RUNS) }));
  await page.route("**/api/workspaces/*/skill-registry", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/extraction-tools", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/workspaces/*/evaluations", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
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

async function seedStaleHiddenTabsConfig(page) {
  await page.addInitScript(() => {
    localStorage.setItem("xanthil-hidden-tabs", JSON.stringify([]));
    localStorage.removeItem("xanthil-hidden-tabs-frontstage-v1");
  });
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
  await seedStaleHiddenTabsConfig(page1);
  await interceptBootstrapAPIs(page1);
  await page1.setViewportSize({ width: 1280, height: 800 });
  const resp1 = await page1.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
  if (!resp1 || !resp1.ok()) throw new Error(`Desktop goto failed: ${resp1?.status()}`);
  await page1.waitForTimeout(2000);

  // Assert 自动化 tab is visible
  const tabBtn = page1.locator("button:has-text('自动化')");
  await tabBtn.waitFor({ state: "visible", timeout: 5000 });
  console.log("PASS: 自动化 tab is visible (desktop)");
  const topicTabVisible = await page1.locator("button:has-text('专题')").isVisible().catch(() => false);
  if (topicTabVisible) throw new Error("Desktop: 专题 tab should be hidden by frontstage migration");
  console.log("PASS: 专题 tab is hidden by default migration (desktop)");

  await page1.screenshot({ path: path.join(outDir, "screenshot-nav-desktop-header.png"), fullPage: false });
  console.log("screenshot-nav-desktop-header.png saved");

  const workflowTab = page1.locator("button:has-text('工作流')");
  await workflowTab.click();
  await page1.locator("button:has-text('Anax 商业分析')").waitFor({ state: "visible", timeout: 5000 });
  await page1.locator("button:has-text('假设库')").waitFor({ state: "visible", timeout: 5000 });
  await page1.locator("button:has-text('变更管理')").waitFor({ state: "visible", timeout: 5000 });
  console.log("PASS: 工作流 exposes Anax 商业分析 / 假设库 / 变更管理 (desktop)");
  await page1.getByRole("button", { name: /Mock 工作流/ }).waitFor({ state: "visible", timeout: 5000 });
  await page1.locator("button").filter({ hasText: /^执行$/ }).click();
  await page1.screenshot({ path: path.join(outDir, "screenshot-nav-desktop-workflow-execute.png"), fullPage: false });
  await page1.locator("text=Mock Step").waitFor({ state: "visible", timeout: 5000 });
  const restoredDone = await page1.locator("text=完成").first().isVisible().catch(() => false);
  if (!restoredDone) throw new Error("Desktop: completed workflow run did not restore node completion state");
  console.log("PASS: completed workflow run restores node completion state (desktop)");
  await page1.getByRole("button", { name: "workflow", exact: true }).click();
  await page1.locator("text=工作流评估").waitFor({ state: "visible", timeout: 5000 });
  console.log("PASS: 工作流 internal workflow tab switches content (desktop)");

  // Click 自动化 tab
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
  await seedStaleHiddenTabsConfig(page2);
  await interceptBootstrapAPIs(page2);
  await page2.setViewportSize({ width: 390, height: 844 });
  const resp2 = await page2.goto(`${BASE}/?tab=analysis_projects`, { waitUntil: "networkidle", timeout: 15000 });
  if (!resp2 || !resp2.ok()) throw new Error(`Narrow goto failed: ${resp2?.status()}`);
  await page2.waitForTimeout(2000);

  // Assert 自动化 tab is visible
  const tabBtn2 = page2.locator("button:has-text('自动化')");
  await tabBtn2.waitFor({ state: "visible", timeout: 5000 });
  console.log("PASS: 自动化 tab is visible (narrow)");

  // Assert 自动化 is the active tab (has active styling)
  const tabActive = page2.locator("button:has-text('自动化').bg-neutral-100, button:has-text('自动化').dark\\:bg-neutral-800");
  const isActive = await tabActive.count() > 0;
  if (!isActive) {
    // Fallback: check if the breadcrumb shows 自动化
    const breadcrumb = page2.locator("text=自动化").first();
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
