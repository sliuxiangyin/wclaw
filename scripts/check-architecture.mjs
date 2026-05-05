import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const rules = [
  {
    name: "routes 禁止 SQL 关键字",
    baseDir: "apps/host-api/src/routes",
    fileExts: [".ts", ".tsx", ".js", ".mjs", ".cjs"],
    test: (content) =>
      /\b(SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/is.test(content),
    message: "routes 层检测到 SQL 关键字，请下沉到 repositories 层"
  },
  {
    name: "pages 禁止直接 fetch",
    baseDir: "apps/host-console/src/pages",
    fileExts: [".ts", ".tsx", ".js", ".jsx"],
    test: (content) => /\bfetch\s*\(/.test(content),
    message: "pages 层检测到 fetch，请迁移到 lib/api 或 features/hooks"
  },
  {
    name: "禁止插件特判 weixin-bridge",
    baseDir: "apps",
    fileExts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    test: (content) => /pluginId\s*===\s*['"]weixin-bridge['"]/.test(content),
    message: "检测到插件特判分支，请改为协议驱动"
  },
  {
    name: "routes 文件行数上限",
    baseDir: "apps/host-api/src/routes",
    fileExts: [".ts", ".tsx", ".js", ".mjs", ".cjs"],
    test: (content) => content.split(/\r?\n/).length > 220,
    message: "routes 文件超过 220 行，请拆分模块"
  },
  {
    name: "pages 文件行数上限",
    baseDir: "apps/host-console/src/pages",
    fileExts: [".ts", ".tsx", ".js", ".jsx"],
    test: (content) => content.split(/\r?\n/).length > 320,
    message: "pages 文件超过 320 行，请拆分为 features/hooks/components"
  },
  {
    name: "services 禁止依赖 Fastify web 层",
    baseDir: "apps/host-api/src/services",
    fileExts: [".ts", ".tsx", ".js", ".mjs", ".cjs"],
    test: (content) =>
      /from\s+['"]fastify['"]/.test(content) ||
      /\bFastify(Request|Reply|Instance)\b/.test(content),
    message: "services 层检测到 Fastify 依赖，请保持与 web 层解耦"
  },
  {
    name: "routes 禁止直接 new DatabaseSync",
    baseDir: "apps/host-api/src/routes",
    fileExts: [".ts", ".tsx", ".js", ".mjs", ".cjs"],
    test: (content) =>
      /\bnew\s+DatabaseSync\s*\(/.test(content) || /from\s+['"]node:sqlite['"]/.test(content),
    message: "routes 层禁止直接创建 SQLite 连接，请通过 repository 访问"
  },
  {
    name: "controllers 文件行数上限",
    baseDir: "apps/host-api/src/controllers",
    fileExts: [".ts", ".tsx", ".js", ".mjs", ".cjs"],
    test: (content) => content.split(/\r?\n/).length > 260,
    message: "controllers 文件超过 260 行，请拆分控制器职责"
  },
  {
    name: "services 禁止依赖 routes/controllers",
    baseDir: "apps/host-api/src/services",
    fileExts: [".ts", ".tsx", ".js", ".mjs", ".cjs"],
    test: (content) =>
      /from\s+['"].*\/routes\//.test(content) || /from\s+['"].*\/controllers\//.test(content),
    message: "services 层禁止依赖 routes/controllers，请保持单向依赖"
  },
  {
    name: "services 禁止 import providers",
    baseDir: "apps/host-api/src/services",
    fileExts: [".ts", ".tsx", ".js", ".mjs", ".cjs"],
    test: (content) => /from\s+['"][^'"]*\/providers\//.test(content),
    message:
      "services 不得 import providers（含 import type）；请用 core 端口类型或组合根（app.ts）接线"
  },
  {
    name: "providers 禁止 import services",
    baseDir: "apps/host-api/src/providers",
    fileExts: [".ts", ".tsx", ".js", ".mjs", ".cjs"],
    test: (content) => /from\s+['"][^'"]*\/services\//.test(content),
    message:
      "providers 不得 import services；请用组合根（app.ts）注入闭包或经 Host Event Hub 等边界通信"
  },
  {
    name: "features hooks 禁止直接 DOM 操作",
    baseDir: "apps/host-console/src/features",
    fileExts: [".ts", ".tsx", ".js", ".jsx"],
    test: (content, file) =>
      /[/\\]hooks[/\\]/.test(file) &&
      /\b(document|window)\.(querySelector|getElementById|createElement|body|location)\b/.test(
        content
      ),
    message: "hooks 层检测到 DOM 直接操作，请将 DOM 操作放到组件层"
  }
];

async function walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return [full];
    })
  );
  return files.flat();
}

function supportsExt(file, exts) {
  return exts.includes(path.extname(file));
}

function stripLineComments(text) {
  return text.replace(/\/\/[^\n]*/g, "");
}

/** 去掉 `export type …`，避免把类型导出计成运行时导出 */
function stripExportTypeBlocks(text) {
  return text
    .replace(/export\s+type\s+[^;{}]+;/g, "")
    .replace(/export\s+type\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*;?/g, "");
}

/**
 * 规则 A：`providers/<包>/index.ts` 仅允许 **恰好 1 个** 运行时导出（`export class` 或 `export { X } from`，且 `X` 不得带 `type` 前缀）。
 * 其余仅允许 `export type` / `export { type … } from`。
 */
function validateProviderIndex(content) {
  const t = stripExportTypeBlocks(stripLineComments(content));
  if (/\bexport\s+function\b/.test(t)) {
    return "禁止 export function；请收进唯一 class 的实例方法或 static";
  }
  if (/\bexport\s+const\b/.test(t)) {
    return "禁止 export const；请放在实现文件或由 class static 暴露";
  }
  if (/\bexport\s+enum\b/.test(t)) {
    return "禁止 export enum";
  }
  if (/\bexport\s+\*\s+from\b/.test(t)) {
    return "禁止 export * from";
  }
  if (/\bexport\s+default\b/.test(t)) {
    return "禁止 export default；请仅 export 唯一 class（或单标识 re-export）";
  }
  const classMatches = [...t.matchAll(/\bexport\s+(?:abstract\s+)?class\b/g)];
  let braceValues = 0;
  const re = /export\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const inner = m[1] ?? "";
    const parts = inner
      .split(",")
      .map((s) => s.trim())
      .filter((p) => p.length > 0 && !/^type\s/.test(p));
    braceValues += parts.length;
  }
  const total = classMatches.length + braceValues;
  if (total !== 1) {
    return `须恰好 1 个运行时导出（class 或单值 re-export），当前合计 ${total}（export class: ${classMatches.length}，export {…}from 非 type 项: ${braceValues}）`;
  }
  return null;
}

const violations = [];

for (const rule of rules) {
  const absBase = path.join(root, rule.baseDir);
  const files = await walk(absBase);
  for (const file of files) {
    if (!supportsExt(file, rule.fileExts)) continue;
    const content = await fs.readFile(file, "utf8");
    if (rule.test(content, file)) {
      violations.push({
        rule: rule.name,
        file: path.relative(root, file),
        message: rule.message
      });
    }
  }
}

const providersRoot = path.join(root, "apps/host-api/src/providers");
try {
  const providerEntries = await fs.readdir(providersRoot, { withFileTypes: true });
  for (const ent of providerEntries) {
    if (!ent.isDirectory()) continue;
    const indexPath = path.join(providersRoot, ent.name, "index.ts");
    let content;
    try {
      content = await fs.readFile(indexPath, "utf8");
    } catch {
      violations.push({
        rule: "providers/index 规则 A",
        file: path.relative(root, path.join(providersRoot, ent.name)),
        message: `缺少 index.ts：每个 provider 子目录须有 index.ts，且仅导出唯一 class（+ 任意 export type）`
      });
      continue;
    }
    const msg = validateProviderIndex(content);
    if (msg) {
      violations.push({
        rule: "providers/index 规则 A",
        file: path.relative(root, indexPath),
        message: msg
      });
    }
  }
} catch {
  // providers 目录不存在则跳过
}

if (violations.length > 0) {
  console.error("架构规则检查失败：");
  for (const v of violations) {
    console.error(`- [${v.rule}] ${v.file}: ${v.message}`);
  }
  process.exit(1);
}

console.log("架构规则检查通过。");
