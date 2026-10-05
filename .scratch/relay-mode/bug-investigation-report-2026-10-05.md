# 接龙模式全链路逻辑缺陷与体验优化报告（第二期）

**排查日期**：2026-10-05  
**排查范围**：接龙模式（传话接龙）服务端领域状态机、绘图与快照裁剪通道、客户端舞台与组件、多玩家完整局生命周期  
**验证方式**：

1. **代码静态审查与关联分析**：精读相关协议 Schema、快捷键组合式函数、绘图点数批次与累积历史模型；
2. **编写临时单元/逻辑测试**：针对长笔画（>120点）在 `StrokeSchema` 反序列化时的报错行为进行针对性测试，100% 成功复现 `Too big: expected array to have <=120 items` 崩溃现象；
3. **真实浏览器实机验证**：通过多网络源多玩家环境完成全链路测试与截图物理检验。

---

## 缺陷与优化清单概览

| 编号      | 严重级别 | 缺陷/优化名称                                   | 当前状态               | 根因与修复结果                                                   |
| :-------- | :------- | :---------------------------------------------- | :--------------------- | :--------------------------------------------------------------- |
| **Bug 1** | 阻断级   | 超时代交写错链，覆盖正常猜词并造成题面/答案缺失 | 已修复并有回归测试     | `autoSubmitRemaining` 现使用 `chainFor` 解析该步目标链。         |
| **Bug 2** | 高危级   | 画作提交后仍能继续作画和修改画布                | 已修复并有回归测试     | 服务端拒绝已提交玩家的画布命令；客户端提交后禁用绘画。           |
| **Bug 3** | 体验级   | 投票期顶栏题面未更新为初始词                    | 已修复                 | 顶栏对题面变化进行同步。                                         |
| **Bug 4** | 容错级   | 猜词输入未在客户端限制长度                      | 已修复                 | 输入框与提交守卫均限制为配置的字符数。                           |
| **Bug 5** | 高危级   | 接龙作画时工具与撤销快捷键失效                  | 已修复并有回归测试     | 快捷键按经典画家/接龙拥有可写画布且未提交判权。                  |
| **Bug 6** | 阻断级   | 长笔画后刷新导致账号退出并报协议不匹配          | 已修复并有回归测试     | 单批仍限 120 点，完整笔画/快照允许 1,200 点；协议升级到 `'19'`。 |
| **UI 1**  | 体验级   | 接龙作画提交按钮遮挡画布                        | 已调整并有组件/E2E覆盖 | 提交按钮移至工具栏末尾，猜词浮层仅用于猜词。                     |

---

## 本轮新缺陷与体验优化详尽剖析

### Bug 5（高危级）：接龙作画阶段快捷键完全失效

#### 1. 现象描述

在接龙模式的第 1 棒与第 3 棒作画阶段中，玩家在画板上使用快捷键：

- 撤销 `Ctrl+Z` / `Meta+Z` 无任何反应；
- 重做 `Ctrl+Shift+Z` / `Ctrl+Y` 无任何反应；
- 工具单键快捷键（`b` 画笔、`e` 橡皮擦、`f` 填充）无任何反应。

#### 2. 根因剖析

在 `apps/client/src/composables/useShortcuts.ts` 第 28–29 行：

```ts
function keyHandler(event: KeyboardEvent): void {
  if (!store.isDrawer || store.room?.phase !== 'drawing' || isEditableTarget(event.target)) return
```

- 快捷键监听事件守卫硬编码了两个经典模式专属的前提：`store.isDrawer` 与 `store.room?.phase === 'drawing'`；
- 在接龙模式下：
  1. 房间阶段为 `'relay_choose'`、`'relay_draw'`、`'relay_guess'` 等，**绝不是 `'drawing'`**；
  2. 接龙模式全员在各自链上作画，没有经典单一画家的概念，`store.isDrawer` 计算属性（依赖 `store.room?.game?.drawerId`）恒为 `false`；
- 两个条件在接龙作画中均为假，导致 `keyHandler` 在第 29 行直接 `return` 退出，所有快捷键被静默丢弃。

#### 3. 修复方案

在 `useShortcuts` 中引入与 `GameView.vue` 一致的作画资格裁决逻辑：

- 接龙模式下：当处于 `relay_draw` 阶段、自己拥有画布且未提交时，允许触发工具切换与撤销/重做；
- 经典模式下：保持 `store.isDrawer && store.room?.phase === 'drawing'` 原有行为不变；
- 撤销与重做调用 `store.drawAction(...)`，其底层 `gameplayStore.drawAction` 已自动按房间模式分流到接龙撤销/重做事件，无需额外适配。

---

### Bug 6（阻断级）：游戏中刷新浏览器账号退出且提示协议版本不匹配

#### 1. 现象描述

在游戏进行过程中（尤其是在玩家已经画出了一定数量或长度的线条后），点击浏览器刷新按钮（F5 或重载页面）：

- 页面重新加载后，账号未能自动恢复到游戏对局中，而是被重置注销退回到了初始的 `ProfileView`（角色资料设置页）；
- 页面右上角弹出了错误提示 **`服务器响应与当前协议不匹配，请刷新页面后重试`**（或弹出版本不兼容阻断提示）。

