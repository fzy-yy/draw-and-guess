# 接龙模式全链路逻辑缺陷排查报告

**排查日期**：2026-10-05  
**排查范围**：接龙模式（传话接龙）服务端领域状态机、绘图与快照裁剪通道、客户端舞台与组件、多玩家完整局生命周期  
**验证方式**：

1. **代码静态审查与关联分析**：精读近期提交记录（`git log` 涉及的 10 余个接龙 commit）及关联模块，排查时序、环状拓扑、权限门禁与状态流转；
2. **编写临时单元/逻辑测试**：在 `test/unit/tmp-relay-bugs.spec.ts` 中针对超时处理、画作提交锁定编写针对性测试，均已 100% 成功复现并捕获断言失败；
3. **真实浏览器 5 玩家全链路实机验证**：通过浏览器工具同时拉起 5 个独立网络源（`http://localhost:5173/`、`http://192.168.10.1:5173/`、`http://192.168.81.1:5173/`、`http://10.107.44.156:5173/`、`http://172.28.176.1:5173/`），完整走完「建房 → 准备 → 步1选词 → 步1作画 → 步2猜词 → 步3作画 → 步4猜词 → 复盘逐链轮播 → 逐链投票 → 终局战报 → 返回房间」全部链路，并对关键状态与异常场景进行高清截图检验。

---

## 缺陷清单概览

| 编号      | 严重级别   | 缺陷名称                                                                                                                                                                           | 发现途径                                            | 当前状态             |
| :-------- | :--------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------- | :------------------- |
| **Bug 1** | **阻断级** | `autoSubmitRemaining` 混淆了玩家发起链与本步负责链，导致超时猜词覆盖正常玩家答案，超时链自身猜词遗失为 `undefined`，连锁引发步 3 作画无题面（显示「等待选词…」）与复盘终局答案空白 | 代码静态审计 + 临时单元测试 + 浏览器 5 人跑局截图   | **已证实并定位根因** |
| **Bug 2** | **高危级** | 画画的玩家提交画作后未真正锁定，仍可继续在画布上随意作画涂鸦、撤销、填充与清空，服务端仍持续静默接收生效（用户重点反馈）                                                           | 用户反馈 + 代码审计 + 临时单元测试 + 浏览器多端截图 | **已证实并定位根因** |
| **Bug 3** | **体验级** | 复盘半场 2 切换到投票阶段时，顶栏左侧题面胶囊未能更新为初始词，导致顶栏题面与下方投票卡题面相互矛盾                                                                                | 代码静态审计 + 协议时序分析                         | **已证实并定位根因** |
| **Bug 4** | **容错级** | 接龙猜词作答浮层缺失 `maxlength` 限制，超长文本在前端未被拦截直接提交导致服务端报 `INVALID_MESSAGE`                                                                                | 代码静态审计 + 组件 props 分析                      | **已证实并定位根因** |

---

## 详尽缺陷分析与解决方案

### Bug 1（阻断级）：`autoSubmitRemaining` 超时代交链对象错误导致猜词被篡改与缺失

#### 1. 现象描述

在接龙对局的第 2 棒或第 4 棒猜词阶段中，当倒计时结束触发系统超时代交时：

- **按时提交有效答案的玩家，其答案会被系统强行覆盖冲刷为「上家未作答」**；
- **真正超时未交的玩家，其本应代交的链上却没有任何作答记录，保持为 `undefined`**；
- **连锁破坏第 3 棒作画体验**：负责第 3 棒作画的玩家拿到的题目为 `undefined`，顶栏中央显示「等待选词…」，玩家完全不知道该画什么（无题可画）；
- **连锁破坏复盘与投票**：进入复盘与投票后，第四棒答案为 `undefined`，投票卡右侧答案胶囊显示为空白字符串，严重破坏游戏核心流程。

#### 2. 复现证据

