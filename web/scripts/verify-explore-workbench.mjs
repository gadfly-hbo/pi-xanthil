import { chromium } from "playwright";

const baseUrl = process.env.XANTHIL_WEB_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

async function closeMobileSidebar(page) {
  const backdrop = page.getByRole("button", { name: "关闭侧栏" });
  if (await backdrop.isVisible().catch(() => false)) {
    await page.evaluate(() => {
      document.querySelector('button[aria-label="关闭侧栏"]')?.click();
    });
  }
}

async function expectVisible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  console.log(`PASS: ${label}`);
}

async function waitForAnalysisTarget(page) {
  const targetSelect = page.getByTitle("选择本次分析采用的业务需求");
  await targetSelect.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(() => {
    const select = document.querySelector('select[title="选择本次分析采用的业务需求"]');
    return select && !select.textContent?.includes("正在加载分析目标");
  }, undefined, { timeout: 10_000 });
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  desktop.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location().url;
      if (location.endsWith("/favicon.ico")) return;
      consoleErrors.push(`${message.text()}${location ? ` @ ${location}` : ""}`);
    }
  });
  await desktop.goto(`${baseUrl}/?tab=explore&subTab=view`, { waitUntil: "domcontentloaded", timeout: 15_000 });

  await expectVisible(desktop.getByRole("button", { name: "分析", exact: true }), "自由分析是默认主入口");
  await expectVisible(desktop.getByRole("button", { name: "数据", exact: true }), "数据入口可见");
  await expectVisible(desktop.getByRole("button", { name: "产物", exact: true }), "产物入口可见");
  await expectVisible(desktop.getByRole("button", { name: "更多工具", exact: true }), "更多工具入口可见");
  await expectVisible(desktop.getByTitle("选择本次分析采用的业务需求"), "分析目标选择器可见");
  await expectVisible(desktop.getByRole("button", { name: "编辑完整需求" }), "完整需求编辑入口可见");
  await waitForAnalysisTarget(desktop);
  if (await desktop.getByText("聚合数据文档", { exact: true }).isVisible().catch(() => false)) {
    throw new Error("分析页仍显示常驻聚合数据文档栏");
  }
  if (await desktop.getByText("成果", { exact: true }).isVisible().catch(() => false)) {
    throw new Error("分析页仍显示常驻成果预览栏");
  }
  console.log("PASS: 桌面分析页默认保持单工作区");

  const resultActions = ["生成报告", "报告评审", "业务语言", "黄金策", "执行反馈"];
  if (await desktop.getByRole("button", { name: "生成报告", exact: true }).isVisible().catch(() => false)) {
    for (const label of resultActions) {
      const action = desktop.getByRole("button", { name: label, exact: true });
      await expectVisible(action, `${label} 结果动作可见`);
      if (await action.isDisabled()) {
        const reason = await action.getAttribute("title");
        if (!reason) throw new Error(`${label} disabled without a reason`);
      }
    }
    console.log("PASS: 禁用结果动作提供明确原因");
  }

  await desktop.getByRole("button", { name: "数据", exact: true }).click();
  await expectVisible(desktop.getByRole("dialog", { name: "数据抽屉" }), "数据抽屉可见");
  for (const label of ["原始数据", "聚合数据", "数据探索"]) {
    await expectVisible(desktop.getByRole("button", { name: new RegExp(label) }).last(), `${label} 可达`);
  }
  await desktop.keyboard.press("Escape");

  await desktop.getByRole("button", { name: "产物", exact: true }).click();
  await expectVisible(desktop.getByRole("dialog", { name: "产物抽屉" }), "产物抽屉可见");
  for (const label of ["报告输出", "报告审核", "业务语言", "黄金策", "执行反馈"]) {
    await expectVisible(desktop.getByRole("button", { name: new RegExp(label) }).last(), `${label} 可达`);
  }
  await desktop.screenshot({ path: "/tmp/pi-xanthil-explore-p2-desktop.png" });
  await desktop.keyboard.press("Escape");

  await desktop.getByRole("button", { name: "更多工具", exact: true }).click();
  for (const label of ["分析目标", "数据提取", "工具计算", "聚合计算", "模拟实验", "使用说明"]) {
    await expectVisible(desktop.getByRole("menuitem", { name: new RegExp(label) }), `${label} 可达`);
  }
  await desktop.keyboard.press("Escape");

  await desktop.getByRole("button", { name: "数据", exact: true }).click();
  await desktop.getByRole("button", { name: /数据探索/ }).last().click();
  await expectVisible(desktop.getByText("当前").locator(".."), "子页面保留当前上下文");
  await desktop.getByRole("button", { name: "分析", exact: true }).click();
  await expectVisible(desktop.getByText("自由分析", { exact: true }), "可一键返回自由分析");
  await desktop.getByRole("button", { name: "编辑完整需求" }).click();
  await expectVisible(desktop.getByText("分析目标", { exact: true }).last(), "可进入完整分析目标编辑器");
  await desktop.getByRole("button", { name: "分析", exact: true }).click();
  await expectVisible(desktop.getByTitle("选择本次分析采用的业务需求"), "可从编辑器返回分析工作区");
  await desktop.screenshot({ path: "/tmp/pi-xanthil-explore-p3-desktop.png" });

  if (consoleErrors.length > 0) {
    throw new Error(`Desktop console errors:\n${consoleErrors.join("\n")}`);
  }
  await desktop.close();

  const deepLink = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await deepLink.goto(`${baseUrl}/?tab=explore&subTab=report_review`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await expectVisible(deepLink.getByText("报告审核", { exact: true }).first(), "旧 subTab deep link 保持可用");
  await deepLink.close();

  const workflow = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await workflow.goto(`${baseUrl}/?tab=multi&subTab=view`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await expectVisible(workflow.getByRole("button", { name: "工作视图", exact: true }), "工作流导航未受影响");
  await workflow.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(`${baseUrl}/?tab=explore&subTab=view`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await closeMobileSidebar(mobile);
  await expectVisible(mobile.getByRole("button", { name: "分析", exact: true }), "窄屏主入口可见");
  await expectVisible(mobile.getByRole("button", { name: "更多工具", exact: true }), "窄屏工具入口可见");
  await expectVisible(mobile.getByTitle("选择本次分析采用的业务需求"), "窄屏分析目标可见");
  await expectVisible(mobile.getByRole("button", { name: "编辑完整需求" }), "窄屏需求编辑入口可见");
  await waitForAnalysisTarget(mobile);

  const dimensions = await mobile.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (dimensions.scrollWidth > dimensions.clientWidth) {
    throw new Error(`Mobile horizontal overflow: ${dimensions.scrollWidth} > ${dimensions.clientWidth}`);
  }
  console.log("PASS: 窄屏无页面级横向溢出");
  await mobile.screenshot({ path: "/tmp/pi-xanthil-explore-p3-mobile.png" });
  await mobile.getByRole("button", { name: "数据", exact: true }).click();
  await expectVisible(mobile.getByRole("dialog", { name: "数据抽屉" }), "窄屏数据抽屉可操作");
  await mobile.screenshot({ path: "/tmp/pi-xanthil-explore-p2-mobile.png" });
  await mobile.keyboard.press("Escape");
  await mobile.getByRole("button", { name: "更多工具", exact: true }).click();
  await expectVisible(mobile.getByRole("menuitem", { name: /模拟实验/ }), "窄屏菜单可操作");
  await mobile.screenshot({ path: "/tmp/pi-xanthil-explore-p1-mobile.png" });
} finally {
  await browser.close();
}
