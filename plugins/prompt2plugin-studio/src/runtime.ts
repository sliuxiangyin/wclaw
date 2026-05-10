import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  PluginRuntimeExtension,
  PluginRuntimeExtensionDeps,
  PluginSessionRow,
  PluginTurnContext,
  PluginTurnHandleResult,
  PluginExecuteCompletedInput
} from "@wclaw/plugin-sdk";

import { BasePluginRuntime, toTurnResult } from "@wclaw/plugin-sdk";
import PluginTurnHandler from "./plugin-turn.js";
import { TurnContextEmitter } from "@wclaw/plugin-sdk";
import { isValidPluginId, nextActionWithPluginId, parseCommand, toNowIso } from "./tools.js";
import { parseP2pInitArgs } from "./args/p2p-init-args.js";
import { parseP2pSpecArgs } from "./args/p2p-spec-args.js";
import { parseP2pGenerateArgs } from "./args/p2p-generate-args.js";
import { parseP2pValidateArgs } from "./args/p2p-validate-args.js";
import { parseP2pStatusArgs } from "./args/p2p-status-args.js";
import { parseP2pTestArgs } from "./args/p2p-test-args.js";
import { parseP2pPromoteArgs } from "./args/p2p-promote-args.js";
import { parseP2pRollbackArgs } from "./args/p2p-rollback-args.js";
import { P2P_NEXT } from "./constants.js";
import { P2pLlmContextStore } from "./services/p2p-llm-context-store.js";
import { P2pLlmService } from "./services/p2p-llm-service.js";

export default class Prompt2PluginStudioRuntime extends BasePluginRuntime implements PluginRuntimeExtension {
  private readonly pluginDir: string;
  private readonly pluginsRoot: string;
  private readonly draftsRoot: string;

  constructor(deps: PluginRuntimeExtensionDeps) {
    super(deps, { requiredBridges: ["llm"] });
    const runtimeFile = fileURLToPath(import.meta.url);
    this.pluginDir = path.resolve(path.dirname(runtimeFile), "..");
    this.pluginsRoot = path.resolve(this.pluginDir, "..");
    this.draftsRoot = path.join(this.pluginsRoot, ".drafts");
    P2pLlmContextStore.getInstance().configure(this.pluginDir);
    P2pLlmService.getInstance().configure(this.llm, P2pLlmContextStore.getInstance());
  }

  async executeTurn(ctx: PluginTurnContext): Promise<PluginTurnHandleResult> {
    const pluginTurnHandler = new PluginTurnHandler(new TurnContextEmitter(ctx, this.pluginId), {
      pluginId: this.pluginId,
      pluginDir: this.pluginDir,
      pluginsRoot: this.pluginsRoot,
      draftsRoot: this.draftsRoot,
      p2pLlm: P2pLlmService.getInstance()
    });
    const parsed = parseCommand(ctx);

    if (parsed.command.includes("/p2p.")) {
      // 预留：经 LLM 解析意图后路由到子命令
    }

    // 在 plugins/.drafts/<pluginId>/ 下创建草稿目录、.p2p-meta.json 与初始占位
    if (parsed.command === "/p2p.init") {
      const params = parseP2pInitArgs(parsed.args);
      return pluginTurnHandler.init(params);
    }
    // 读取元数据与状态，提示下一步命令（不改动文件）
    if (parsed.command === "/p2p.status") {
      const params = parseP2pStatusArgs(parsed.args);
      return pluginTurnHandler.status(params);
    }
    // 写入或更新草稿内的规范（spec），供后续 generate 消费
    if (parsed.command === "/p2p.spec") {
      const params = parseP2pSpecArgs(parsed.args);
      return pluginTurnHandler.spec(params);
    }
    // 按 spec 生成 plugin.json、package.json、src/runtime.ts 等骨架文件
    if (parsed.command === "/p2p.generate") {
      const params = parseP2pGenerateArgs(parsed.args);
      return pluginTurnHandler.generate(params);
    }
    // 清单与契约校验；full 时在草稿目录执行 pnpm 安装与构建并做入口冒烟
    if (parsed.command === "/p2p.validate") {
      const params = parseP2pValidateArgs(parsed.args);
      return pluginTurnHandler.validate(params);
    }
    // 动态 import 构建产物，对 executeTurn 做最小断言，通过后 meta.status → tested
    if (parsed.command === "/p2p.test") {
      const params = parseP2pTestArgs(parsed.args);
      return pluginTurnHandler.test(params);
    }
    // 将已通过 test 的草稿复制/提升到仓库 plugins/<pluginId>/（正式插件目录）
    if (parsed.command === "/p2p.promote") {
      const params = parseP2pPromoteArgs(parsed.args);
      return pluginTurnHandler.promote(params);
    }
    // 从 plugins/<id>/_snapshots/<revision>/ 恢复快照到稳定目录，并对 plugin.json 做清单校验
    if (parsed.command === "/p2p.rollback") {
      const params = parseP2pRollbackArgs(parsed.args);
      return pluginTurnHandler.rollback(params);
    }

    const exampleId =
      parsed.args[0] && isValidPluginId(String(parsed.args[0]).trim())
        ? String(parsed.args[0]).trim()
        : "demo-plugin";
    return {
      text:
        "支持命令:\n" +
        `1) ${nextActionWithPluginId(P2P_NEXT.initHint, exampleId)}\n` +
        `2) ${nextActionWithPluginId(P2P_NEXT.spec, exampleId)}\n` +
        `3) ${nextActionWithPluginId(P2P_NEXT.generate, exampleId)}\n` +
        `4) ${nextActionWithPluginId(P2P_NEXT.validate, exampleId)}\n` +
        `5) ${nextActionWithPluginId(P2P_NEXT.test, exampleId)}\n` +
        `6) ${nextActionWithPluginId(P2P_NEXT.promote, exampleId)}\n` +
        `7) ${nextActionWithPluginId(P2P_NEXT.rollback, exampleId)}\n` +
        `8) ${nextActionWithPluginId(P2P_NEXT.status, exampleId)}`
    };
  }

  decorateSessions(): PluginSessionRow[] {
    const sessionId = `${this.pluginId}:default`;
    return [
      {
        sessionId,
        updatedAt: toNowIso(),
        title: "Prompt2Plugin Studio",
        ui: {
          subtitle: "init → spec → generate → validate → test → promote",
          badges: ["prompt2plugin", "draft"],
          welcome:
            "我是 Prompt2Plugin Studio。\n" +
            "用 /p2p.init 创建草稿，按 /p2p.status 提示推进到 validate、test 与 promote。",
          suggestions: [
            {
              prompt: "/p2p.init demo-plugin --commandMode ephemeral_with_context",
              text: "初始化 command 插件草稿"
            },
            {
              prompt: "/p2p.status demo-plugin",
              text: "查看草稿状态与下一步"
            }
          ],
          chooses: [
            {
              pattern: String.raw`^/p2p\.init(\s|$)`,
              toolName: "ask_user_to_choose",
              args: {
                question: "请选择一个选项：",
                options: ["选项A - 了解一下", "选项B - 深入看看", "选项C - 换一个"]
              }
            }
          ]
        },
        forceExecuteTurn: true,
        persistence: "persist"
      }
    ];
  }

  executeCompleted(input: PluginExecuteCompletedInput): void {
    void input;
  }
}
