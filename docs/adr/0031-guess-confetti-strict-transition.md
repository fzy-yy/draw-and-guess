# 0031 · 猜中礼花的触发口径：严格跃迁、不枚举阶段

## 状态

已采纳

## 背景

「自己猜中时放一次全屏礼花」最初由 `GameView.vue` 内联 `watch` 实现，守卫为
`guessed && !prev && phase === 'drawing'`。

曾出现的缺陷：**最后一名猜词者猜中时没有礼花**。原因是服务端在 `markCorrect` 里
先置位 `guessedAt`，当所有在线猜词者都已猜中时立即 `finishRound` 并把阶段切到
`round_result`——礼花的 `guessed` 跃迁与阶段切换发生在**同一份快照**里，只认 `drawing`
的守卫把这次跃迁吞掉了（历史上的修复曾把守卫放宽为同时放行 `round_result`）。

但「枚举阶段」的写法本身是脆的：

1. 任何**未列入**的阶段（例如最后一回合最终结算的 `game_result`、暂停恢复的瞬态）都会
   静默丢掉本应庆祝的跃迁；规则每加一个阶段就多一处需要同步的名单。
2. `!prev` 把「本组件挂载时上一值为 `undefined`」也当成 `false`，于是页面重载/重连后
   若快照里已经是「已猜中」，会被误判成一次新猜中而补放一次礼花。

## 决策

**触发条件改为严格跃迁，且不依赖阶段枚举**，并抽成独立 composable：

```ts
watch(
  () => store.me?.guessed,
  (guessed, prev) => {
    if (guessed !== true || prev !== false) return
    if (store.settings.animationsEnabled) void fireGuessCorrectConfetti()
  },
)
```

- **`prev === false`（而非 `!prev`）**：只有「已知上一值确为未猜中」的真实跃迁才触发，
  首帧/重载的 `undefined → true` 不再补触发。
- **不枚举阶段**：只要发生真实跃迁就触发，天然覆盖 `drawing`、`round_result`、`game_result`
  以及将来新增的阶段，无需维护名单。
- **抽取为 `composables/useGuessConfetti.ts`**：依赖收窄为 `me` 与 `settings` 两个成员
  （`Pick<ReturnType<typeof useGameStore>, 'me' | 'settings'>`），`GameView` 只调用一行；
  与 `useGameHud`/`useShortcuts`/`useAudioFeedback` 同层，便于单测注入最小替身。

礼花仍是**本机反馈**：只对「猜中的那名玩家」触发一次，不向他人广播。

## 后果

- 「最后一人猜中」在任何回合（含最后一回合进入 `game_result`）都会触发礼花，不再依赖阶段名单。
- 重载/重连不会因快照里既有的「已猜中」而补放礼花；关闭动画设置时不触发。
- 回归由两层测试守护：组件测试（`test/component/GuessConfetti.spec.ts`，覆盖
  `drawing`/`round_result`/`game_result`、首帧不触发、动画关闭、重复快照只触发一次）
  与端到端（`test/e2e/specs/04-game-guessing.spec.ts` 断言最后一名猜词者猜中后
  `body` 上出现礼花 canvas）。
- 若将来需要「全员可见的庆祝」，应另行设计为服务端广播事件，而不是放宽本机的跃迁条件。

## 关联

- 代码：`apps/client/src/composables/useGuessConfetti.ts`、`apps/client/src/views/GameView.vue`、
  `apps/client/src/utils/confetti.ts`
- 测试：`test/component/GuessConfetti.spec.ts`、`test/e2e/specs/04-game-guessing.spec.ts`
- 相关：ADR-0018（画布重放状态机）、ADR-0024（回合所有权）
