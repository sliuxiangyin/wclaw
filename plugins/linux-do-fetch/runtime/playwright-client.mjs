import McpResultReader from "./mcp-result-reader.mjs";

export default class PlaywrightClient {
  /**
   * @param {(input: {toolId:string, arguments?:Record<string, unknown>, contextKey?:string}) => Promise<{ok:boolean, code?:string, message?:string, result?:unknown}>} invoke
   * @param {(input: {serverId:string, contextKey?:string}) => Promise<{ok:boolean}>} releaseContext
   * @param {string} baseUrl
   * @param {string} contextKey
   */
  constructor(invoke, releaseContext, baseUrl, contextKey) {
    this.invoke = invoke;
    this.releaseContext = releaseContext;
    this.baseUrl = baseUrl;
    this.contextKey = contextKey;
  }

  async prepareSession() {
    const nav = await this.invoke({
      toolId: "playwright/browser_navigate",
      arguments: { url: `${this.baseUrl}/latest` },
      contextKey: this.contextKey
    });
    if (!nav.ok) {
      throw new Error(`browser_navigate 失败: ${nav.code} ${nav.message}`);
    }
  }

  async readConsoleMessages() {
    const r = await this.invoke({ toolId: "playwright/browser_console_messages", arguments: {}, contextKey: this.contextKey });
    if (!r.ok) return [];
    const parsed = McpResultReader.parseMcpResult(r.result);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  }

  async evaluate(script) {
    const candidates = [{ function: script }, { expression: script }, { script }];
    /** @type {string[]} */
    const errors = [];
    for (const args of candidates) {
      const r = await this.invoke({ toolId: "playwright/browser_evaluate", arguments: args, contextKey: this.contextKey });
      if (r.ok) {
        const parsed = McpResultReader.parseMcpResult(r.result);
        if (parsed) return parsed;
        throw new Error(`browser_evaluate 返回无法解析: ${McpResultReader.stringify(r.result)}`);
      }
      errors.push(`${r.code} ${r.message}`);
    }
    throw new Error(`browser_evaluate 调用失败: ${errors.join(" | ")}`);
  }

  extractJsonFromText(text) {
    const source = String(text || "");
    const fenceMatch = source.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) {
      try {
        return JSON.parse(fenceMatch[1]);
      } catch {
        // ignore
      }
    }
    const resultMatch = source.match(/###\s*Result\s*([\s\S]*?)(?:\n###\s|$)/i);
    if (resultMatch?.[1]) {
      try {
        return JSON.parse(resultMatch[1].trim());
      } catch {
        // ignore
      }
    }
    return null;
  }

  async navigateAndReadJson(url) {
    const nav = await this.invoke({
      toolId: "playwright/browser_navigate",
      arguments: { url },
      contextKey: this.contextKey
    });
    if (!nav.ok) {
      return {
        ok: false,
        status: null,
        contentType: "",
        hasTopicList: false,
        topicCount: 0,
        keys: [],
        textPreview: "",
        parseError: `browser_navigate 失败: ${nav.code || ""} ${nav.message || ""}`.trim(),
        errorReason: "navigate_failed",
        topics: [],
        json: null
      };
    }
    const parsed = McpResultReader.parseMcpResult(nav.result);
    const json =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : this.extractJsonFromText(McpResultReader.stringify(nav.result));
    const hasTopicList = Boolean(json && json.topic_list);
    const topics = Array.isArray(json?.topic_list?.topics) ? json.topic_list.topics : [];
    let errorReason = "";
    if (!json) errorReason = "json_parse_failed";
    else if (!hasTopicList) errorReason = "missing_topic_list";
    return {
      ok: Boolean(json),
      status: Number(json?.status || 200),
      contentType: "application/json(navigate)",
      hasTopicList,
      topicCount: topics.length,
      keys: json && typeof json === "object" ? Object.keys(json).slice(0, 8) : [],
      textPreview: McpResultReader.stringify(nav.result).slice(0, 240),
      parseError: json ? "" : "无法从 browser_navigate 结果中解析 JSON",
      errorReason,
      topics,
      json
    };
  }