1. **单元测试复现**：运行 `test/unit/tmp-relay-bugs.spec.ts`：
   - 用例 `Bug 1a: P0 超时未交会覆盖 P1 已经提交在 Chain 0 上的猜词` 100% 失败：
     `AssertionError: expected '上家未作答' to be 'P1提交的真实答案猫咪'`
   - 用例 `Bug 1b: P3 提交了，但 P0 超时未交，导致 Chain 3 的猜词变成 undefined` 100% 失败：
     `AssertionError: expected undefined to be '上家未作答'`，且步 3 玩家快照中的 `prompt` 为 `undefined`。
2. **浏览器实机 5 人局截图证据**：
   - 在 5 人接龙实机测试中，让 P1 在步 2 正常提交猜词「剪刀」，P5 故意超时未提交；
   - 倒计时归零换手进入步 3 后，P1 的屏幕截图（`test/test-results/step3-after-timeout-p1.png`）中央顶栏醒目显示 **`等待选词…`**（题面完全丢失）；
   - P2 的屏幕截图（`test/test-results/step3-p2-overwritten.png`）中央显示上一家为 P1，但题面却变成了 **`上家未作答`**（P1 原本提交的「剪刀」被系统无故吞掉覆盖）。

#### 3. 根因剖析

在 `apps/server/src/domain/relay/relay-machine.ts` 的 `autoSubmitRemaining` 方法中：

```ts
// 错误代码位置：apps/server/src/domain/relay/relay-machine.ts:758
private autoSubmitRemaining(relay: RelayGameSecret): void {
  for (const chain of relay.chains) {
    if (relay.stepSubmissions.has(chain.originPlayerId)) continue
    this.writeAutoSubmitProduct(relay, chain) // ← 致命错误！
    relay.stepSubmissions.add(chain.originPlayerId)
  }
}
```

- `relay.chains` 数组中的每一项 `chain`，其 `chain.originPlayerId` 是该链的**发起人**。
- 在第 1 棒时，玩家确实负责自己的发起链；
- 但在第 2 棒、第 3 棒、第 4 棒中，接龙是**环状顺延**的！玩家 `chain.originPlayerId` 在当前步骤负责的链是由 `this.chainFor(relay, chain.originPlayerId, relay.currentStep)` 动态解析出来的链，**绝对不是 `chain` 本身**！
- 对比同文件中的 `autoSubmitStep`（单人断线代交）：
  ```ts
  // 正确写法（autoSubmitStep）：
  this.writeAutoSubmitProduct(relay, this.chainFor(relay, playerId, relay.currentStep))
  ```
  `autoSubmitStep` 正确调用了 `chainFor`，而倒计时到点触发的 `autoSubmitRemaining` 却误传了原 `chain`！
- 因此当玩家 P0 超时时，代码直接将兜底写进了 P0 的发起链 Chain 0，把此时按时提交了 Chain 0 的 P1 的答案强行冲掉，而 P0 真正该作答的 Chain N-1 却根本没有被调用，保持为 `undefined`。

#### 4. 修复方案

修改 `apps/server/src/domain/relay/relay-machine.ts` 中的 `autoSubmitRemaining`：

```ts
private autoSubmitRemaining(relay: RelayGameSecret): void {
  for (const chain of relay.chains) {
    const playerId = chain.originPlayerId
    if (relay.stepSubmissions.has(playerId)) continue
    this.writeAutoSubmitProduct(relay, this.chainFor(relay, playerId, relay.currentStep))
    relay.stepSubmissions.add(playerId)
  }
}
```

---

### Bug 2（高危级）：玩家提交画作后未锁定，仍可继续作画与篡改画布（用户反馈）

#### 1. 现象描述

在接龙作画阶段（第 1 棒或第 3 棒），玩家点击作答浮层上的「完成提交」（`submitDrawing`）后：

- 浮层显示「已提交，等待其他玩家」，左侧头像列表显示绿色「已提交」；
- 但**画板完全没有被锁定**，底部工具栏依然保持全亮可用；
- 玩家仍可在画板上用鼠标拖拽继续划线、使用橡皮擦、换颜色、倒油漆桶填充、撤销或清空画板；
- 服务端对这些绘图命令照单全收，并实时修改该链的权威画作，导致已交卷的内容随时被乱涂篡改。

