# Scheduler 调度器需求与设计方案（v1）

更新时间：2026-05-02

本文用于先行落地 Scheduler（调度）能力的需求与设计，作为后续插件实现的宿主侧基线。

---

## 1. 背景与目标

### 1.1 背景

当前 runtime_plugin 插件存在“轮询逻辑分散、可能裸 `while(true)`、治理策略不统一”的风险。  
这会导致并发不可控、失败抖动放大、内存与 GC 压力增大，并影响后续插件快速接入。

### 1.2 目标

Scheduler 目标是提供“统一、可控、可观测”的任务执行底座：

1. 统一承载插件轮询与定时任务（替代插件内部无限循环）。
2. 提供并发、超时、重试、退避、熔断等治理能力。
3. 与现有 Chat / Session / 插件生命周期解耦对接。
4. 为后续插件实现提供一致接入协议，不依赖插件特判。

### 1.3 非目标（本阶段不做）

- 不在本阶段引入分布式调度（单实例内存实现优先）。
- 不在本阶段实现复杂 DAG 工作流编排引擎。
- 不在本阶段引入 Redis 等外部队列中间件（先内存，后按压力演进）。

---

## 2. 范围定义

### 2.1 In Scope

- runtime_plugin 的轮询/定时任务调度。
- 任务执行治理：`concurrency / timeout / maxRetry / backoff / jitter`。
- 插件级熔断与降级（`safe_mode`）。
- 租约能力最小闭环（grant/revoke）用于防止重复调度。
- 调度事件与执行结果的结构化记录（基础可观测）。

### 2.2 Out of Scope

- command_plugin 的复杂批处理编排。
- 跨宿主实例的全局租约一致性。
- 完整告警平台对接（仅保留可扩展事件接口）。

---

## 3. 术语与边界

- `Scheduler`：负责“什么时候执行、执行多少、失败如何处理”。
- `Orchestration`：负责“执行路径与流程决策”。
- `TaskDefinition`：任务定义（静态配置）。
- `TaskInstance`：任务一次执行实例（运行态）。
- `Lease`：调度租约，防止同一任务被重复接管。
- `safe_mode`：插件熔断后的降级模式，仅保留最小能力。

边界约束：

1. 调度权归宿主，插件只声明任务意图与参数，不自建无限轮询。
2. 宿主禁止插件 ID 特判，统一走协议字段驱动。
3. Scheduler 不直接承载业务逻辑，仅做执行控制与治理。

---

## 4. 需求清单

## 4.1 功能性需求（FR）

- FR-1：支持注册/启停任务（按插件生命周期联动）。
- FR-2：支持固定间隔调度（`intervalMs`）与随机抖动（`jitterMs`）。
- FR-3：支持任务并发上限（全局 + 插件级 + 任务级）。
- FR-4：支持任务超时中断与状态回收。
- FR-5：支持失败重试（指数退避/线性退避）。
- FR-6：支持插件级熔断（失败阈值）与自动恢复窗口。
- FR-7：支持最小租约接口：
  - `POST /api/orchestration/lease/grant`
  - `POST /api/orchestration/lease/revoke`
- FR-8：支持结构化执行事件记录（start/success/fail/timeout/retry/open-circuit）。

## 4.2 非功能性需求（NFR）

- NFR-1：调度器主循环不可阻塞请求线程。
- NFR-2：任务泄漏可控（停止插件后不得继续执行旧任务）。
- NFR-3：单任务异常不影响其他插件任务。
- NFR-4：在高失败率下避免雪崩（退避 + 熔断必须生效）。
- NFR-5：基础可观测字段必须齐全：`traceId/pluginId/taskId/sessionId?`。

---

## 5. 设计方案

## 5.1 分层设计

建议在 `apps/host-api/src/services` 内按以下职责拆分：

- `scheduler-registry.service.ts`
  - 维护 `TaskDefinition` 注册、更新、注销。
- `scheduler-runner.service.ts`
  - 负责任务触发、并发控制、超时控制、重试调度。
- `scheduler-circuit-breaker.service.ts`
  - 维护插件级熔断状态机（closed/open/half-open）。
- `orchestration-lease.service.ts`
  - 提供租约签发与撤销（先内存版，可替换存储）。
