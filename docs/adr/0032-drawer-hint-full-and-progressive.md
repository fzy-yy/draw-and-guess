# 0032 · 画家模式完整提示、猜词者逐渐披露（wordCategory → wordHint）

## 状态

已采纳

## 背景

词库重建后，结构化提示的来源是词条 `hint`（为空回退 `category`），由服务端按揭示节奏
组装进 `revealedHints[0]`。但 HUD 的提示行对**画家**另走一条路：取只有画家能收到的
`wordCategory`（真实分类），于是：

- 画家在「显示答案」模式显示**分类**；
- 画家切到「猜词者模式」、或猜词者本人显示 `revealedHints[0]`（**hint 优先**）。

当词条有 hint 时，画家两种模式显示的内容不同（分类 vs hint），切换视角会让提示突变。
根因是把「**完整提示**」与「**逐渐披露的提示**」误当成两个不同**来源**：
它们应当是同一来源（hint 优先、空回退 category）在不同**完整度**下的呈现。

## 决策

区分「完整提示」与「逐渐披露的提示」，但二者**同源**（`hint || category`）：

- 服务端对画家下发**完整提示** `wordHint = hint || category`（取代只给画家的 `wordCategory`）；
- HUD：画家在「画家模式」完整显示 `wordHint` **与答案**；画家切到「猜词者模式」或猜词者本人，
  只显示按时间逐渐披露的 `revealedHints[0]`（未揭示时显示占位符）。

因此不会再出现「一侧分类、一侧 hint」的不一致：画家模式是**完整 hint**，
猜词者模式是**同一条 hint 的逐步揭示**。

## 后果

- 画家切到画家模式即可完整看到「提示 + 答案」；猜词者仍按 `hintStartRatio` 逐渐披露。
- 客户端与服务端不再有「分类」这一独立提示来源：`wordCategory` 从 `GameViewSchema` 与
  `snapshot.ts` 移除，新增 `wordHint`（同为画家专属）。
- `GameViewSchema` 是 **strict** 的，字段增删属线协议变更，故 `protocolVersion` 由 `13` 升到 `14`；
  客户端与服务端必须同步构建部署（版本握手会拦下过期客户端）。
- 回归由组件测试守护：`GameHudPhaseOverlay.spec.ts` / `GameInteractionSurfaces.spec.ts` 断言
  画家模式显示完整提示、猜词者模式与猜词者本人只显示已披露提示；快照矩阵断言 `wordHint` 仅画家可见。

## 关联

- 代码：`apps/client/src/components/game/GameHud.vue`、`apps/server/src/snapshot.ts`、
  `packages/shared/src/protocol/push.ts`、`packages/shared/src/protocol/constants.ts`
- 测试：`test/component/GameHudPhaseOverlay.spec.ts`、`test/component/GameInteractionSurfaces.spec.ts`、
  `test/unit/snapshot.matrix.spec.ts`
- 相关：ADR-0013（词库难度级配置与提示）、ADR-0021（快照矩阵）
