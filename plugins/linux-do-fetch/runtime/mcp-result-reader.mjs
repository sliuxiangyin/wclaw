export default class McpResultReader {
  static stringify(value) {
    try {
      return typeof value === "string" ? value : JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  static tryParseJson(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "object") return value;
    if (typeof value === "string") {
      const t = value.trim();
      if (!t) return null;
      try {
        return JSON.parse(t);
      } catch {
        return null;
      }
    }
    return null;
  }

  static parseMcpResult(result) {
    const payload = result && typeof result === "object" ? result : {};
    const hasContentArray = Array.isArray(payload?.content);
    if (!hasContentArray) {
      const direct = McpResultReader.tryParseJson(result);
      if (direct) return direct;
    }
    const content = Array.isArray(payload?.content) ? payload.content : [];
    for (const item of content) {
      const parsedText = McpResultReader.tryParseJson(item?.text);
      if (parsedText) return parsedText;
      const parsedJson = McpResultReader.tryParseJson(item?.json);
      if (parsedJson) return parsedJson;
    }
    const direct = McpResultReader.tryParseJson(result);
    if (direct && typeof direct === "object") {
      if ("result" in direct) {
        const nested = McpResultReader.tryParseJson(direct.result);
        if (nested) return nested;
      }
      return direct;
    }
    return null;
  }
}
