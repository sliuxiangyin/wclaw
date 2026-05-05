import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import McpResultReader from "./mcp-result-reader.mjs";
import TopicPolicy from "./topic-policy.mjs";

export default class TopicPipeline {
  /**
   * @param {import("./playwright-client.mjs").default} browser
   * @param {import("./state-store.mjs").default} stateStore
   * @param {(input: {messages:Array<{role:"system"|"user"|"assistant", content:string}>, model?:string}) => Promise<{ok:boolean, text?:string, code?:string, message?:string}>} llmInvoke
   * @param {(phase:string, data?:Record<string, unknown>) => void | undefined} emitActivity
   */
  constructor(browser, stateStore, llmInvoke, emitActivity) {
    this.browser = browser;
    this.stateStore = stateStore;
    this.llmInvoke = llmInvoke;
    this.emitActivity = emitActivity;
  }

  emitProgress(phase, data) {
    if (typeof this.emitActivity !== "function") return;
    this.emitActivity(phase, {
      ...data,
      summary: String(data?.summary || "")
    });
  }

  async run(config) {
    this.emitProgress("start", { summary: "开始执行 linux-do-fetch 流程。" });
    this.emitProgress("state.prepare_dirs", { summary: "准备 data/premium 目录。" });
    await this.stateStore.ensureDirs();
    this.emitProgress("state.loading", { summary: "正在读取历史状态。" });
    const state = await this.stateStore.loadState();
    this.emitProgress("state.loaded", {
      summary: `历史状态读取完成：selected=${(state.selectedTopicIds || []).length}, rejected=${(state.rejectedTopicIds || []).length}`,
      selectedCount: (state.selectedTopicIds || []).length,
      rejectedCount: (state.rejectedTopicIds || []).length
    });
    this.emitProgress("topics.fetching", { summary: "正在通过 Playwright MCP 拉取 hot/latest 列表。" });
    const lists = await this.browser.fetchTopicLists();
    const hotCount = Array.isArray(lists?.hot) ? lists.hot.length : 0;
    const latestCount = Array.isArray(lists?.latest) ? lists.latest.length : 0;
    this.emitProgress("topics.fetched", {
      summary: `列表拉取完成：hot=${hotCount}, latest=${latestCount}`,
      hotCount,
      latestCount
    });
    if (hotCount === 0 && latestCount === 0) {
      const debug = lists?.debug || {};
      const hot = debug?.hot || {};
      const latest = debug?.latest || {};
      const consoleErrors = Array.isArray(debug?.consoleErrors) ? debug.consoleErrors : [];
      const hotPreview = String(hot.textPreview || "").replace(/\s+/g, " ").slice(0, 80);
      const latestPreview = String(latest.textPreview || "").replace(/\s+/g, " ").slice(0, 80);
      const rawShape = debug?.rawShape || {};
      this.emitProgress("topics.fetch_debug", {
        summary:
          `拉取结果为空；hot(status=${String(hot.status || "n/a")}, reason=${String(hot.errorReason || "none")}, keys=${JSON.stringify(hot.keys || [])}, preview=${JSON.stringify(hotPreview)})，` +
          `latest(status=${String(latest.status || "n/a")}, reason=${String(latest.errorReason || "none")}, keys=${JSON.stringify(latest.keys || [])}, preview=${JSON.stringify(latestPreview)})，` +
          `consoleErrors=${consoleErrors.length}，rawKeys=${JSON.stringify(rawShape.keys || [])}`,
        page: debug?.page || {},
        hot,
        latest,
        rawShape,
        consoleErrors
      });
    }
    const { ranked, stats } = this.rankCandidates(lists, state);
    this.emitProgress("topics.filter_stats", {
      summary:
        `过滤统计：合并=${stats.mergedCount}，blocked=${stats.blockedCount}，公告=${stats.announcementCount}，` +
        `无ID=${stats.emptyIdCount}，ID去重后=${stats.idDedupCount}，标题去重后=${stats.titleDedupCount}`,
      ...stats
    });
    this.emitProgress("topics.ranked", {
      summary: `列表已完成过滤与打分，候选 ${ranked.length} 条。`,
      candidateCount: ranked.length
    });
    if (ranked.length === 0) {
      this.emitProgress("topics.empty", {
        summary: "候选为 0：请检查历史排除列表或公告过滤规则。",
        ...stats
      });
      return { ok: false, message: "没有可分析的话题（可能都在已选/已拒列表，或都被公告规则过滤）。" };
    }

    const maxTry = Math.min(config.maxLlmAttempts, ranked.length);
    /** @type {Array<{topicId:string, score:number, suitable:boolean, reason:string}>} */
    const attempts = [];
    for (let i = 0; i < maxTry; i += 1) {
      const candidate = ranked[i];
      this.emitProgress("topic.selected_candidate", {
        summary: `选取第 ${i + 1} 名候选：${candidate.id}（score=${candidate.score}）`,
        attempt: i + 1,
        topicId: String(candidate.id),
        title: String(candidate.title || ""),
        score: Number(candidate.score || 0)
      });
      this.emitProgress("topic.detail.fetching", {
        summary: `正在拉取第 ${i + 1} 个候选详情：${candidate.id}`,
        attempt: i + 1,
        topicId: String(candidate.id),
        score: Number(candidate.score || 0)
      });
      const detail = await this.browser.fetchTopicDetail(candidate.id);
      const detailModel = this.toTopicDetailModel(candidate, detail);
      this.emitProgress("topic.llm.analyzing", {
        summary: `正在调用 LLM 判断新闻价值：${detailModel.id}`,
        attempt: i + 1,
        topicId: detailModel.id
      });
      const decision = await this.evaluateNewsValue(detailModel);
      attempts.push({ topicId: String(candidate.id), score: candidate.score, suitable: decision.suitable, reason: decision.reason });
      this.emitProgress("topic.llm.done", {
        summary: `LLM 判断完成：${candidate.id}，结果=${decision.suitable ? "通过" : "不通过"}`,
        attempt: i + 1,
        topicId: String(candidate.id),
        suitable: Boolean(decision.suitable),
        reason: String(decision.reason || "")
      });
      if (decision.suitable) {
        this.emitProgress("premium.saving", {
          summary: `正在保存 premium Markdown 与图片：${candidate.id}`,
          topicId: String(candidate.id)
        });
        const premiumPath = await this.savePremium(detailModel, decision.reason);
        state.selectedTopicIds.push(String(candidate.id));
        await this.stateStore.saveState(state);
        this.emitProgress("done", {
          summary: `流程完成，已入选 topic ${candidate.id}。`,
          selectedId: String(candidate.id),
          premiumPath
        });
        return {
          ok: true,
          selectedId: String(candidate.id),
          score: candidate.score,
          premiumPath,
          attempts
        };
      }
      state.rejectedTopicIds.push(String(candidate.id));
      this.emitProgress("topic.rejected", {
        summary: `话题 ${candidate.id} 未通过，继续下一候选。`,
        topicId: String(candidate.id)
      });
    }

    this.emitProgress("state.saving", { summary: "未命中 premium，正在落库 rejected 状态。" });
    await this.stateStore.saveState(state);
    this.emitProgress("done", { summary: "流程结束，前三候选均未通过新闻价值判断。" });
    return {
      ok: false,
      message: "前 3 名均未通过新闻价值判断。",
      attempts
    };
  }

