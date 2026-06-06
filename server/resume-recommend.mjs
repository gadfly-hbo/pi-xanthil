import { WebSocket } from "ws";

const WS_URL = "ws://localhost:8787/ws";
const FLOW_ID = "90ef75f9-6d6a-4da3-8b93-fc6ebb781d45";
const PREVIOUS_RUN_ID = "5f15b6a4-4144-4be4-a8cf-fc0c31d32af0";
const MODEL = "minimax-cn/MiniMax-M3";
const RUN_ID = `resume-recommend-rl07-${Date.now()}`;

const INPUTS = {
  task: "森马会员留存率分析（2025H1）",
  data_files: "- /Users/huangbo/Dev/Data/anax-mock/森马会员留存聚合数据_2025H1.csv",
};

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("[ws] connected, sending...");
  ws.send(JSON.stringify({
    type: "execute_multi_agent",
    flowId: FLOW_ID,
    runId: RUN_ID,
    model: MODEL,
    inputs: INPUTS,
    resumeFromNodeId: "recommend",
    previousRunId: PREVIOUS_RUN_ID,
  }));
});

ws.on("message", (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { console.log("[raw]", raw.toString()); return; }
  
  const { type, nodeId } = msg;
  
  // Print ALL message types for debugging
  console.log(`[msg] type=${type} nodeId=${nodeId ?? "-"}`);
  
  if (type === "step_output") {
    // Don't print full output, just show progress
    return;
  }
  
  if (type === "agent_gate") {
    console.log(JSON.stringify(msg, null, 2));
    if (nodeId === "review_gate") {
      console.log("\n=== review_gate done, closing ===");
      ws.close();
    }
  } else if (type === "error") {
    console.error("[ERROR]", JSON.stringify(msg));
    ws.close();
  } else if (type === "run_end") {
    console.log("[run_end]", JSON.stringify(msg));
    ws.close();
  }
});

ws.on("error", (err) => console.error("[ws error]", err.message));
ws.on("close", () => { console.log("[ws] closed"); process.exit(0); });
setTimeout(() => { console.log("[timeout]"); ws.close(); }, 15 * 60 * 1000);
