# 0029 · 客户端浅层包装保持现状（不折叠）

## 状态

已采纳

## 背景

2026-09-26 架构评审候选 7 指出客户端存在一批「浅层包装碎片」并建议折叠：

- 图标按钮四层栈：`BaseIconButton` ← `IconButton` / `RoundIconButton` / `ToolButton`；
- 单插槽包装：`HudPill`、`OverlayCard`、`RuleRow`、`StageHeader`、`SectionHeader`。

该候选在评审报告中即被标为 **Speculative**（「收益小、改动面广，建议放最后」）。本次逐项做
**删除测试**后确认：这些包装不是应被折叠的碎片，而是「删除会把复杂度搬回调用点」的有效抽取。

## 决策

**保持现状，不做折叠。** 依据：

1. **删除测试全部指向「搬移」而非「集中」**。每个包装的既有注释都写明它收敛了调用点的重复长串，
   且实际模板出现次数支持这一判断：`ToolButton` 6、`SectionHeader` 6、`HudPill` 4、
   `OverlayCard` 4、`IconButton` 4、`RoundIconButton` 3、`StageHeader` 3、`RuleRow` 1
   （在 `v-for` 内逐项复用）。删除任一个，长串 Tailwind 底座类都会重新散回调用点。
2. **图标三变体各有独立且自解释的接口**：`IconButton`（方块 + `size` 档）、
   `RoundIconButton`（圆形 `.round-icon-btn` + `focus` 转发）、`ToolButton`
   （工具栏 `active` + `shortcut` + `ariaLabel`）。合并为一个 `variant` 枚举会以「少三个文件」
   换掉三个自解释组件名，反而拓宽 interface、降低模板可读性。
3. **`focus` 暴露的不对称是有意的**：只有圆形变体被 `ActionPopover` 用作触发钮，需要在 Esc
   关闭后恢复键盘焦点；方块与工具栏变体的调用点（GameHud / RoomView）无此需求。
4. `BaseIconButton` 继续作为唯一基座，承担结构、音效、attrs 合并与 `focus` 暴露；
   三个变体只提供各自的底座类与差异样式（`OverlayCard` / `RuleRow` 分别只服务于
   `PhaseOverlay` / `RuleSummary`，但都在同一模板内重复 4 次以上）。

## 后果

- 接受「文件数偏多」的成本，换取调用点零重复与自解释的组件名；不为此类包装的「浅」再开展折叠重构。
- 维护规则：若某个变体被删到没有任何调用点，应**随其最后一个调用点一并删除**，而不是为「减少文件数」
  主动把多个变体折叠成一个带枚举的组件。反之，新增视觉变体优先新增一个小变体组件或复用现有变体，
  不要在调用点内联长串底座类。
- 本 ADR 的目的即「让未来的架构评审不再重复建议折叠」：再次提出时请先跑删除测试并对照本记录。

## 关联

- 代码：`apps/client/src/components/common/BaseIconButton.vue`、`IconButton.vue`、
  `RoundIconButton.vue`、`ToolButton.vue`、`StageHeader.vue`、`SectionHeader.vue`、
  `components/game/HudPill.vue`、`components/game/OverlayCard.vue`、`components/room/RuleRow.vue`
- 来源：2026-09-26 架构评审候选 7（浅层包装碎片，报告评为 Speculative）
- 相关：ADR-0016（类型护栏分层）、ADR-0028（客户端房间事实单一口径）
