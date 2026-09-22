import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const apiPort = process.env.PORT ?? "3000";
const API_READY_TIMEOUT_MS = 45_000;

function spawnWorkspace(workspace) {
  return spawn(npmCommand, ["run", "dev", `--workspace=${workspace}`], {
    env: process.env,
    stdio: "inherit",
  });
}

let stopping = false;
let exitCode = 0;

const children = [spawnWorkspace("@kodax-fabric/server")];
const exits = [];

function stopChildren(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

function watchChild(child) {
  child.once("error", (error) => {
    console.error(`Unable to start npm workspace: ${error.message}`);
    exitCode = 1;
    stopChildren();
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      exitCode = code ?? (signal ? 1 : 0);
      stopChildren();
    }
  });
  exits.push(
    new Promise((resolve) => {
      child.once("exit", () => resolve());
    }),
  );
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stopChildren(signal));
}

// 先起 server 并等 /health 就绪再起 web，避免页面首批请求撞上 ECONNREFUSED。
async function waitForApi() {
  const deadline = Date.now() + API_READY_TIMEOUT_MS;
  const url = `http://127.0.0.1:${apiPort}/health`;
  while (Date.now() < deadline) {
    if (stopping || children[0].exitCode !== null) return false;
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // API 尚未监听，继续轮询
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

watchChild(children[0]);

if (await waitForApi()) {
  console.log("dev: API 就绪，启动 web");
  const web = spawnWorkspace("@kodax-fabric/web");
  children.push(web);
  watchChild(web);
} else if (!stopping) {
  console.error(
    `dev: API 未在 ${API_READY_TIMEOUT_MS / 1_000}s 内就绪（http://127.0.0.1:${apiPort}/health）`,
  );
  exitCode = 1;
  stopChildren();
}

await Promise.all(exits);
process.exitCode = exitCode;