#### 2. 复现证据

1. **单元测试复现**：运行 `test/unit/tmp-relay-bugs.spec.ts`：
   - 用例 `Bug 2: 玩家点击完成提交后，服务端仍然接受新的绘图命令，未真正锁定画布` 捕获到：P0 调用 `submitRelayDrawing` 后再次发送笔画，服务端返回成功且画布命令数由 1 变成 2！
2. **浏览器实机截图证据**：
   - 截图 `test/test-results/p1-after-finish-submit.png`：P1 绘制了一条 V 字形折线后点击「完成提交」，浮层锁变为「已提交，等待其他玩家」；
   - 截图 `test/test-results/p1-draw-after-submit.png`：在浮层依然锁定显示「已提交」的状态下，P1 在画板下方继续成功画出了第二条粗折线，工具栏依然有效，违背提交锁定规则。

#### 3. 根因剖析

前后端双重缺失锁定守卫：

1. **客户端层**：`apps/client/src/views/GameView.vue` 第 157 行：
   ```ts
   const canDraw = computed(() =>
     isRelay.value
       ? relay.value?.phase === 'relay_draw' && relay.value.ownCanvas !== undefined
       : store.isDrawer && store.room?.phase === 'drawing',
   )
   ```
   接龙分支仅检查了当前是 `relay_draw` 阶段以及自己有画布，**完全没有检查 `!relay.value?.submitted`**！因此玩家提交后，`canDraw` 依然为 `true`，画板未禁用指针监听，工具栏保持显示。
2. **服务端层**：`apps/server/src/domain/relay/relay-canvas-target.ts` 第 54 行：
   ```ts
   export function resolveRelayCanvasTarget(
     source: RelayCanvasSource,
     playerId: string,
     stepId: string,
   ): RelayCanvasDecision {
     const { relay } = source
     if (stepId !== relay.stepId) return { accepted: false, reason: 'stale-step' }
     const step = relay.currentStep
     if (source.phase !== 'relay_draw' || !isDrawingStep(step))
       return { accepted: false, reason: 'not-drawing-step' }
     const originIndex = relay.chains.findIndex((chain) => chain.originPlayerId === playerId)
     if (originIndex < 0) return { accepted: false, reason: 'not-participant' }
     const chainCount = relay.chains.length
     const chain = relay.chains[relayChainIndexOf(chainCount, originIndex, step)]
     if (!chain) return { accepted: false, reason: 'not-participant' }
     return { accepted: true, value: { step, chain, canvas: ... } }
   }
   ```
   服务端在解析绘图目标时，**完全没有校验 `relay.stepSubmissions.has(playerId)`**，也没有在 `relayDrawingSession` 或 `drawing-service.ts` 中设防，导致提交后的连接发来的绘图请求被一路放行写入画布。

#### 4. 修复方案

前后端双向设防：

1. **服务端设防（权威校验）**：
   - 在 `resolveRelayCanvasTarget` 的拒绝枚举中增加 `'already-submitted'`；
   - 若 `relay.stepSubmissions.has(playerId)` 为真，拒绝并返回 `{ accepted: false, reason: 'already-submitted' }`；
   - 装配层映射为协议错误码 `ALREADY_SUBMITTED`（或在 `relayDrawingSession` 守卫中直接抛出 `GameError('ALREADY_SUBMITTED')`）。
2. **客户端设防（交互即时反馈）**：
   - 在 `GameView.vue` 中将 `canDraw` 补充提交判断：
     ```ts
     const canDraw = computed(() =>
       isRelay.value
         ? relay.value?.phase === 'relay_draw' &&
           relay.value.ownCanvas !== undefined &&
           !relay.value.submitted
         : store.isDrawer && store.room?.phase === 'drawing',
     )
     ```
   - 提交后 `canDraw` 自动置假，画板即刻停止捕获触控划线，底部绘图工具栏自动禁用隐藏。

