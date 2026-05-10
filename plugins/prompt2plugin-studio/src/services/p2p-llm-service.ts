import type { HostLlmInvokeInput, HostLlmMessage } from "@wclaw/plugin-sdk";

import type { P2pLlmContextPrepareOptions, P2pLlmContextStore } from "./p2p-llm-context-store.js";

type HostLlmTextInput = Pick<HostLlmInvokeInput, "model" | "traceId" | "toolPolicy"> & {
  messages: HostLlmMessage[];
};

type HostLlmTextBridge = { text: (input: HostLlmInvokeInput) => Promise<string> };

/**
 * 封装宿主 `llm` 桥与 `P2pLlmContextStore`（进程内单例）。
 * 须在 `Prompt2PluginStudioRuntime` 构造函数中：
 * `P2pLlmContextStore.getInstance().configure(pluginDir)`，再
 * `P2pLlmService.getInstance().configure(this.llm, P2pLlmContextStore.getInstance())`。
 * 每次调用宿主 LLM 前会自动前置全局持久化技能（`getGlobalLlmSkill` / `setGlobalLlmSkill`）。
 */
export class P2pLlmService {
  private static inst: P2pLlmService | null = null;

  private llm: HostLlmTextBridge | null = null;
  private contextStore: P2pLlmContextStore | null = null;

  private constructor() {}

  static getInstance(): P2pLlmService {
    if (!P2pLlmService.inst) {
      P2pLlmService.inst = new P2pLlmService();
    }
    return P2pLlmService.inst;
  }

  configure(llm: HostLlmTextBridge, contextStore: P2pLlmContextStore): void {
    this.llm = llm;
    this.contextStore = contextStore;
  }

  private ensureLlm(): HostLlmTextBridge {
    if (!this.llm) {
      throw new Error(
        "P2pLlmService: 未 configure(llm, contextStore)，请在 runtime 构造函数中调用 getInstance().configure(this.llm, P2pLlmContextStore.getInstance())"
      );
    }
    return this.llm;
  }

  private ensureContextStore(): P2pLlmContextStore {
    if (!this.contextStore) {
      throw new Error(
        "P2pLlmService: 未 configure(llm, contextStore)，请在 runtime 构造函数中调用 getInstance().configure(this.llm, P2pLlmContextStore.getInstance())"
      );
    }
    return this.contextStore;
  }

  /**
   * 将全局持久化 skill（system）+ 会话持久化历史 + `tail.messages` 拼接后调用 `llm.text`。
   * 若提供 `exchangeUserText` 且返回非空字符串，则把该 user 与 assistant 正文追加进 Store。
   */
  async spec(
    sessionId: string,
    tail: HostLlmTextInput,
    options?: {
      prepare?: P2pLlmContextPrepareOptions;
      exchangeUserText?: string;
    }
  ): Promise<string> {
    const store = this.ensureContextStore();
    const skill = (await store.getGlobalLlmSkill()).trim();
    
    const merged = await store.prepareMessagesForInvoke(
      sessionId,
      tail.messages,
      options?.prepare
    );
    const messages: HostLlmMessage[] =
      skill.length > 0 ? [{ role: "system", content: skill }, ...merged] : merged;
    const out = await this.ensureLlm().text({
      model: tail.model,
      traceId: tail.traceId,
      toolPolicy: tail.toolPolicy,
      messages
    });
    const u = options?.exchangeUserText;
    if (u && typeof out === "string" && out.length > 0) {
      await store.appendExchange(sessionId, u, out);
    }
    return out;
  }
}
