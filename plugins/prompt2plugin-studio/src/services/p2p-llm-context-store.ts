import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { HostLlmMessage } from "@wclaw/plugin-sdk";

import { DEFAULT_P2P_GLOBAL_LLM_SKILL } from "./p2p-default-global-llm-skill.js";

export type P2pLlmContextFilePayload = {
  sessionId: string;
  updatedAt: string;
  /** 仅保留 user / assistant，供多轮拼接；每轮业务可再追加独立 system */
  messages: HostLlmMessage[];
};

export type P2pLlmContextPrepareOptions = {
  /** @todo 长会话：按 token 预算截断 / 摘要后传入宿主 */
  maxTokens?: number;
  /** @todo 长会话：最多保留末 N 条消息 */
  maxMessages?: number;
};

export type P2pLlmContextCompactOptions = {
  /** @todo 实现：summarize | truncate_last | 自定义策略 */
  strategy?: "summarize" | "truncate";
};

/**
 * Prompt2Plugin Studio：按 `sessionId` 隔离的 LLM 多轮消息缓存（本地 JSON 文件）。
 * 进程内单例，需先 `configure(pluginDir)` 再读写（由 runtime 在 `executeTurn` 入口配置）。
 */
export class P2pLlmContextStore {
  private static inst: P2pLlmContextStore | null = null;

  private pluginDir = "";
  private readonly mem = new Map<string, P2pLlmContextFilePayload>();

  private constructor() {}

  static getInstance(): P2pLlmContextStore {
    if (!P2pLlmContextStore.inst) {
      P2pLlmContextStore.inst = new P2pLlmContextStore();
    }
    return P2pLlmContextStore.inst;
  }

  /** 插件目录下的 `.p2p-cache/`（含 `llm-context/` 会话文件与 `global-llm-skill.md`）。 */
  configure(pluginDir: string): void {
    this.pluginDir = path.resolve(pluginDir);
  }

  private ensureConfigured(): string {
    if (!this.pluginDir) {
      throw new Error("P2pLlmContextStore: 未 configure(pluginDir)，请在 runtime executeTurn 入口调用");
    }
    return this.pluginDir;
  }

  private cacheRoot(): string {
    return path.join(this.ensureConfigured(), ".p2p-cache");
  }

  private llmSessionCacheDir(): string {
    return path.join(this.cacheRoot(), "llm-context");
  }

  /** 全局 LLM 技能（Markdown）：任意会话的 system 前置提示，可被宿主侧覆盖写入。 */
  private globalLlmSkillPath(): string {
    console.log("globalLlmSkillPath",path.join(this.cacheRoot(), "global-llm-skill.md"));
    return path.join(this.cacheRoot(), "global-llm-skill.md");
  }

  /**
   * 读取全局 system 技能正文。若磁盘文件不存在或为空，返回内置默认（与 AGENTS.md 口径一致的压缩版）。
   */
  async getGlobalLlmSkill(): Promise<string> {
    const fp = this.globalLlmSkillPath();
    try {
      const raw = await fs.readFile(fp, "utf-8");
      const t = raw.trim();
      if (t.length > 0) return t;
    } catch {
      // 未创建或不可读
    }
    return DEFAULT_P2P_GLOBAL_LLM_SKILL;
  }

  /**
   * 持久化全局 system 技能（覆盖写入）。写入后所有会话经 P2pLlmService 调用宿主 LLM 时都会前置该内容。
   */
  async setGlobalLlmSkill(markdown: string): Promise<void> {
    const dir = this.cacheRoot();
    await fs.mkdir(dir, { recursive: true });
    const fp = this.globalLlmSkillPath();
    const tmp = `${fp}.${process.pid}.tmp`;
    await fs.writeFile(tmp, markdown, "utf-8");
    await fs.rename(tmp, fp);
  }

  /** 删除自定义技能文件，效果上等价于下次 `getGlobalLlmSkill` 回退到内置默认（不自动删文件则读空也用默认）。 */
  async clearGlobalLlmSkillFile(): Promise<void> {
    try {
      await fs.unlink(this.globalLlmSkillPath());
    } catch {
      // ignore
    }
  }

