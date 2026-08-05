import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const workspaces = ["@tokenhub/server", "@tokenhub/web"];
const children = workspaces.map((workspace) =>
  spawn(npmCommand, ["run", "dev", `--workspace=${workspace}`], {
    env: process.env,
    stdio: "inherit",
  }),
);

let stopping = false;
let exitCode = 0;

function stopChildren(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stopChildren(signal));
}

await Promise.all(
  children.map(
    (child) =>
      new Promise((resolve) => {
        child.once("error", (error) => {
          console.error(`Unable to start npm workspace: ${error.message}`);
          exitCode = 1;
          stopChildren();
          resolve();
        });
        child.once("exit", (code, signal) => {
          if (!stopping) {
            exitCode = code ?? (signal ? 1 : 0);
            stopChildren();
          }
          resolve();
        });
      }),
  ),
);

process.exitCode = exitCode;