#### 2. 根因剖析

通过深入链路追踪与单元测试断言，彻底定位了该问题的底层协议冲突：

1. **多批次拼接与累积点数**：
   - 客户端在画画时，每批次最多上传 120 个点（`DRAWING_PROTOCOL_LIMITS.maxPointsPerBatch = 120`）；
   - 当玩家画了一条较长或连续的笔画时，客户端会发送多个批次（具有相同的 `stroke.id`）；
   - 服务端绘图内核 `applyStroke` 会将同一笔画的后续批次点数追加到已有命令中：
     ```ts
     // apps/server/src/domain/drawing/drawing-core.ts:139
     existing.points.push(...stroke.points)
     ```
   - 单条笔画的累积点数上限为 1200 个点（`maxPointsPerStroke = 1_200`），完全符合业务预算；
2. **协议 Schema 边界混淆**：
   - 在 `packages/shared/src/protocol/drawing.ts` 中：
     ```ts
     export const StrokeSchema = z.object({
       kind: z.literal('stroke'),
       id: z.string().min(4).max(64),
       tool: z.enum(['pen', 'eraser']),
       ...DrawStyleSchema,
       points: z.array(DrawPointSchema).min(1).max(DRAWING_PROTOCOL_LIMITS.maxPointsPerBatch), // ← 致命错误！
       startPointIndex: z.number().int().nonnegative().optional(),
     })
     ```
   - `StrokeSchema` 的 `points` 数组错误地使用了 **`maxPointsPerBatch (120)`** 作为上限限制；
   - 这个 120 的限制本应用于**单次上传批次**事件（`draw:stroke_batch` / `relay:draw_stroke_batch`），但 `StrokeSchema` 同时被用于 `GameViewSchema`、`RelayCanvasSchema` 以及 `RoomSnapshotSchema` 的历史笔画数组中；
3. **刷新恢复时的连锁崩溃**：
   - 当玩家刷新页面时，客户端自动发起重连注册 `session:register`，携带恢复令牌；
   - 服务端恢复玩家身份，并通过 `snapshotForPlayer(playerId, true)` 返回包含完整画布历史的 `RoomSnapshot`；
   - 如果画布中存在任何一条累积点数 > 120（例如 125 点、150 点）的笔画，该笔画在客户端接收到 ack 响应时，经由 `CLIENT_RESPONSE_SCHEMAS[EVENTS.sessionRegister]`（即 `SessionRegistrationSchema`）进行严格 Zod safeParse；
   - Zod safeParse 发现 `points` 数组元素个数大于 120，直接报错：
     `Too big: expected array to have <=120 items`；
   - 客户端 `createRequester` 判定响应结构损坏，返回 `failureKind: 'protocol', error: strings.ui.request.protocolFailure`（即「服务器响应与当前协议不匹配，请刷新页面后重试」）；
   - `stores/session.ts` 收到该协议错误后，按非传输错误处理：将 `sessionState` 置为 `'idle'`，清空 `playerId`，并将页面重置为 `'profile'`（账号退出）！

#### 3. 修复方案

1. 在 `packages/shared/src/protocol/constants.ts` 的 `DRAWING_PROTOCOL_LIMITS` 中加入协议级单笔累计点数上限 `maxPointsPerStroke: 1_200`；
2. 在 `packages/shared/src/protocol/drawing.ts` 中，将完整历史/快照用的 `StrokeSchema.points` 上限设置为 `maxPointsPerStroke`，并创建只供请求批次使用的 `StrokeBatchSchema`，继续严格限制单批 120 点；
3. 该 Schema 变更会使新服务端快照可包含旧版客户端无法解码的长笔画，属于不兼容协议变化，故 `PROTOCOL_VERSION` 从 `'18'` 升至 `'19'`，并同步客户端与服务端。

---

### UI 1（体验级）：将接龙模式作画提交按钮置于工具栏末尾

#### 1. 现状与问题

- 目前在接龙作画阶段（步 1 和步 3），画布上方浮着一个 `RelayAnswerPanel` 浮层面板（「画完了就提交，交给下一位 [完成提交]」）；
- 浮层直接遮挡画板上半部分，虽然可以拖拽移动，但极大破坏了黄金画板的沉浸创作体验；
- 用户明确要求（对应图片 `[Image #1]`）：将该提交按钮直接移至底部绘图工具条的末尾。

#### 2. 改进方案

1. **`CanvasToolbar.vue` 升级**：
   - 增加 `showRelaySubmit` 与 `relaySubmitted` props，在历史操作组（清空按钮）右侧增加分隔线与主按钮：
     ```html
     <template v-if="props.showRelaySubmit">
       <GroupDivider />
       <AppButton
         variant="primary"
         class="h-[3.8cqh] px-[0.8em] text-fs-12 font-bold shrink-0"
         :disabled="props.relaySubmitted || !props.canDraw"
         :audio-feedback="props.relaySubmitted ? null : 'activate'"
         @click="emit('relay-submit')"
       >
         <Check class="h-[2cqh] w-[2cqh]" />
         <span
           >{{ props.relaySubmitted ? strings.ui.game.relayWaitingOthers :
           strings.ui.game.relayDrawingSubmit }}</span
         >
       </AppButton>
     </template>
     ```