  async fetchTopicLists() {
    await this.prepareSession();
    const pageState = await this.evaluate(`
() => {
  const href = String(location?.href || "");
  const origin = String(location?.origin || "");
  return { href, origin, title: String(document?.title || "") };
}
`.trim());
    const inLinuxPage = true;

    if (inLinuxPage) {
      const script = `
() => {
  const BASE = location.origin;
  const load = async (path) => {
    let status = 0;
    let ok = false;
    let contentType = "";
    let text = "";
    let fetchError = "";
    try {
      const resp = await fetch(BASE + path, { credentials: "include", headers: { accept: "application/json, text/plain, */*" } });
      status = resp.status;
      ok = resp.ok;
      contentType = resp.headers.get("content-type") || "";
      text = await resp.text();
    } catch (e) {
      fetchError = String((e && e.message) || e || "fetch failed");
    }
    let json = null;
    let parseError = "";
    try {
      json = JSON.parse(text);
    } catch (e) {
      parseError = String((e && e.message) || e || "JSON parse failed");
    }
    const hasTopicList = Boolean(json && json.topic_list);
    const topics = Array.isArray(json?.topic_list?.topics) ? json.topic_list.topics : [];
    let errorReason = "";
    if (fetchError) {
      errorReason = "fetch_failed";
    } else if (!ok) {
      errorReason = "http_not_ok";
    } else if (!json) {
      errorReason = "json_parse_failed";
    } else if (!hasTopicList) {
      errorReason = "missing_topic_list";
    }
    return {
      path,
      status,
      ok,
      contentType,
      hasTopicList,
      topicCount: topics.length,
      keys: json && typeof json === "object" ? Object.keys(json).slice(0, 8) : [],
      textPreview: (text || "").slice(0, 240),
      parseError,
      fetchError,
      errorReason,
      topics
    };
  };
  return Promise.all([load("/hot.json"), load("/latest.json")]).then(([hot, latest]) => ({
    hot: hot.topics,
    latest: latest.topics,
    debug: {
      page: {
        href: location.href,
        origin: location.origin,
        title: document.title
      },
      hot: {
        status: hot.status,
        ok: hot.ok,
        contentType: hot.contentType,
        hasTopicList: hot.hasTopicList,
        topicCount: hot.topicCount,
        keys: hot.keys,
        textPreview: hot.textPreview,
        parseError: hot.parseError,
        fetchError: hot.fetchError,
        errorReason: hot.errorReason
      },
      latest: {
        status: latest.status,
        ok: latest.ok,
        contentType: latest.contentType,
        hasTopicList: latest.hasTopicList,
        topicCount: latest.topicCount,
        keys: latest.keys,
        textPreview: latest.textPreview,
        parseError: latest.parseError,
        fetchError: latest.fetchError,
        errorReason: latest.errorReason
      }
    }
  }));
}
`.trim();
      const data = await this.evaluate(script);
      console.log("datadatadatadatadata",data);
      const consoleMessages = await this.readConsoleMessages();
      const consoleErrors = consoleMessages
        .filter((item) => String(item?.type || "").toLowerCase() === "error")
        .slice(-5)
        .map((item) => String(item?.text || "").slice(0, 200));
      return {
        ...data,
        debug: {
          ...(data?.debug || {}),
          rawShape: {
            type: "object",
            keys: ["hot", "latest", "debug"],
            preview: "evaluate fetch on linux.do page"
          },
          consoleErrors
        }
      };
    }

    // Fallback: MCP page context不是linux.do时，退回navigate读取JSON
    const hot = await this.navigateAndReadJson(`${this.baseUrl}/hot.json`);
    const latest = await this.navigateAndReadJson(`${this.baseUrl}/latest.json`);
    const consoleMessages = await this.readConsoleMessages();
    const consoleErrors = consoleMessages
      .filter((item) => String(item?.type || "").toLowerCase() === "error")
      .slice(-5)
      .map((item) => String(item?.text || "").slice(0, 200));
    return {
      hot: hot.topics,
      latest: latest.topics,
      debug: {
        page: {
          href: String(pageState?.href || ""),
          origin: String(pageState?.origin || ""),
          title: String(pageState?.title || "")
        },
        hot: {
          status: hot.status,
          ok: hot.ok,
          contentType: hot.contentType,
          hasTopicList: hot.hasTopicList,
          topicCount: hot.topicCount,
          keys: hot.keys,
          textPreview: hot.textPreview,
          parseError: hot.parseError,
          fetchError: "",
          errorReason: hot.errorReason
        },
        latest: {
          status: latest.status,
          ok: latest.ok,
          contentType: latest.contentType,
          hasTopicList: latest.hasTopicList,
          topicCount: latest.topicCount,
          keys: latest.keys,
          textPreview: latest.textPreview,
          parseError: latest.parseError,
          fetchError: "",
          errorReason: latest.errorReason
        },
        rawShape: {
          type: "object",
          keys: ["hot", "latest", "debug"],
          preview: "fallback navigate JSON because page is not linux.do"
        },
        consoleErrors
      }
    };
  }

  async fetchTopicDetail(topicId) {
    const pageState = await this.evaluate(`
() => {
  return { origin: String(location?.origin || "") };
}
`.trim());
    if (String(pageState?.origin || "").includes("linux.do")) {
      const script = `
() => {
  const id = ${JSON.stringify(topicId)};
  const BASE = location.origin;
  return fetch(BASE + "/t/" + id + ".json", { credentials: "include", headers: { accept: "application/json, text/plain, */*" } })
    .then((resp) => {
      if (!resp.ok) throw new Error("topic detail HTTP " + resp.status);
      return resp.json();
    });
}
`.trim();
      return this.evaluate(script);
    }
    const detail = await this.navigateAndReadJson(`${this.baseUrl}/t/${encodeURIComponent(String(topicId))}.json`);
    if (!detail.ok || !detail.json) {
      throw new Error(`topic detail 拉取失败: ${detail.errorReason || detail.parseError || "unknown"}`);
    }
    return detail.json;
  }

  async closeContext() {
    if (typeof this.releaseContext !== "function") return;
    await this.releaseContext({ serverId: "playwright", contextKey: this.contextKey });
  }
}
