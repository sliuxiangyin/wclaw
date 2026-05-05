import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  PluginClearSessionContext,
  PluginRuntimeExtensionDeps,
  PluginTurnContext,
  PluginTurnHandleResult
} from "@wclaw/plugin-sdk";
import { BasePluginRuntime, PluginBridgeError, toTurnResult } from "@wclaw/plugin-sdk";
type Topic = {
  id: number;
  title: string;
  created_at?: string;
  pinned?: boolean;
  archetype?: string;
  like_count?: number;
  op_like_count?: number;
  reply_count?: number;
  posts_count?: number;
  views?: number;
};

type TopicPayload = {
  topic_list?: {
    topics?: Topic[];
  };
};

type LlmTopicPick = {
  selectedTopicIds: number[];
  reason?: string;
};

export default class LinuxDoFetchRuntime extends BasePluginRuntime {
  private readonly pluginRoot: string;

  constructor(deps: PluginRuntimeExtensionDeps) {
    super(deps, { requiredBridges: ["mcp", "llm"] });
    this.pluginRoot = path.dirname(fileURLToPath(import.meta.url));
  }

  async executeTurn(ctx: PluginTurnContext): Promise<PluginTurnHandleResult> {
    const emit = this.createActivityEmitter(ctx);
    emit("start", { summary: "开始执行 linux-do-fetch 流程。" });
    try {
     //前沿快讯 
    //  this.getTopics(ctx,"hot"),this.getTopics(ctx,"latest")
      const topicGroups = await Promise.all([this.getTopics(ctx,"hot"),this.getTopics(ctx, "c/news/34")]);
      const allTopics = topicGroups.flat();
      const rankedTopics = await this.orderTopics(allTopics);
      const llmPickedTopics = await this.pickTopicsByLlm(rankedTopics);
      await this.writeTopicCache(rankedTopics, llmPickedTopics);
      llmPickedTopics.forEach((topic) => {
        emit("topic", { summary: `主题: ${topic.title}` });
      });
      return toTurnResult(
        JSON.stringify(
          {
            llmPickedCount: llmPickedTopics.length,
            llmPickedItems: llmPickedTopics
          },
          null,
          2
        )
      );
    } catch (error) {
      const msg =error instanceof PluginBridgeError ? `[${error.bridge}] ${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
      emit("error", { summary: `执行失败: ${msg}` });
      return toTurnResult(`[linux-do-fetch] 执行失败: ${msg}`);
    } finally {
      await this.mcp.destroy(ctx, "playwright").catch(() => undefined);
    }
  }

  
  // 分析获取到的所有标题，让 LLM 选出更适合后续深度分析的主题
  async pickTopicsByLlm(rankedTopics: Topic[]): Promise<Topic[]> {
    if (rankedTopics.length === 0) return [];
    const candidates = rankedTopics;
    const prompt = JSON.stringify(
      candidates.map((t) => ({
        id: t.id,
        title: t.title,
        score: this.calcScore(t),
      })),
      null,
      2
    );
    const llmText = await this.llm.text({
      messages: [
        {
          role: "system",
          content:
            "你是内容选题编辑。只选择适合技术内容分析和发布的主题，优先：AI、科技、编程、教程、工程实践。必须排除：社会、政治、时政争议。返回严格 JSON。"
        },
        {
          role: "user",
          content:
            `请从候选主题中挑选 3-8 个最适合分析的标题。\n` +
            `仅返回 JSON，格式：{"selectedTopicIds":[number...],"reason":"一句话原因"}\n` +
            `候选列表如下：\n${prompt}`
        }
      ]
    });
    const picked = this.parseLlmTopicPick(llmText);
    if (!picked) return candidates.slice(0, 5);
    const idSet = new Set(picked.selectedTopicIds);
    const selected = candidates.filter((t) => idSet.has(t.id));
    return selected.length > 0 ? selected : candidates.slice(0, 5);
  }
  // 根据主题获取详情，并分析是否适合发布，如果不合适就重新获取下一个主题（最多三次），
  // 且生成适合微信图文公众号格式的内容，提取了详情无论合适不合适下次都需要排除，最后保存主题包括图片为markdown文件到插件目录的workspace


  private parseLlmTopicPick(text: string): LlmTopicPick | null {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const block = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
    try {
      const parsed = JSON.parse(block) as { selectedTopicIds?: unknown; reason?: unknown };
      const selectedTopicIds = Array.isArray(parsed.selectedTopicIds)
        ? parsed.selectedTopicIds
            .map((x) => Number(x))
            .filter((x) => Number.isInteger(x) && x > 0)
        : [];
      return {
        selectedTopicIds,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined
      };
    } catch {
      return null;
    }
  }
   

  async clearSession(ctx: PluginClearSessionContext): Promise<void> {
    void ctx;
  }

  private async writeTopicCache(rankedTopics: Topic[], llmPickedTopics: Topic[]): Promise<void> {
    const payload = {
      generatedAt: new Date().toISOString(),
      rankedCount: rankedTopics.length,
      llmPickedCount: llmPickedTopics.length,
      llmPickedItems: llmPickedTopics,
      rankedItems: rankedTopics
    };
    await this.workspace.writeJson("cache/topics.latest.json", payload);
  }

  //获取主题列表
  async getTopics(ctx: PluginTurnContext,cate:string): Promise<Topic[]> {
    await this.mcp.call(ctx, {
      toolId: "playwright/browser_navigate",
      arguments: { url: `https://linux.do/${cate}.json` }
    });
    const data = await this.invokeHostMcpBrowserEvaluate(ctx);
    if (!data) {
      return [];
    }
    