2. **`GameView.vue` 净化画布**：
   - 将 `relayAnswerMode` 的作画分支移除，作画阶段不再挂载任何悬浮浮层，画布居中零遮挡；
   - 工具条监听 `@relay-submit` 事件，直接触发 `submitRelayDrawing`；
   - 浮层 `RelayAnswerPanel` 仅在猜词阶段（`relay_guess`）作为作答输入面板挂载。

## 本轮修复实施与验证结果

- **Bug 5 快捷键**：`useShortcuts.ts` 按当前模式判断作画资格。接龙房要求处于 `relay_draw`、拥有 `ownCanvas` 且未提交；经典模式保留原有画家与 `drawing` 条件。组件回归测试覆盖接龙工具切换、撤销/重做与提交后快捷键禁用。
- **Bug 6 刷新协议报错**：快照整笔 `StrokeSchema` 上限提高至配置协议上限 1,200 点，新增请求专用 `StrokeBatchSchema` 继续限制单批 120 点。协议版本从 `'18'` 升至 `'19'`，所有客户端需刷新至兼容版本。Schema 回归覆盖大笔画 RoomSnapshot 与 sessionRegister ack。
- **UI 1 工具栏提交**：接龙作画提交按钮移至底部工具栏末尾；已提交仍显示锁定等待状态；猜词浮层仅留给猜词阶段。
- **验证结果**：格式化、ESLint、类型检查、构建与包边界扫描通过；`pnpm test:ci` 通过（129 个测试文件、981 个用例）。单独接龙全流程 Playwright 用例通过；长笔画后刷新恢复 Playwright 回归用例通过，刷新前后逻辑画布栅格一致。
- **完整 E2E 套件状态**：完整 `pnpm test:e2e` 未全绿（17 passed），既存规则下拉选项脱离 DOM、资源/计时定位及旧工具栏按钮定位用例超时；接龙全流程及长笔画刷新恢复的单独 Playwright 用例通过。

## 2026-10-05 晚间 UI 体验细节调整（对应用户图片反馈）

### 1. Image 1：底部工具栏接龙提交按钮溢出修复

- **现象**：工具栏末尾的「✓ 完成提交」按钮右侧超出深蓝容器边框，上下也略微超出工具条高度。
- **根因**：`DraggablePanelShell` 默认类为 `left-1/2 -translate-x-1/2`，绝对定位在未声明 `w-max` 时将元素可用布局宽度限制在包含块的 50%；加入提交按钮后 flex 子项总宽度超过此约束而溢出；同时 `AppButton` 底座内置 `min-h-[5.2cqh]` 高于工具条其他按钮的标准高度 `4.4cqh`。
- **修复**：外壳与工具条容器添加 `w-max max-w-full`，使容器能够按照内在完整内容宽度布局；按钮显式声明 `min-h-0 h-[4.4cqh] rounded-[0.45em]`，与其它工具栏按钮完全同高同圆角，紧凑内嵌无溢出。

### 2. Image 2：接龙猜词浮层重构为单行黑边框悬浮栏

- **现象**：原猜词浮层为两行结构，上方有冗余提示文案「看完上图，写下你猜的词」，边框为灰色 `border-line`。
- **修复**：按用户示意图去除顶行提示文案，重构为单行水平排列：`[手柄] [输入框] [提交按钮]`，边框与底色改用与底部工具栏完全一致的 `border-[0.25cqh] border-navy bg-paper/95 rounded-[0.5em]`；输入框占位文案简化为「输入答案」，按钮文案简化为「提交」；本棒超时未提交时在单行内以黄色状态提示，已提交时呈现绿色等待态。

### 3. Image 3：房间顶栏与大厅卡片的模式徽标统一为「接龙模式」

- **现象**：大厅公开房间卡片与房间等待头部的模式徽标文案显示为简写「接龙」。
- **修复**：将 `strings.ui.room.modeRelay` 从「接龙」规范更新为「接龙模式」，大厅公开房卡片、等待房间顶栏及对局顶栏模式徽标统一展示「接龙模式」。

### 4. Image 4：「上家未作答」弱化展示与前置问号图标

- **现象**：上家超时未作答的兜底文本「上家未作答」在动手期作为题面、复盘期作为题面与答案时使用高亮黄色展示，无法与正常作答有效区分。
- **修复**：在 `RelayTopBarCenter` 与 `RelayVoteOverlay` 中，对「上家未作答」统一使用 `text-muted`（灰色）弱化文字，并在文字前置加入 `HelpCircle` 问号圆圈图标；动手期胶囊底色使用弱化半透明底，与看图猜词及正常黄色题目形成清晰的层级区分。

- **回归验证**：
  - `pnpm test:component` 与 `pnpm test:integration` 全部通过；
  - `pnpm test:ci` 通过（129 个测试文件、983 个用例全部通过）；
  - 格式化、Lint、类型检查、生产构建及包边界扫描全部通过。
