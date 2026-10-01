# T02 · 服务端移除结构化提示

**Status**: ready-for-agent
**Blocked by**: 01

> 依据：`.scratch/game-ui-redesign/spec.md`、`docs/adr/0042-remove-structured-hints.md`。

## 目标

服务端不再有任何结构化提示的实现与下发，只保留逐字遮罩调度。

## 范围

- `apps/server/src/hint-scheduler.ts`：删除结构化提示调度分支，只保留逐字遮罩节奏（模块仍在，仍是揭示节奏唯一来源）。
- `apps/server/src/round-machine.ts`：不再写入/揭示结构化提示（`structuredHint*` 相关读写与调度入参）。
- `apps/server/src/models.ts`：`GameSecret` 删除 `structuredHint`、`structuredHintRevealed`；保留逐字计时器字段（如 `hintTimers`）。
- `apps/server/src/snapshot.ts`：不再下发 `wordHint`、`revealedHints`。
- 若 `domain/vocabulary` 的候选/答案对象为结构化提示携带了 `hint`，改为不再透出（词库仍解析该列，只是不进入对局）。
- 相关注释同步修改，不留「提示」描述。

## 非目标

- 不改词库 Provider 的解析与校验（`hint` 列保留）。
- 不改协议/配置（T01）。

## 验收

- 服务端源码中不再出现 `structuredHint`、`wordHint`、`revealedHints`、`hintStartRatio`。
- 逐字遮罩（`progressiveHints` / `progressiveHintRatio`）行为不变。

## 验证

- `pnpm exec eslint apps/server/src`
- `pnpm --filter @draw-guess/server typecheck`（若仅因 T01 契约变更已生效而报客户端外的引用错误，记录并交 T03）
- `pnpm test:unit`（快照矩阵等提示相关用例的失败属预期，收录清单交 T05）
