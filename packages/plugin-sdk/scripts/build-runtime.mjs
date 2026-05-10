#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const pluginRoot = process.cwd();
const distDir = path.join(pluginRoot, "dist");
const tsconfigPath = path.join(pluginRoot, "tsconfig.json");
const runtimeEntryMjs = path.join(distDir, "runtime.mjs");

async function pluginLabel() {
  try {
    const raw = await readFile(path.join(pluginRoot, "package.json"), "utf8");
    const name = JSON.parse(raw)?.name;
    if (typeof name === "string" && name.length > 0) return name;
  } catch {
    // ignore
  }
  return path.basename(pluginRoot);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: pluginRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(undefined);
      else
        reject(
          new Error(`Command failed: ${command} ${args.join(" ")} (code=${code ?? "null"})`)
        );
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

function startWatch(label) {
  run("pnpm", ["exec", "tsc", "-w", "-p", tsconfigPath]).catch((error) => {
    console.error(`[${label}] watch failed:`, error);
    process.exitCode = 1;
  });
}

const label = await pluginLabel();
await buildOnce();
if (process.argv.includes("--watch")) {
  await writeRuntimeEntry();
  console.log(`[${label}] watch mode started`);
  startWatch(label);
}
