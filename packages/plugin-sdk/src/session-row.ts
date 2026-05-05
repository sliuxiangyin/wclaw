import type { PluginSessionRow } from "./runtime-contract.js";

type BuildSessionRowInput = {
  sessionId: string;
  updatedAt?: string;
  title?: string;
  persistence?: "persist" | "ephemeral";
  forceExecuteTurn?: boolean;
};

/**
 * 统一构造 decorateSessions 的会话行。
 * 默认值：updatedAt=now、persistence="persist"、forceExecuteTurn=false。
 */
export function toSessionRow(input: BuildSessionRowInput): PluginSessionRow {
  return {
    sessionId: input.sessionId,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    title: input.title,
    persistence: input.persistence ?? "persist",
    forceExecuteTurn: input.forceExecuteTurn ?? false
  };
}
