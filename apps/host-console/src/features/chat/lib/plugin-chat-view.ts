import type { PluginListItem } from "@/lib/api/plugins.api";

export type PluginChatEventItem = {
  id: number;
  type: string;
  source: "host" | "llm" | "plugin" | "tool";
  createdAt: string;
};

export function statusLabel(status: "valid" | "invalid") {
  return status === "valid" ? "有效（valid）" : "无效（invalid）";
}

export function resolvePluginMode(plugin: PluginListItem): string {
  const manifest = plugin.manifest;
  if (!manifest) return "-";
  if (manifest.kind === "runtime_plugin") return "runtime_chat";
  return manifest.commandMode ?? "ephemeral_no_context";
}