  rankCandidates(lists, state) {
    const blocked = new Set([...(state?.selectedTopicIds || []), ...(state?.rejectedTopicIds || [])].map(String));
    const hotRaw = Array.isArray(lists?.hot) ? lists.hot.slice(0, 20) : [];
    const latestRaw = Array.isArray(lists?.latest) ? lists.latest.slice(0, 20) : [];
    const merged = [...hotRaw, ...latestRaw];
    let emptyIdCount = 0;
    let blockedCount = 0;
    let announcementCount = 0;
    const idDedup = new Map();
    for (const topic of merged) {
      const id = String(topic?.id || "");
      if (!id) {
        emptyIdCount += 1;
        continue;
      }
      if (blocked.has(id)) {
        blockedCount += 1;
        continue;
      }
      if (TopicPolicy.isAnnouncementTopic(topic)) {
        announcementCount += 1;
        continue;
      }
      if (!idDedup.has(id)) idDedup.set(id, topic);
    }
    const titleDedup = new Map();
    for (const topic of idDedup.values()) {
      const key = TopicPolicy.normalizeTitle(topic?.title);
      if (!key) continue;
      const scored = { ...topic, score: TopicPolicy.score(topic) };
      const old = titleDedup.get(key);
      if (!old || scored.score > old.score) titleDedup.set(key, scored);
    }
    return {
      ranked: [...titleDedup.values()].sort((a, b) => b.score - a.score),
      stats: {
        mergedCount: merged.length,
        blockedCount,
        announcementCount,
        emptyIdCount,
        idDedupCount: idDedup.size,
        titleDedupCount: titleDedup.size
      }
    };
  }

