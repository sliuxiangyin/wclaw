import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, "..");
const distDir = path.join(pluginRoot, "dist");
const tsconfigPath = path.join(pluginRoot, "tsconfig.json");
const runtimeEntryMjs = path.join(distDir, "runtime.mjs");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: pluginRoot,
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`Command failed: ${command} ${args.join(" ")} (code=${code ?? "null"})`));
    });
    child.on("error", reject);
  });
}

async function writeRuntimeEntry() {
  await mkdir(distDir, { recursive: true });
  await writeFile(
    runtimeEntryMjs,
    `export { default } from "./runtime.js";\n`,
    "utf8"
  );
}

async function buildOnce() {
  await run("pnpm", ["exec", "tsc", "-p", tsconfigPath]);
  await writeRuntimeEntry();
}

function startWatch() {
  run("pnpm", ["exec", "tsc", "-w", "-p", tsconfigPath]).catch((error) => {
    console.error("[linux-do-fetch] watch failed:", error);
    process.exitCode = 1;
  });
}

await buildOnce();
if (process.argv.includes("--watch")) {
  await writeRuntimeEntry();
  console.log("[linux-do-fetch] watch mode started");
  startWatch();
}