    const topics = data?.topic_list?.topics || [];
    const toOptionalNumber = (value: unknown): number | undefined => {
      if (value === null || value === undefined || value === "") return undefined;
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    };
    return topics
      .map((topic): Topic | null => {
        const id = toOptionalNumber(topic?.id);
        const title = String(topic?.title || "").trim();
        if (id === undefined || !title) return null;
        return {
          id,
          title,
          created_at: topic?.created_at ? String(topic.created_at) : undefined,
          pinned: typeof topic?.pinned === "boolean" ? topic.pinned : undefined,
          archetype: topic?.archetype ? String(topic.archetype) : undefined,
          like_count: toOptionalNumber(topic?.like_count),
          op_like_count: toOptionalNumber(topic?.op_like_count),
          reply_count: toOptionalNumber(topic?.reply_count),
          posts_count: toOptionalNumber(topic?.posts_count),
          views: toOptionalNumber(topic?.views)
        };
      })
      .filter((topic): topic is Topic => topic !== null);
  }
  //排序主题
  async orderTopics(topics: Topic[]) {
    const EXCLUDE_TITLE_WORDS = ["公告", "置顶", "站务公告", "版规", "活动预告"];
    const normalizeTitle = (title: string) =>
      String(title || "")
        .toLowerCase()
        .replace(/[\s\-_.,，。!?！？:：;；"'`~()[\]{}<>《》【】|\\/]+/g, "")
        .trim();
    const shouldExcludeTopic = (topic: Topic) => {
      if (!topic) return true;
      if (topic.pinned) return true;
      if (topic.archetype && topic.archetype !== "regular") return true;
      if (EXCLUDE_TITLE_WORDS.some((w) => String(topic.title || "").includes(w))) return true;
      return false;
    };
    const merged = topics.filter((t) => !shouldExcludeTopic(t));
    const idMap = new Map<number, Topic>();
    for (const topic of merged) {
      if (!idMap.has(topic.id)) idMap.set(topic.id, topic);
    }
    const titleMap = new Map<string, Topic & { score: number }>();
    for (const topic of idMap.values()) {
      const key = normalizeTitle(topic.title);
      if (!key) continue;
      const scored = { ...topic, score: this.calcScore(topic) };
      const old = titleMap.get(key);
      if (!old || scored.score > old.score) titleMap.set(key, scored);
    }
    return [...titleMap.values()].sort((a, b) => b.score - a.score);
  }
  //执行浏览器评估
  async invokeHostMcpBrowserEvaluate(ctx: PluginTurnContext): Promise<TopicPayload | null> {
    const evalResult = await this.mcp.call(ctx, {
      toolId: "playwright/browser_evaluate",
      arguments: { function: "() => document.body?.textContent ?? ''" }
    });

    const normalizedData =
      "data" in evalResult ? (evalResult as { data?: unknown }).data : undefined;
    if (normalizedData !== null && normalizedData !== undefined) {
      return normalizedData as TopicPayload;
    }
    const normalizedText =
      "text" in evalResult ? (evalResult as { text?: string | null }).text : undefined;
    const rawText = String(
      normalizedText ||
        (evalResult as { result?: { content?: Array<{ text?: string }> } })?.result?.content?.[0]?.text ||
        ""
    );
    const resultBlock = rawText.match(/###\s*Result\s*([\s\S]*?)(?:\n###\s|$)/i)?.[1]?.trim() || rawText.trim();
    try {
      const firstParsed = JSON.parse(resultBlock);
      return (typeof firstParsed === "string" ? JSON.parse(firstParsed) : firstParsed) as TopicPayload;
    } catch {
      return null;
    }
  }
  calcScore(topic: Topic): number {
    const now = Date.now();
    const ageHours = Math.max(0, (now - new Date(topic.created_at || Date.now()).getTime()) / 3600000);
    const likeCount = topic.like_count || topic.op_like_count || 0;
    const replyCount = topic.reply_count || topic.posts_count || 0;
    const views = topic.views || 0;
    const freshness = Math.max(0, 40 - ageHours * 1.2);
    const interaction = likeCount * 1.2 + replyCount * 1.8;
    const viewBonus = views >= 10000 ? 20 : views >= 3000 ? 10 : views >= 1000 ? 5 : 0;
    return Math.round(freshness + interaction + viewBonus);
  }
}