  toTopicDetailModel(candidate, detail) {
    const firstPost = detail?.post_stream?.posts?.[0] || {};
    const rawHtml = String(firstPost?.cooked || "");
    const slug = String(detail?.slug || candidate?.slug || "topic");
    return {
      id: String(candidate?.id || ""),
      title: String(detail?.title || candidate?.title || ""),
      score: Number(candidate?.score || 0),
      url: `${this.browser.baseUrl}/t/${slug}/${candidate?.id}`,
      createdAt: String(detail?.created_at || candidate?.created_at || ""),
      username: String(firstPost?.username || ""),
      rawHtml,
      contentText: this.htmlToText(rawHtml)
    };
  }

  async evaluateNewsValue(topic) {
    const systemPrompt =
      "你是内容编辑。请判断当前话题是否有新闻价值。新闻价值优先考虑：时效性、公共影响、信息密度、可验证事实、讨论热度。只输出 JSON，不要输出其它文本。";
    const userPrompt = JSON.stringify(
      {
        task: "判断该主题是否具有新闻价值，若适合进入 premium 返回 suitable=true。",
        topic: {
          id: topic.id,
          title: topic.title,
          score: topic.score,
          url: topic.url,
          createdAt: topic.createdAt,
          username: topic.username,
          content: topic.contentText.slice(0, 6000)
        },
        response_schema: {
          suitable: "boolean",
          reason: "string(<=120字)"
        }
      },
      null,
      2
    );
    const r = await this.llmInvoke({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });
    if (!r.ok) {
      throw new Error(`invokeHostLlm 失败: ${r.code} ${r.message}`);
    }
    const parsed = McpResultReader.tryParseJson(r.text);
    if (!parsed || typeof parsed !== "object") {
      return { suitable: false, reason: "LLM 输出不可解析，按不通过处理。" };
    }
    return {
      suitable: Boolean(parsed?.suitable),
      reason: String(parsed?.reason || "")
    };
  }

  async savePremium(topic, decisionReason) {
    const digest = createHash("sha1").update(topic.url).digest("hex").slice(0, 12);
    const topicDir = path.join(this.stateStore.premiumDir, `topic-${topic.id}-${digest}`);
    const imageDir = path.join(topicDir, "images");
    await mkdir(imageDir, { recursive: true });
    const markdown = await this.buildPremiumMarkdown(topic, decisionReason, imageDir);
    const mdPath = path.join(topicDir, "content.md");
    await writeFile(mdPath, markdown, "utf8");
    return mdPath;
  }

  async buildPremiumMarkdown(topic, decisionReason, imageDir) {
    const imageSources = this.extractImageSources(topic.rawHtml, topic.url);
    const localized = await this.downloadImages(imageSources, imageDir);
    let content = this.htmlToText(topic.rawHtml);
    const imageLines = localized.length
      ? `\n\n## 图片\n\n${localized.map((item) => `![image-${item.index}](./images/${item.fileName})`).join("\n")}\n`
      : "";
    content += imageLines;
    return [
      `# ${topic.title}`,
      "",
      `- 话题ID: ${topic.id}`,
      `- 链接: ${topic.url}`,
      `- 分数: ${topic.score}`,
      `- 作者: ${topic.username}`,
      `- 发布时间: ${topic.createdAt}`,
      `- 新闻价值判断: ${decisionReason || "通过"}`,
      "",
      "## 正文",
      "",
      content || "(无正文)",
      ""
    ].join("\n");
  }

  extractImageSources(rawHtml, topicUrl) {
    const base = new URL(topicUrl);
    const html = String(rawHtml || "");
    const matches = [...html.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi)];
    return matches
      .map((m) => String(m[1] || "").trim())
      .filter(Boolean)
      .map((src) => new URL(src, base).toString());
  }

  async downloadImages(sources, imageDir) {
    /** @type {Array<{index:number,fileName:string}>} */
    const out = [];
    for (let i = 0; i < sources.length; i += 1) {
      const source = sources[i];
      try {
        const resp = await fetch(source);
        if (!resp.ok) continue;
        const buffer = Buffer.from(await resp.arrayBuffer());
        const ext = this.pickImageExt(source, resp.headers.get("content-type"));
        const fileName = `img-${String(i + 1).padStart(2, "0")}.${ext}`;
        await writeFile(path.join(imageDir, fileName), buffer);
        out.push({ index: i + 1, fileName });
      } catch {
        // ignore single image failure
      }
    }
    return out;
  }

  pickImageExt(source, contentType) {
    const ct = String(contentType || "").toLowerCase();
    if (ct.includes("png")) return "png";
    if (ct.includes("gif")) return "gif";
    if (ct.includes("webp")) return "webp";
    if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
    const url = source.toLowerCase();
    if (url.includes(".png")) return "png";
    if (url.includes(".gif")) return "gif";
    if (url.includes(".webp")) return "webp";
    if (url.includes(".jpg") || url.includes(".jpeg")) return "jpg";
    return "jpg";
  }

  htmlToText(html) {
    return String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}
