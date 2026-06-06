import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { listActiveChildProcesses, notifyChildProcess, registerChildProcess } from "./child-processes.ts";

test("registerChildProcess tracks a child until it exits", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20)"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  const info = registerChildProcess(child, {
    kind: "tool",
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 20)"],
    cwd: process.cwd(),
    label: "registry-test",
  });

  assert.equal(info.pid, child.pid ?? null);
  assert.ok(listActiveChildProcesses().some((active) => active.id === info.id));

  await once(child, "close");

  assert.equal(listActiveChildProcesses().some((active) => active.id === info.id), false);
});

test("notifyChildProcess invokes the listener with registered process info", async () => {
  const child = spawn(process.execPath, ["-e", ""], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  let observedId: string | null = null;
  const info = notifyChildProcess(
    (_child, observed) => {
      observedId = observed.id;
    },
    child,
    {
      kind: "pi",
      command: process.execPath,
      args: ["-e", ""],
      cwd: process.cwd(),
      label: "listener-test",
      sessionId: "session-1",
    },
  );

  assert.equal(observedId, info.id);
  assert.equal(info.sessionId, "session-1");

  await once(child, "close");
});
