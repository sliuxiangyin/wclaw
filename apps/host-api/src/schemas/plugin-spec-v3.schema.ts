export const pluginSpecV3Schema = {
  $id: "plugin-spec-v3",
  type: "object",
  additionalProperties: false,
  required: [
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
  ],
  properties: {
    id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,62}$" },
    displayName: { type: "string", minLength: 1, maxLength: 64 },
    version: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
    apiVersion: { const: "v3" },
    kind: { enum: ["runtime_plugin", "command_plugin"] },
    entry: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1, maxLength: 500 },
    triggerDescription: { type: "string", minLength: 1, maxLength: 200 },
    examples: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["input"],
        properties: {
          input: { type: "string", minLength: 1, maxLength: 200 },
          note: { type: "string", maxLength: 200 }
        }
      }
    },
    permissions: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true
    },
    capabilities: {
      type: "object",
      additionalProperties: false,
      required: [
        "chat",
        "llm",
        "command",
        "commandContextWrite",
        "isolatedContext",
        "mcpAccess",
        "crossPluginInvoke",
        "orchestration"
      ],
      properties: {
        chat: { type: "boolean" },
        llm: { type: "boolean" },
        command: { type: "boolean" },
        commandContextWrite: { enum: ["none", "result_only", "full"] },
        isolatedContext: { type: "boolean" },
        mcpAccess: { enum: ["none", "declared", "policy_granted"] },
        crossPluginInvoke: { enum: ["none", "declared", "policy_granted"] },
        orchestration: { enum: ["none", "runtime_lease"] }
      }
    },
    isolation: {
      type: "object",
      additionalProperties: false,
      required: ["exitCommands"],
      properties: {
        exitCommands: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: { type: "string", minLength: 1, maxLength: 32 },
          uniqueItems: true
        }
      }
    },
    mcp: {
      type: "object",
      additionalProperties: false,
      properties: {
        allowedServers: {
          type: "array",
          items: { type: "string", minLength: 1 },
          uniqueItems: true
        },
        /** 兼容旧字段：后续迁移删除 */
        allowedTools: {
          type: "array",
          items: { type: "string", minLength: 1 },
          uniqueItems: true
        },
        deniedTools: {
          type: "array",
          items: { type: "string", minLength: 1 },
          uniqueItems: true
        }
      }
    },
    sessionProvider: {
      type: "object",
      additionalProperties: false,
      required: ["mode"],
      properties: {
        mode: { enum: ["single", "multi"] },
        listEndpoint: { type: "string", minLength: 1, maxLength: 200 },
        switchEndpoint: { type: "string", minLength: 1, maxLength: 200 },
        sessionMetaSchema: { type: "object" }
      }
    },
    configSchema: { type: "object" },
    defaultConfig: { type: "object" }
  }
} as const;
