# 0001 逐步提示间隔用毫秒计算、不再按秒向下取整

- 状态：已采纳
- 来源：`bug-审查报告.md` #3

## 背景

逐步提示原实现按「秒」算间隔：`intervalSec = Math.floor(windowSec / hintCount)`。
当提示数大于窗口秒数（字长 > 作画秒数，长成语/短语常见）时 `intervalSec` 取整为 `0`，
于是每个提示的目标剩余时间都是 0、延迟都等于「当前剩余」——**全部提示被排到同一时刻（回合结束）**。
回合结束计时器先触发 `finishRound`，`revealHint` 在 `phase !== 'drawing'` 处提前返回，
结果是一个提示都不揭示：长答案反而完全没有提示。

## 决策

- 间隔一律**用毫秒计算**（`windowMs / hintCount`），不再经过秒级 `Math.floor`；
- 与 #9 的清理合并：提示数按「可揭示的非标点字符数 - 1」封顶（`revealHint` 会保留最后一个非标点字符，
  避免泄露答案），含大量标点的答案不再调度出空转计时器；
- 提示调度收敛为 `createHintSchedule` 单一事实来源，删除重复的数学与不可达分支。

## 后果

- 长答案在任意作画时长下都能按比例获得提示，不再坍缩到回合末；
- 调度数量与实际可揭示数量一致，不再产生「计划了却永远不会触发」的计时器；
- 代价：毫秒级间隔在高提示数时相邻提示可能非常密集（视觉上几乎同时），这是可接受的——
  它至少是可揭示的，而不是全部丢失。

## 关联

- 代码：`apps/server/src/hint-scheduler.ts`（`createHintSchedule`）、`apps/server/src/round-machine.ts`（`revealHint`）
- 配置：`packages/config/src/game.ts` 的 `progressiveHintRatio`
