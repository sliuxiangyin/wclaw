/** Prompt2Plugin Studio：协议常量（单一真相源，避免 runtime / plugin-turn 各写一套） */

/** 草稿流水线状态（.p2p-meta.json status） */
export const P2P_STATUS = {
  initialized: "initialized",
  spec_ready: "spec_ready",
  generated: "generated",
  validated: "validated",
  tested: "tested",
  /** 草稿已成功晋升至 `plugins/<plugin-id>/` */
  promoted: "promoted",
  rejected: "rejected"
} as const;

/** 生成目标草稿在 plugin.json 中的 kind */
export const P2P_TARGET_KIND = "command_plugin";

export const P2P_NEXT = {
  initHint:
    "/p2p.init <plugin-id> [--commandMode ephemeral_with_context|ephemeral_no_context|isolated_chat]",
  /** 与聊天里展示的转义一致 */
  spec: `/p2p.spec <plugin-id> <需求描述>`,
  generate: "/p2p.generate <plugin-id> [--templateVersion v1]",
  validate: "/p2p.validate <plugin-id> [--profile quick|full]",
  test: "/p2p.test <plugin-id> [--suite smoke|full]",
  promote: "/p2p.promote <plugin-id> [--expectedRevision <n>]",
  rollback: "/p2p.rollback <plugin-id> <revision>",
  status: "/p2p.status <plugin-id>"
} as const;

const COMMAND_MODES = new Set([
  "ephemeral_with_context",
  "ephemeral_no_context",
  "isolated_chat"
]);

export function isAllowedCommandMode(mode: string): boolean {
  return COMMAND_MODES.has(mode);
}