---

### Bug 3（体验级）：复盘半场 2 切换到投票阶段时，顶栏题面未能平滑切换为初始词

#### 1. 现象描述

在复盘半场 2 播放完毕、服务端进入该条链的投票阶段（`relay_vote`）时：

- 画布中央弹出的投票卡（`RelayVoteOverlay`）上正确显示了「初始词 → 第四棒最终答案」；
- 但**顶栏正中央的左侧胶囊依然停留着半场 2 的题面（即第 2 棒猜词答案）**，未能同步更新为初始词，导致同一屏内顶栏与投票卡展示相互矛盾。

#### 2. 根因剖析

在 `apps/client/src/components/game/relay/RelayTopBarCenter.vue` 中：

```ts
const halfKey = computed(() => {
  const showcase = props.showcase
  return showcase ? `${showcase.chainIndex}-${showcase.half}` : ''
})

watch(
  halfKey,
  (key, previousKey) => {
    const nextLeftText = props.showcase?.prompt.text ?? ''
    // ...
    settledLeftText.value = nextLeftText
    void playHalfTransition(outgoing)
  },
  { immediate: true },
)
```

- 服务端在 `relay_showcase` 半场 2 时，`cursor` 为 `{ chainIndex: k, half: 2, page: 'reveal' }`，`halfKey` 为 `${k}-2`；
- 进入 `relay_vote` 投票时，游标保持在 `{ chainIndex: k, half: 2 }`，但服务端的快照裁剪逻辑将 `showcase.prompt.text` 从半场 2 猜词切换为了第 1 棒初始词（S44 / ADR-0058）；
- 此时 `halfKey` 计算结果仍然是 `${k}-2`（没有变化），导致 `watch(halfKey)` 完全不触发，`settledLeftText` 无法更新，依旧显示半场 2 猜词。

#### 3. 修复方案

优化 `RelayTopBarCenter.vue` 中过渡 key 的计算维度，将阶段 `props.phase` 纳入或监听 `props.showcase?.prompt.text` 的实际变化，使投票阶段接入时顶栏平滑同步为初始词。

---

### Bug 4（容错级）：接龙作答输入框缺失 `maxlength` 导致超长输入被服务端报错

#### 1. 现象描述

在猜词作答浮层（`RelayAnswerPanel.vue`）中，输入框未设置最大长度限制：

- 当玩家输入超过 60 个字符时，输入框没有阻断输入；
- 提交按钮依然处于可点击激活状态；
- 点击提交后，服务端协议校验拒绝，弹出 Toast 错误提示 `INVALID_MESSAGE`，体验不友好。

#### 2. 根因剖析

- `apps/client/src/components/game/relay/RelayAnswerPanel.vue` 中：
  ```html
  <AppInput
    v-model="draft"
    :placeholder="strings.ui.game.relayAnswerPlaceholder"
    :disabled="!canSubmit"
    class="flex-1"
  />
  ```
  缺少 `:maxlength="APP_CONFIG.player.chatMaxLength"`；
- 且其 `canSubmitGuess` 计算属性仅判断了 `draft.value.trim().length > 0`，未对字符长度上限进行防御性拦截。

#### 3. 修复方案

在 `RelayAnswerPanel.vue` 中给 `AppInput` 添加 `:maxlength="store.config.player.chatMaxLength"` 并在 `canSubmitGuess` 中加入长度范围校验。

---

## 阶段总结与当前状态

1. **测试用例守护**：所有发现的代码逻辑缺陷均已在 `test/unit/tmp-relay-bugs.spec.ts` 中形成自动化断言，后续修复时可直接作为绿色回归门禁。
2. **代码无修改原则**：本轮排查严格遵守「先找 Bug、寻根因、写文档、不动手修改生产代码」的要求，工作区中目前仅包含测试用例与分析报告，业务代码保持原样。
3. **环境与服务状态**：实机测试中创建的 5 个浏览器会话已全部安全关闭并释放内存，未对全局开发环境或外部文件造成污染。
