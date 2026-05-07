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

const LINUX_DO_ORIGIN = "https://linux.do";
const TOPIC_DETAIL_CONSUMED_PATH = "cache/topic-detail-consumed.json";
const GANALYSIS_MAX_ATTEMPTS = 3;

type TopicDetailJson = {
  id?: number;
  title?: string;
  slug?: string;
  created_at?: string;
  post_stream?: {
    posts?: Array<{ username?: string; cooked?: string }>;
  };
};

type TopicDetailExtract = {
  id: number;
  title: string;
  slug: string;
  topicUrl: string;
  createdAt: string;
  username: string;
  cookedHtml: string;
};

type ConsumedTopicIdsPayload = {
  topicIds?: number[];
};

type GanalysisTopicResult = {
  /** workspace 相对路径 */
  relativePath: string;
  topicId: number;
  title: string;
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
      // 同一 Playwright MCP 会话下并发 navigate 会互相覆盖页面，须在单会话内串行拉列表
      const hotTopics = await this.getTopics(ctx, "hot");
      const newsTopics = await this.getTopics(ctx, "c/news/34");
      const allTopics = [...hotTopics, ...newsTopics];
      emit("info", { summary: `获取到 ${allTopics.length} 个主题` });
      const rankedTopics = await this.orderTopics(allTopics);
      emit("info", { summary: `排序后 ${rankedTopics.length} 个主题` });
      if (allTopics.length === 0) {
        emit("error", {
          summary:
            "列表为空：未得到含 topic_list 的 JSON（多为 CF 挑战页、网络或 MCP 异常）。请开 debugListFetch 看正文片段；WSL 建议有头 Playwright：DISPLAY=:0，MCP 勿加 --headless。"
        });
        return toTurnResult(
          "[linux-do-fetch] 未获取到列表。请开启插件 debugListFetch 并检查 Playwright MCP / 网络 / WAF。"
        );
      }
      if (rankedTopics.length === 0) {
        emit("error", {
          summary: `共拉取 ${allTopics.length} 条，排序后均被过滤（置顶/公告/非 regular）。可换一个分类或减少过滤。`
        });
        return toTurnResult("[linux-do-fetch] 排序后无可用主题。");
      }
      const llmPickedTopics = await this.pickTopicsByLlm(rankedTopics);
      emit("info", { summary: `LLM 选出 ${llmPickedTopics.length} 个主题` });
      // await this.writeTopicCache(rankedTopics, llmPickedTopics);
     
      const ganalysisResult = await this.ganalysisTopic(ctx,llmPickedTopics);
      if (ganalysisResult) {
        emit("success", { summary: `执行成功: ${ganalysisResult.relativePath}` });
        return toTurnResult(JSON.stringify(ganalysisResult, null, 2));
      } else {
        emit("error", { summary: `执行失败: 没有找到适合分析的主题` });
        return toTurnResult(`[linux-do-fetch] 执行失败: 没有找到适合分析的主题`);
      }
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
  /**
   * 按候选队列深度分析 linux.do 主题：拉取 `/t/{id}.json` 首帖详情，LLM 判断是否适合公众号发布；
   * 不适合则换队列中下一项，单轮最多尝试 {@link GANALYSIS_MAX_ATTEMPTS} 次。
   * 成功拉取详情的主题 ID 会写入 workspace 排除列表，后续运行不再处理。
   * 适合则生成微信图文风 Markdown（图片保留原文 `![](url)`），写入 `articles/`。
   */
  private async ganalysisTopic(
    ctx: PluginTurnContext,
    candidates: Topic[]
  ): Promise<GanalysisTopicResult | null> {
    const emit = this.createActivityEmitter(ctx);
    const consumed = await this.loadConsumedTopicIds();
    const queue = candidates.filter((t) => Number.isInteger(t.id) && t.id > 0 && !consumed.has(t.id));
    await this.workspace.ensureDir("articles");
    let attempts = 0;
    for (const topic of queue) {
      if (attempts >= GANALYSIS_MAX_ATTEMPTS) break;
      attempts += 1;
      const detailJson = await this.fetchTopicDetailJson(ctx, topic.id);
      if (!detailJson) continue;
      await this.appendConsumedTopicId(topic.id);
      const extracted = this.extractTopicDetail(topic, detailJson);
      if (!extracted) continue;
      const judgment = await this.judgeTopicPublishSuitability(extracted);
      emit("info", { summary: `判断主题是否适合发布: ${judgment.suitable}` });
      if (!judgment.suitable) continue;
      const md = await this.buildWeixinStyleMarkdown(extracted);
      const slugSafe = this.slugSafeForFilename(extracted.slug);
      const relativePath = `articles/${extracted.id}-${slugSafe}.md`;
      await this.workspace.writeText(relativePath, md);
      return { relativePath, topicId: extracted.id, title: extracted.title };
    }
    return null;
  }

  private slugSafeForFilename(slug: string): string {
    const trimmed = String(slug || "topic").trim() || "topic";
    const safe = trimmed.replace(/[^a-zA-Z0-9\u4e00-\u9fff\-_]/g, "-").replace(/-+/g, "-");
    return safe.slice(0, 80) || "topic";
  }

  private async loadConsumedTopicIds(): Promise<Set<number>> {
    const empty = new Set<number>();
    if (!(await this.workspace.exists(TOPIC_DETAIL_CONSUMED_PATH))) return empty;
    try {
      const data = await this.workspace.readJson<ConsumedTopicIdsPayload>(TOPIC_DETAIL_CONSUMED_PATH);
      const ids = Array.isArray(data.topicIds) ? data.topicIds : [];
      return new Set(ids.filter((n): n is number => Number.isInteger(n) && (n as number) > 0));
    } catch {
      return empty;
    }
  }

  private async appendConsumedTopicId(id: number): Promise<void> {
    const set = await this.loadConsumedTopicIds();
    if (set.has(id)) return;
    set.add(id);
    await this.workspace.writeJson(TOPIC_DETAIL_CONSUMED_PATH, {
      topicIds: [...set].sort((a, b) => a - b)
    });
  }

  private async fetchTopicDetailJson(ctx: PluginTurnContext, topicId: number): Promise<TopicDetailJson | null> {
    await this.mcp.call(ctx, {
      toolId: "playwright/browser_navigate",
      arguments: { url: `${LINUX_DO_ORIGIN}/t/${topicId}.json` }
    });
    const data = await this.evaluateLinuxDoPageBodyJson(ctx);
    if (!data || typeof data !== "object") return null;
    return data as TopicDetailJson;
  }

  private extractTopicDetail(topic: Topic, detail: TopicDetailJson): TopicDetailExtract | null {
    const firstPost = detail.post_stream?.posts?.[0] ?? {};
    const id = topic.id;
    const title = String(detail.title || topic.title || "").trim();
    const slug = String(detail.slug || "").trim();
    if (!title) return null;
    const pathSlug = slug || "topic";
    return {
      id,
      title,
      slug: pathSlug,
      topicUrl: `${LINUX_DO_ORIGIN}/t/${pathSlug}/${id}`,
      createdAt: String(detail.created_at || topic.created_at || ""),
      username: String(firstPost.username || ""),
      cookedHtml: String(firstPost.cooked || "")
    };
  }

  private htmlToPlainPreview(html: string, maxLen: number): string {
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ");
    const text = stripped.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + "…";
  }

  private extractImgSrcsFromHtml(html: string): string[] {
    const out: string[] = [];
    const re = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const u = m[1]?.trim();
      if (u) out.push(u);
    }
    return [...new Set(out)];
  }

  private isObviouslyNotNewsTopic(extract: TopicDetailExtract): boolean {
    const text = `${extract.title}\n${this.htmlToPlainPreview(extract.cookedHtml, 2000)}`.toLowerCase();
    const blockedWords = [
      "评比",
      "大赛",
      "比赛",
      "抽奖",
      "投票",
      "征集",
      "活动帖",
      "报名",
      "打卡",
      "互助",
      "求助",
      "闲聊",
      "水贴",
      "吐槽",
      "广告",
      "推广"
    ];
    return blockedWords.some((w) => text.includes(w));
  }

  private parseLlmSuitability(text: string): { suitable: boolean; reason?: string } | null {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const block = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
    try {
      const parsed = JSON.parse(block) as { suitable?: unknown; reason?: unknown };
      if (typeof parsed.suitable !== "boolean") return null;
      return {
        suitable: parsed.suitable,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined
      };
    } catch {
      return null;
    }
  }

  private async judgeTopicPublishSuitability(extract: TopicDetailExtract): Promise<{
    suitable: boolean;
    reason?: string;
  }> {
    if (this.isObviouslyNotNewsTopic(extract)) {
      return {
        suitable: false,
        reason: "命中规则过滤：社区活动/互动/灌水类，非公众号新闻稿方向"
      };
    }
    const previewText = this.htmlToPlainPreview(extract.cookedHtml, 6000);
    const llmText = await this.llm.text({
      messages: [
        {
          role: "system",
          content:
            "你是公众号新闻选题编辑。目标仅保留“可发布的新闻/快讯/深度解读”类稿件。必须排除：时政争议、低俗博彩诈骗、导流营销、人身攻击，以及社区互动帖（评比/大赛/抽奖/投票/报名/征集/打卡/闲聊/求助/吐槽/水贴）。技术、产品、开源、行业动态通常可用。仅返回 JSON：{\"suitable\":true|false,\"reason\":\"一句话\"}"
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              title: extract.title,
              url: extract.topicUrl,
              author: extract.username,
              bodyPreview: previewText
            },
            null,
            2
          )
        }
      ]
    });
    return this.parseLlmSuitability(llmText) ?? {
      suitable: false,
      reason: "LLM 未返回合法 JSON"
    };
  }

  private async buildWeixinStyleMarkdown(extract: TopicDetailExtract): Promise<string> {
    const imgUrls = this.extractImgSrcsFromHtml(extract.cookedHtml);
    const llmText = await this.llm.text({
      messages: [
        {
          role: "system",
          content: `你是微信公众号图文编辑。根据给定材料撰写可直接发布的图文稿（Markdown）。
要求：
- 简体中文，专业友好。
- 使用 ## 分节、列表适度组织。
- 图片：正文中用 ![](完整URL) 引用；只能使用提供的 imageUrls 中的 URL，禁止编造链接。
- 不要输出 HTML。
- 正文以一级标题开头：文章主标题独占一行（# + 空格 + 标题），可与 topicTitle 一致或略优化。`
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              topicTitle: extract.title,
              topicUrl: extract.topicUrl,
              author: extract.username,
              imageUrls: imgUrls,
              sourceHtml: extract.cookedHtml.slice(0, 120000)
            },
            null,
            2
          )
        }
      ]
    });
    const meta =
      `<!-- source: linux.do -->\n\n` +
      `- 主题 ID: ${extract.id}\n` +
      `- 链接: ${extract.topicUrl}\n` +
      `- 抓取时间: ${new Date().toISOString()}\n\n`;
    return meta + llmText.trim();
  }

  /** 解析 MCP evaluate 正文块里的 JSON（与同页先有 navigate） */
  private parseEvaluateBodyBlockJson(resultBlock: string): unknown | null {
    try {
      const firstParsed = JSON.parse(resultBlock);
      return typeof firstParsed === "string" ? JSON.parse(firstParsed) : firstParsed;
    } catch {
      return null;
    }
  }

  /** navigate 后对当前页的 `browser_evaluate` 原始正文块（不解析 JSON） */
  private async evaluateLinuxDoPageBodyTextBlock(ctx: PluginTurnContext): Promise<string> {
    const evalResult = await this.mcp.call(ctx, {
      toolId: "playwright/browser_evaluate",
      arguments: { function: "() => document.body?.textContent ?? ''" }
    });

    const normalizedData =
      "data" in evalResult ? (evalResult as { data?: unknown }).data : undefined;
    if (normalizedData !== null && normalizedData !== undefined) {
      return typeof normalizedData === "string" ? normalizedData : JSON.stringify(normalizedData);
    }
    const normalizedText =
      "text" in evalResult ? (evalResult as { text?: string | null }).text : undefined;
    const rawText = String(
      normalizedText ||
        (evalResult as { result?: { content?: Array<{ text?: string }> } }).result?.content?.[0]?.text ||
        ""
    );
    return rawText.match(/###\s*Result\s*([\s\S]*?)(?:\n###\s|$)/i)?.[1]?.trim() || rawText.trim();
  }

  /** 当前页已通过 navigate 加载 linux.do *.json 后，解析 evaluate 结果为 JSON */
  private async evaluateLinuxDoPageBodyJson(ctx: PluginTurnContext): Promise<unknown | null> {
    const block = await this.evaluateLinuxDoPageBodyTextBlock(ctx);
    return this.parseEvaluateBodyBlockJson(block);
  }

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

  private isDebugListFetch(config: Record<string, unknown>): boolean {
    const v = config.debugListFetch;
    return v === true || v === "true";
  }

  /** 截取单行便于活动里阅读的调试片段 */
  private oneLineSnippet(text: string, maxChars: number): string {
    return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
  }

  //获取主题列表
  async getTopics(ctx: PluginTurnContext, cate: string): Promise<Topic[]> {
    const debugFetch = this.isDebugListFetch(ctx.config);
    const dbgEmit = debugFetch ? this.createActivityEmitter(ctx) : null;

    await this.mcp.call(ctx, {
      toolId: "playwright/browser_navigate",
      arguments: { url: `https://linux.do/${cate}.json` }
    });
    const textBlock = await this.evaluateLinuxDoPageBodyTextBlock(ctx);
    const data = textBlock ? this.parseEvaluateBodyBlockJson(textBlock) : null;

    const listing = (data as TopicPayload) ?? null;
    const topics = listing?.topic_list?.topics || [];

    if (dbgEmit && ((!data && textBlock) || topics.length === 0)) {
      dbgEmit("debug-list-fetch", {
        summary: `[${cate}] 解析 topic_list=${topics.length}，正文前几字: ${this.oneLineSnippet(textBlock || "(empty)", 400)}`
      });
    }

    if (!data) {
      return [];
    }
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
