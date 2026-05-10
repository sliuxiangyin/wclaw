/** `.p2p-meta.json` 草稿元数据（与宿主清单字段解耦，仅 Studio 流水线使用） */
export type P2pMeta = {
  pluginId?: string;
  kind?: string;
  /** 目标草稿 `plugin.json` 拟使用的 commandMode（与 Studio 宿主清单无关） */
  commandMode?: string;
  status?: string;
  revision?: number;
  spec?: { rawPrompt?: string; capabilities?: Record<string, unknown>; notes?: unknown[] };
  lastValidation?: unknown;
  lastTest?: unknown;
  /** 最近一次成功 promote 的审计摘要（MVP） */
  lastPromote?: { at?: string; traceId?: string; snapshotRevision?: number };
  updatedAt?: string;
};
