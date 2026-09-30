# 0023 · 成员事实单一口径

**状态**：已采纳

## 背景

房间内「谁还在席、谁可玩、谁在线、谁能进下一局、谁进最终榜单」这类成员状态判定，长期散落在
`scoring.ts`、`round-machine.ts`、`room-membership-service.ts`、`game-service.ts`、`snapshot.ts`
等 12+ 处，各自以 `room.members.filter(...)` 内联实现：

- `!leftGame`（占席）出现在容量、缩容下限与大厅人数；
- `!spectating && !leftGame`（可玩）出现在计分、开局门槛与房主兜底；
- 再加 `players.get(id)?.connected`（在线可玩）出现在房主迁移、选画家与自动暂停计数；
- `!leftGame && (!spectating || waitingForNextGame)`（候场可玩）出现在再来一局；
- `!spectating`（进榜）出现在最终榜单。

这些语义**并不相同**，却长得几乎一样，改一处忘一处就会静默改变人数与容量口径。已经出现的漂移证据：
`scoring.activePlayerCount` 的注释声称「计分与满员判定统一使用它」，但满员判定实际从未调用它
（改为内联 `game-service.ts`）。

同时，「当前阶段的标称总时长」映射（`drawing → roundDurationMs`、`choosing_word → chooseSeconds*1000`）
在 `game-service.resume` 与 `snapshot` 暂停态 `phaseEndsAt` 两处各写一遍。

## 决策

新建纯模块 `apps/server/src/domain/room/member-facts.ts`，作为成员状态与阶段标称时长的唯一具名口径：

- 谓词：`occupiesSeat` / `isActivePlayer` / `isOnlinePlayer` / `isRematchEligible` / `isRankedMember`；
- 由谓词派生的选择器与计数：`activePlayers` / `onlinePlayers` / `rematchEligibleMembers` /
  `rankedMembers` / `activeGuessers` / `onlineGuessers` / `countActivePlayers` / `countOnlinePlayers`；
- 连接三态：`connectionStatus`；阶段标称时长：`nominalPhaseDurationMs`。

三条边界写死：

1. **只读**：模块绝不修改成员，全部判定可脱离房间与 Socket 独立单测；连通性经显式
   `isOnline: (playerId) => boolean` 入参注入，保持纯函数。
2. **进榜保留离局者**：`isRankedMember` 仅排除观战者。离局成员以 `leftProfile` 冻结展示成绩卡，
   其成绩属于本局历史，不随离席消失（此前无测试固定，已补 `test/unit/final-ranking.spec.ts`）。
3. **单字段与写路径不收敛**：`member.ready` / `member.guessedAt` 等单字段读取、两处
   `room.members` 数组重赋值（`round-machine.setWaiting`、`membership.leaveGame`）与
   `session-service` 的「查找即清理游标」保持原样——它们不是复合谓词。容量「房间多满」的三套
   `room.members.length` 原始口径也**有意保留**并加注释，不并入本模块。

删除 `scoring.activePlayerCount` 与 `room-membership-service.onlineMemberCount` 两个重复 helper，
并修正前者过时的注释。

防回潮由窄范围源码扫描守住：`test/unit/member-facts-boundaries.spec.ts` 禁止
`member-facts.ts` 之外重新内联「观战 × 离局」复合谓词。

## 后果

- 每种成员语义只有一个定义处，改口径只需改一处并补一条单测；漂移不再可能静默发生。
- 计分、房主迁移、选画家、自动暂停、最终榜单与快照共用同一批具名谓词，测试面对的是语义名而非
  内联表达式。
- 代价：多了一层具名间接；调用点必须理解「占席 / 可玩 / 在线可玩」的差别，单纯把它当成
  「是不是玩家」的布尔会引入错误。这一差别由谓词命名与单测显式固定。
- 边界测试是正则源码扫描（仓库惯用手法），对合法重构敏感；其窄窗口只覆盖
  `spectating × leftGame` 组合，避免误伤相邻的单字段守卫。

## 关联

- 代码：`apps/server/src/domain/room/member-facts.ts`、`scoring.ts`、`round-machine.ts`、
  `domain/room/room-membership-service.ts`、`game-service.ts`、`snapshot.ts`
- 测试：`test/unit/member-facts.spec.ts`、`test/unit/member-facts-boundaries.spec.ts`、
  `test/unit/final-ranking.spec.ts`
- 来源：2026-09-26 架构评审候选 2（领域事实单一口径）
