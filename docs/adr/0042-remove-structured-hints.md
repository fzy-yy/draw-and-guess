# 0042 · 移除结构化提示

**状态**：已采纳

- 来源：2026-10-01 对局界面重设计（见 [ADR-0043](0043-game-view-floating-layout.md)）附带的内容决策。
- 取代：[ADR-0032](0032-drawer-hint-full-and-progressive.md)（画家模式完整提示、猜词者逐渐披露）。

## 背景

结构化提示自 [ADR-0013](0013-vocabulary-level-config-and-hints.md) 引入：词条带 `hint` 文案（空回退 `category`），
对局在剩余比例降到 `hintStartRatio` 时向猜词者披露一次；[ADR-0032](0032-drawer-hint-full-and-progressive.md)
又把画家侧的 `wordCategory` 统一成 `wordHint`，让画家与猜词者看到同源、不同完整度的提示。

这套机制带来三个问题：

- **降低难度且泄露词库元数据**：`hint` 是词库作者为词条写的辅助说明（如「草原上的高个子」），
  它把「答案是什么」这一层的线索直接交给猜词者，与题目遮罩（逐字揭示）表达的是同一类信息，
  等于用两条通道重复给提示。
- **顶栏被迫增行**：提示需要独立一行（徽章 + 文本）才能与题目区分，顶栏因此变高、横向也被占，
  而顶栏高度是从画布面积里扣的。
- **规则面与实现面耦合**：为了这条提示，房间规则里多出「结构化提示」「提示出现时机」两个开关、
  协议里多出 `structuredHintsEnabled` / `hintStartRatio` / `wordHint` / `revealedHints` 四处字段，
  服务端多出一个秘密字段与一条调度分支。

## 决策

从**对局链路**彻底移除结构化提示，只保留逐字遮罩：

1. **协议收缩（不兼容变更，`protocolVersion` 14 → 15）**：房间设置删除 `structuredHintsEnabled`、
   `hintStartRatio`；推送删除 `wordHint`、`revealedHints`；共享常量删除 `hintStartRatio` 区间。
2. **服务端**：揭示调度只保留逐字遮罩分支；`GameSecret` 删除结构化提示秘密与「已揭示」标志；
   快照不再下发画家专属提示与已揭示提示。
3. **客户端**：顶栏删除提示区与「当前画家」（后者与玩家面板重复）；房间规则弹窗与摘要删除提示两项
   （保留「逐步提示字符」）；词库弹窗删除「提示」列。
4. **词库数据保持不变**：Provider 仍解析并校验 `hint` 列（≤10 字、空串合法），
   它从此只是词库元数据，不再进入对局。删除该列会牵动数据库迁移与词库再生，与本轮收益不成比例，
   留待词库侧独立评估。

## 后果

- 猜词者只靠画作与逐字遮罩推理；画家不再需要「完整提示」这一概念，答案显隐切换只剩「明文 / 遮罩」。
- 规则面少两个开关，协议少四处字段，服务端少一个秘密字段与一条调度分支；顶栏因此可以降高。
- 废弃与收窄：ADR-0032 废弃；ADR-0013 中「提示揭示」的语义仅剩「词库 `hint` 字段 + 逐字遮罩节奏」，
  其对局提示部分由本 ADR 取代。
- 代价：本轮为不兼容协议变更，前后端必须同批部署（版本握手会拦下过期客户端）；
  词库表里仍存在一个对局不再使用的 `hint` 列，属**已知冗余**。

## 关联

- 代码：`apps/server/src/hint-scheduler.ts`、`round-machine.ts`、`models.ts`、`snapshot.ts`、
  `packages/shared/src/protocol/{room,push,constants}.ts`、`packages/config/src/game.ts`、
  `apps/client/src/components/game/GameHud.vue`、`components/room/{RulesDialog,RuleSummary,VocabularyDialog}.vue`
- 测试：`test/unit/snapshot.matrix.spec.ts`、提示调度单测、`test/component/GameHudPhaseOverlay.spec.ts`
- 取代：[ADR-0032](0032-drawer-hint-full-and-progressive.md)；收窄 [ADR-0013](0013-vocabulary-level-config-and-hints.md)
- 相关：[ADR-0043](0043-game-view-floating-layout.md)（同批的布局决策）
