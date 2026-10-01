# T04 · 房间规则 UI 与词库弹窗去提示

**Status**: ready-for-agent
**Blocked by**: 01

> 依据：`.scratch/game-ui-redesign/spec.md`、`docs/adr/0042-remove-structured-hints.md`。

## 目标

房间规则弹窗/摘要删除结构化提示两项，词库弹窗删除「提示」列，并清理其文案引用。

## 范围

- `components/room/RulesDialog.vue`：删除「结构化提示」开关与「提示出现时机」滑块；保留「逐步提示字符」。
- `components/room/RuleSummary.vue`：提示摘要只保留「逐步提示」的开关状态表述。
- `components/room/VocabularyDialog.vue` + `components/room/VocabTableView.vue`：删除「提示」列（列定义与单元格渲染）。
- 清理上述文件对 T01 已删文案的引用。

## 非目标

- 不改词库数据库列与 Provider 校验。
- 不改大厅/设置页。

## 验收

- 规则区不再出现「结构化提示」「提示出现时机」。
- 词库弹窗不再有「提示」列。
- 无对已删文案键的残留引用。

## 验证

- `pnpm exec eslint apps/client/src`
- `pnpm --filter @draw-guess/client typecheck`
