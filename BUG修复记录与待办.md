# BUG 修复记录与待办

> 本文件由「逐轮浏览代码库 → 找 bug → 修复 → Playwright 验证 → 提交」流程维护，
> 目的是**跨轮次保留上下文**（自动化审计的发现容易在会话间丢失）。
> 已修复内容以 git 提交为准，此处只保留结论与尚未处理的条目。

---

## 一、已修复（结论速览）

| 提交      | 修复要点                                                                                                                                                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4ee2e9f` | 开局倒计时点暂停导致**房间永久冻死**（高危）；撤销/重做/清空**无限频**可放大广播；画布历史**点数无界**；结算展示分数与实际入账**漂移**；`closeRoom` 不解绑成员导致观战者被锁死；幂等缓存连失败 ack 也缓存；词库弹窗 `store.vocabulary!` 断言                            |
| `4a88c79` | 同一连接**重复注册产生幽灵身份**并使按身份存储的限频/房码枚举/邀请冷却全部失效；**暂停期画家离开**卡在 paused；掉线者被排除造成**假满员奖励**；计时器与 `emitRoom` 无兜底可**终结进程**；`respondInvite` 先消费邀请再校验；`ChatPanel` 硬编码 `maxlength`               |
| `99703ef` | `guess:close`（近似答案提示）客户端未监听 → 该规则**完全无反馈**；三处 `close-aria` 漏 `:` 绑定 → aria-label 读作字面量；`ConfirmDialog` 硬编码英文 aria；大厅玩家列表 `overflow-hidden` **静默裁掉玩家**导致无法邀请；猜词失败时**输入被吞**；`SeatGrid` 硬编码 `?? 6` |

---

## 二、剩余待办（按优先级）

### 高

1. **作画中切换工具会导致本笔样式错位**
   `components/GameCanvas.vue` 的批次沿用**实时 props** 的 `tool/color/width`，而服务端 `addStroke`
   对同一 `strokeId` 只 `push(points)`、不改样式 → 整条笔画固化为第一批的样式；同时
   `watch([tool,color,width])` 在 `activePoints` 非空时会用**新工具**重画整条预览。
   触发路径：画笔按下拖动 → 中途按自定义单键切到橡皮擦（`composables/useShortcuts.ts` 只判
   `isDrawer` 与 phase，不判“正在画”）→ 继续拖 → 本地变透明擦除，服务端与其他端仍是画笔线；
   任何一次缩放或快照重绘后画家画面也会跳回权威版本。
   修复思路：作画期间禁止切工具（把 `drawing` 状态暴露给 `useShortcuts`），或切换时先 `pointerUp`
   收尾再开新 `strokeId`；并让批次沿用**按下时**记录的样式快照而非实时 props。

2. **4 个自绘弹窗的 Esc 实际无效**
   `AvatarPickerDialog.vue`、`GameSettingsDialog.vue`、`LobbyView.vue`（创建/私密加入两处）仍使用遮罩
   `div` 上的 `@keydown.esc`。该 div 不可聚焦、也不是 body 焦点的祖先：点击触发按钮后焦点留在按钮上，
   keydown 不会经过该 div，**Esc 关不掉**。四处同时缺少初始聚焦、焦点陷阱与关闭后焦点还原，
   却都声明了 `aria-modal="true"`（声明与实现不符）。
   修复思路：统一迁移到 `BaseDialog`（其 document 级 Esc 已修好），一并补齐焦点管理。

### 中

3. **`GameCanvas.pointerUp` 无条件 `releasePointerCapture`**
   `pointercancel` 时浏览器已隐式释放捕获（指针也可能已失效），此处仍无条件调用且置于
   `drawing=false` / `flushPointBatch()` **之前**；一旦抛 `InvalidPointerId/NotFoundError`，
   `drawing` 会卡在 `true`，后续 `pointerMove` 继续往幽灵笔画加点并发批次。
   修复思路：先 `hasPointerCapture` 判定或 try/catch，并先清理状态再释放。

4. **`GameCanvas.redraw()` 丢掉「正在画的这条笔画」的游标登记**
   `drawnPoints.clear()` 后只回填 `visibleCommands`，未重新登记 `activeStrokeId → activePoints.length`。
   因此由缩放（`resizeCanvas → redraw`）、撤销、工具变化触发的中途 redraw 之后、下一次 `pointerMove`
   之前到达的服务端回显，会以 `prev=0` 从头重绘整条在画笔画（AA 边缘加深、橡皮路径重复擦）。
   修复思路：`redraw()` 末尾补登记在画笔画的已绘点数。

5. **全局定时器与 socket 监听缺少成对清理（HMR 场景）**
   `stores/game.ts` 的 `setInterval(measureLatency, …)` 永不清理；`attachSocketListeners` 只在 store
   setup 注册一次且从不 `off`。开发态改动 `socket.ts` 时其 `dispose(() => socket.close())` 会关掉旧连接
   并由新模块实例 `io()` 新建 socket，但 store 闭包仍持有旧 socket → 推送不再驱动 UI。
   修复思路：`attachSocketListeners` 返回 detach 函数由 store 持有，并在 `import.meta.hot.dispose` 中
   清理定时器与监听。

6. **「背景音乐」音量滑块是死控件**
   `settings/AudioTab.vue` 提供 `musicVolume`，但全仓库无任何消费点（`useAudioFeedback` 只乘
   `masterVolume * soundVolume`），而 `strings.settings.musicVolumeHint` 承诺“轻量大厅和结算音乐”。
   修复思路：接入 BGM/环境音 cue，或先移除该行并按 AGENTS.md 同步 strings，避免“看似可设置实为无效”。

### 低

7. `game/GameHud.vue`、`views/LobbyView.vue` 中延迟显示的 ` ms` 单位字符未走 `config/strings.ts`。
8. `room/InviteDialog.vue` 注释写“空闲**且允许接收邀请**”，代码只过滤 `status === 'idle'`（注释与实现不符）。

---

## 三、需产品确认（跨端语义，客户端不宜擅自裁决）

- **redo 语义**：`game-service.ts` 在新笔画/新填充时执行 `game.undoneStrokeIds = []`，使**被撤销的笔迹
  重新变为可见**。客户端表现为“撤销后随手画一笔，刚撤销的那一笔又回来了”（`GameCanvas` 因
  `undoneStrokeIds.length !== committedUndoLen` 触发全量重绘而忠实还原）。
  标准语义应是“新操作使 redo 栈失效并从历史移除被撤销项”，而非恢复显示。建议连同 redo 交互一并确认。

---

## 四、每轮验证基线

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm build
```