- `scheduler-observer.service.ts`
  - 统一事件记录与指标聚合（先日志事件，再扩展 metrics）。

说明：repositories 层仅负责持久化与查询，services 负责规则与调度控制。

## 5.2 数据模型（建议）

```ts
type BackoffPolicy = {
  type: "fixed" | "linear" | "exponential";
  baseMs: number;
  maxMs: number;
};

type TaskDefinition = {
  pluginId: string;
  taskId: string;
  intervalMs: number;
  jitterMs?: number;
  timeoutMs: number;
  maxRetry: number;
  backoff: BackoffPolicy;
  enabled: boolean;
};

type TaskRuntimeState = {
  running: number;
  queued: number;
  lastStartAt?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  consecutiveFailures: number;
  circuitState: "closed" | "open" | "half-open";
};
```

## 5.3 执行流程（单任务）

1. Runner 从 Registry 取到“到期可执行”任务。
2. 先检查插件熔断状态与租约。
3. 命中并发上限则排队或丢弃（按策略）。
4. 执行任务并启动超时计时器。
5. 成功：清空连续失败计数，记录 success 事件。
6. 失败：写入 fail 事件，按重试策略计算下一次执行时间。
7. 连续失败超阈值：打开熔断，插件进入 `safe_mode`。

## 5.4 租约接口（最小契约）

### `POST /api/orchestration/lease/grant`

请求字段建议：

- `pluginId`
- `taskId`
- `ownerId`（宿主实例标识）
- `ttlMs`

响应字段建议：

- `granted: boolean`
- `leaseId`
- `expireAt`

### `POST /api/orchestration/lease/revoke`

请求字段建议：

- `leaseId`
- `ownerId`

响应字段建议：

- `revoked: boolean`

备注：接口响应沿用统一包装 `ok/data/error/traceId`。

---

## 6. 配置基线（v1 建议默认值）

- 全局并发：`20`
- 单插件并发：`5`
- 单任务超时：`15_000ms`
- 默认重试：`maxRetry=3`
- 默认退避：`exponential(base=500ms, max=10_000ms)`
- 熔断阈值：连续失败 `5` 次
- 半开探测窗口：`30_000ms`

说明：以上为起步值，应按真实运行压测数据调优。

---

## 7. 实施计划（按优先级）

### Phase 1：最小可用调度器

1. 建立 `registry + runner` 主链路。
2. 接管 runtime_plugin 的轮询任务。
3. 完成 `timeout + maxRetry + backoff`。

### Phase 2：治理与稳定性

1. 接入插件级熔断与 `safe_mode`。
2. 完成租约接口 `grant/revoke`（内存版）。
3. 统一事件记录，补充 trace 字段。

### Phase 3：可观测与演进

1. 建立调度健康查询接口（可选）。
2. 补充调度相关单测/集成测试。
3. 评估是否演进到外部队列或分布式租约。

---

## 8. 验收标准（DoD）

- [ ] 插件无裸 `while(true)` 轮询。
- [ ] Scheduler 统一接管至少一个 runtime_plugin 任务流。
- [ ] 并发、超时、重试、退避策略生效且可验证。
- [ ] 熔断可触发、可恢复，`safe_mode` 可观测。
- [ ] `lease/grant`、`lease/revoke` 可调用并可回收。
- [ ] 至少具备 service 层单测与 route 层最小集成测试。

---

## 9. 风险与应对

- 风险：调度与业务耦合过深，后续难扩展。  
  应对：严格保持 scheduler 只做执行治理，业务放插件或 orchestration。

- 风险：重试配置不当导致请求风暴。  
  应对：强制上限 + 指数退避 + 熔断。

- 风险：任务停止后资源未释放。  
  应对：插件卸载触发统一 `task deregister + timer cleanup`。

---

## 10. 与现有文档关系

- 功能现状：`docs/进度/功能清单_status.md`
- 执行清单：`docs/进度/任务TODO.md`
- 宿主总览：`docs/项目功能/宿主/宿主功能.md`
- 架构蓝图：`docs/项目蓝图.md`

本文件作为 Scheduler 专项的需求与设计依据，后续代码实现与接口变更应优先回填本文件。
