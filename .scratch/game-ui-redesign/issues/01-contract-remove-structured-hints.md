# T01 · 契约层移除结构化提示字段

**Status**: ready-for-agent
**Blocked by**: —

> 依据：`.scratch/game-ui-redesign/spec.md`、`docs/adr/0042-remove-structured-hints.md`。

## 目标

把「结构化提示」从共享契约、公开配置与文案表中删干净，并把 `protocolVersion` 升到 `15`。

## 范围

- `packages/shared/src/protocol/constants.ts`
  - `PROTOCOL_VERSION`（或同义常量）由 `'14'` 改为 `'15'`。
  - 删除 `hintStartRatio` 区间限制；保留 `progressiveHint*` 相关项（若有）。
- `packages/shared/src/protocol/room.ts`：房间设置删除 `structuredHintsEnabled`、`hintStartRatio`（保留 `progressiveHints`）。
- `packages/shared/src/protocol/push.ts`：`GameViewSchema` 删除 `wordHint`、`revealedHints`（保留 `answerMask` 等）。
- `packages/config/src/game.ts`：删除 `structuredHintsEnabled`、`hintStartRatio`、`hintStartRatioRange`；保留 `progressiveHints`、`progressiveHintRatio`。
- `packages/strings/src/game.ts`：删除/改写仅服务结构化提示的文案（`hintBadgeLabel`、`hintUnrevealed`；`toggleAnswerVisibilityHint` 去掉「提示」字样，改为「点击切换答案明文与遮罩」一类表述）。
- `packages/strings/src/room.ts`：删除 `ruleHintTimeDt`、`hintsStructuredOnly`；`hintsBothOn` 若不再有任何组合含义一并删除；保留 `toggleProgressiveHints`、`hintsOff`、`hintsMaskOnly` 中仍被引用的项（由 T04 最终确认调用点）。
- `packages/strings/src/settings.ts`：`drawerDefaultRevealHint` 去掉「提示类别」字样。

## 非目标

- 不改服务端逻辑（T02）、不改客户端组件（T03/T04）。
- 词库 `hint` 列与词库 Provider 校验**保留不动**。

## 验收

- 上述文件中不再出现 `structuredHint` / `hintStartRatio` / `wordHint` / `revealedHints`。
- `protocolVersion` 为 `'15'`。
- 仅做契约与文案删除，不引入新字段。

## 验证

- `pnpm exec tsc -p packages/shared/tsconfig.json --noEmit`（若因下游引用报错属预期，记录报错清单交给 T02/T03）。

## 备注

本工单完成后，仓库整体类型检查会因下游仍引用已删字段而**临时变红**，属预期；由 T02/T03/T04 收敛。