  private filePath(sessionId: string): string {
    return path.join(this.llmSessionCacheDir(), `${safeSessionFileKey(sessionId)}.json`);
  }

  async loadSession(sessionId: string): Promise<HostLlmMessage[]> {
    const sid = normalizeSessionId(sessionId);
    const memHit = this.mem.get(sid);
    if (memHit) {
      return [...memHit.messages];
    }
    const fp = this.filePath(sid);
    try {
      const raw = await fs.readFile(fp, "utf-8");
      const parsed = JSON.parse(raw) as P2pLlmContextFilePayload;
      if (!parsed || !Array.isArray(parsed.messages)) {
        return [];
      }
      const filtered = parsed.messages.filter(
        (m): m is HostLlmMessage =>
          !!m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      );
      this.mem.set(sid, {
        sessionId: sid,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
        messages: filtered
      });
      return [...filtered];
    } catch {
      return [];
    }
  }

  async saveSession(sessionId: string, messages: HostLlmMessage[]): Promise<void> {
    const sid = normalizeSessionId(sessionId);
    const filtered = messages.filter(
      (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
    );
    const payload: P2pLlmContextFilePayload = {
      sessionId: sid,
      updatedAt: new Date().toISOString(),
      messages: filtered
    };
    this.mem.set(sid, payload);
    const dir = this.llmSessionCacheDir();
    await fs.mkdir(dir, { recursive: true });
    const fp = this.filePath(sid);
    const tmp = `${fp}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    await fs.rename(tmp, fp);
  }

  async appendExchange(sessionId: string, userContent: string, assistantContent: string): Promise<void> {
    const prev = await this.loadSession(sessionId);
    const next: HostLlmMessage[] = [
      ...prev,
      { role: "user", content: userContent },
      { role: "assistant", content: assistantContent }
    ];
    await this.saveSession(sessionId, next);
  }

  async clearSession(sessionId: string): Promise<void> {
    const sid = normalizeSessionId(sessionId);
    this.mem.delete(sid);
    try {
      await fs.unlink(this.filePath(sid));
    } catch {
      // ignore
    }
  }

  /**
   * 将磁盘中的多轮 user/assistant 与本轮尾部消息（通常含 system + user）拼接，供 `llm.text` / `llm.call`。
   * @todo 长会话：按 `maxTokens` / `maxMessages` 截断或摘要后再返回。
   */
  async prepareMessagesForInvoke(
    sessionId: string,
    tailMessages: HostLlmMessage[],
    _options?: P2pLlmContextPrepareOptions
  ): Promise<HostLlmMessage[]> {
    void _options;
    const history = await this.loadSession(sessionId);
    return [...history, ...tailMessages];
  }

  /**
   * @todo 长会话：侧车摘要或截断，写回 `saveSession`。
   */
  async compactSession(_sessionId: string, _options?: P2pLlmContextCompactOptions): Promise<void> {
    void _sessionId;
    void _options;
  }

  /**
   * @todo 长会话：与宿主 tokenizer 对齐的 token 估算；当前仅返回字符数占位。
   */
  async estimatePromptSize(sessionId: string): Promise<{ charCount: number; tokenEstimate?: number }> {
    const messages = await this.loadSession(sessionId);
    const charCount = messages.reduce((a, m) => a + m.content.length, 0);
    return { charCount, tokenEstimate: undefined };
  }
}

function normalizeSessionId(sessionId: string): string {
  const s = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : "default";
  return s;
}

/** 避免路径穿越与跨平台非法文件名字符 */
function safeSessionFileKey(sessionId: string): string {
  const s = normalizeSessionId(sessionId);
  if (s === "default") return "default";
  const safe = /^[a-zA-Z0-9._-]+$/.test(s) && s.length <= 200;
  if (safe) return s;
  const h = createHash("sha256").update(s, "utf8").digest("hex").slice(0, 40);
  return `s_${h}`;
}