并以 Playwright 覆盖：资料页 → 大厅 → 建房/加房 → 房间（席位/规则摘要/词库/规则/邀请/退出确认）→
设置四页签 → 双人开局与作画；压力项包括快速刷撤销/清空、反复暂停恢复、连点注册；
验收标准：控制台 0 错误、服务端日志无 warn/error、状态机不出现卡死阶段。

---

## 五、第 4 轮更新（已修复项与新增发现）

### 已修复（从「二、剩余待办」移出）

- **作画中切工具导致本笔样式错位**：`GameCanvas` 改为在 `pointerDown` 锁定样式快照 `activeStyle`，
  本地预览、增量重绘与所有上传批次一律沿用快照；并移除「工具/颜色/线宽变化就重绘预览」的 watch。
  这样中途切工具/改色/滚轮改粗细不会影响正在画的这条笔画，本地与其他端的权威历史保持一致。
- **4 个自绘弹窗 Esc 无效**：`AvatarPickerDialog`、`GameSettingsDialog`、`LobbyView`（创建 + 私密加入）
  全部迁移到 `BaseDialog`，删除约 120 行重复的遮罩/卡片/标题栏/底部骨架（JS 产物 430.25 → 426.72 kB）。
  同时 `BaseDialog` 的 Esc 监听从「常驻 `onMounted`」改为「仅 `open` 期间挂载」，两种弹窗用法下行为一致。
- **`pointerUp` 无条件 `releasePointerCapture`**：改为先清状态、flush，再用 `hasPointerCapture` 判定释放，
  避免 `pointercancel` 时抛错导致 `drawing` 卡在 true 并持续给幽灵笔画加点。
- **`redraw()` 丢失在画笔画游标**：重建游标后补登记 `activeStrokeId → activePoints.length`，
  避免缩放/撤销触发的中途重绘后，服务端回显以 `prev=0` 从头重绘在画笔画（AA 加深、橡皮重复擦）。

### 新增发现（重要）

- **`vocabulary.md` 会被 `prettier --write .` 破坏**：prettier 的 markdown 段落重排会把「每行一个词」
  的连续行合并成一段，实测一次就**吃掉 323 行词条**。已把 `vocabulary.md` 加入 `.prettierignore` 并验证
  prettier 不再改动它。**任何人重新格式化全仓前都需注意这一点。**

### 仍需处理（优先级顺延）

- 弹窗仍缺**初始聚焦 / 焦点陷阱 / 关闭后焦点还原**，却声明了 `aria-modal="true"`（建议在 `BaseDialog` 内统一实现）。
- `stores/game.ts` 的 `measureLatency` 全局 interval 与 `attachSocketListeners` 缺 HMR dispose 清理。
- `musicVolume` 是死控件（无消费点）；` ms` 单位与 `InviteDialog` 注释与实现不符等小项。
