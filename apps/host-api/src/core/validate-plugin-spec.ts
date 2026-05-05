type ValidationResult = {
  valid: boolean;
  errors: string[];
};

export function validatePluginSpec(spec: unknown): ValidationResult {
  const schemaErrors = validateSchemaShape(spec);
  if (schemaErrors.length > 0) {
    return { valid: false, errors: schemaErrors };
  }

  const guideErrors = validateGuide(spec as Record<string, unknown>);
  const semanticErrors = validateSemantics(spec as Record<string, unknown>);
  const merged = [...guideErrors, ...semanticErrors];
  return {
    valid: merged.length === 0,
    errors: merged
  };
}

function validateGuide(spec: Record<string, unknown>): string[] {
  const g = spec.guide;
  if (g === undefined) return [];
  const errors: string[] = [];
  if (typeof g !== "object" || g === null || Array.isArray(g)) {
    return ["guide 必须是 object"];
  }
  const o = g as Record<string, unknown>;
  if (o.welcome !== undefined && typeof o.welcome !== "string") errors.push("guide.welcome 必须是 string");
  if (o.suggestions !== undefined) {
    errors.push(...validateGuideSuggestions(o.suggestions, "guide.suggestions"));
  }
  if (o.multiSession !== undefined) {
    const ms = o.multiSession;
    if (typeof ms !== "object" || ms === null || Array.isArray(ms)) {
      errors.push("guide.multiSession 必须是 object");
    } else {
      const m = ms as Record<string, unknown>;
      if (m.defaultSessionWelcome !== undefined && typeof m.defaultSessionWelcome !== "string") {
        errors.push("guide.multiSession.defaultSessionWelcome 必须是 string");
      }
      if (m.sessionWelcome !== undefined && typeof m.sessionWelcome !== "string") {
        errors.push("guide.multiSession.sessionWelcome 必须是 string");
      }
      if (m.defaultSessionSuggestions !== undefined) {
        errors.push(...validateGuideSuggestions(m.defaultSessionSuggestions, "guide.multiSession.defaultSessionSuggestions"));
      }
      if (m.sessionSuggestions !== undefined) {
        errors.push(...validateGuideSuggestions(m.sessionSuggestions, "guide.multiSession.sessionSuggestions"));
      }
    }
  }
  return errors;
}

function validateGuideSuggestions(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return [`${path} 必须是数组`];
  const errors: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${path}[${i}] 必须是 object`);
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.prompt !== "string" || row.prompt.trim() === "") {
      errors.push(`${path}[${i}].prompt 必须是非空 string`);
    }
    if (row.text !== undefined && typeof row.text !== "string") {
      errors.push(`${path}[${i}].text 必须是 string`);
    }
  }
  return errors;
}

function validateSchemaShape(spec: unknown): string[] {
  const errors: string[] = [];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return ["spec 必须是 object"];
  }

  const obj = spec as Record<string, unknown>;
  const requiredTop = [
    "id",
    "displayName",
    "version",
    "apiVersion",
    "kind",
    "entry",
    "description",
    "triggerDescription",
    "examples",
    "permissions",
    "capabilities"
  ];

  for (const key of requiredTop) {
    if (obj[key] === undefined) {
      errors.push(`缺少必填字段: ${key}`);
    }
  }

  if (obj.apiVersion !== "v3") errors.push("apiVersion 必须为 v3");
  if (!["runtime_plugin", "command_plugin"].includes(String(obj.kind ?? ""))) {
    errors.push("kind 必须是 runtime_plugin 或 command_plugin");
  }
  if (!Array.isArray(obj.examples) || obj.examples.length === 0) {
    errors.push("examples 必须是非空数组");
  }
  if (!Array.isArray(obj.permissions)) {
    errors.push("permissions 必须是数组");
  }
  if (!obj.capabilities || typeof obj.capabilities !== "object" || Array.isArray(obj.capabilities)) {
    errors.push("capabilities 必须是 object");
  }

  return errors;
}

function validateSemantics(spec: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const capabilities = spec.capabilities as Record<string, unknown> | undefined;
  const mcp = spec.mcp as Record<string, unknown> | undefined;
  const sessionProvider = spec.sessionProvider as Record<string, unknown> | undefined;
  const kind = spec.kind;
  const entry = String(spec.entry ?? "");

  if (entry.includes("..")) {
    errors.push("entry 不能包含 '..' 路径跳转");
  }

  if (capabilities) {
    if (capabilities.llm === false && capabilities.commandContextWrite !== "none") {
      errors.push("capabilities.llm=false 时，commandContextWrite 必须为 none");
    }
    if (kind === "command_plugin" && capabilities.command !== true) {
      errors.push("kind=command_plugin 时，capabilities.command 必须为 true");
    }
    if (capabilities.orchestration === "runtime_lease" && kind !== "runtime_plugin") {
      errors.push("orchestration=runtime_lease 仅允许 runtime_plugin");
    }
    if (capabilities.chat === true && !sessionProvider) {
      errors.push("capabilities.chat=true 时，sessionProvider 必填");
    }
  }

  const allowedServers = (mcp?.allowedServers as string[] | undefined) ?? [];
  const allowedTools = (mcp?.allowedTools as string[] | undefined) ?? [];
  if (allowedServers.length > 0 && allowedTools.length > 0) {
    errors.push("mcp.allowedServers 与 mcp.allowedTools 不能同时配置（allowedTools 为兼容字段）");
  }

  const aliasPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
  for (const alias of allowedServers) {
    if (typeof alias !== "string" || !aliasPattern.test(alias)) {
      errors.push(`mcp.allowedServers 非法别名: ${String(alias)}`);
    }
  }

  if ((mcp?.allowedServers || mcp?.allowedTools) && mcp?.deniedTools) {
    const allow = new Set([...(allowedServers ?? []), ...(allowedTools ?? [])]);
    const deny = new Set((mcp.deniedTools as string[]) ?? []);
    for (const key of allow) {
      if (deny.has(key)) {
        errors.push(`mcp.allowedServers/allowedTools 与 deniedTools 冲突: ${key}`);
      }
    }
  }

  return errors;
}
