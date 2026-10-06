# UI 组件规范化改造与服务端联动记录

> 本文档用于记录前端 Vue 组件规范化重构过程中，与服务端协议、状态契约及字段相关的排查与联动说明。

---

## 一、 总体评估结论

本次客户端 UI 规范化改造（包含抽象 `ActionCard`、`AvatarPickerField`、`RadioCardGroup`、`AlertDialog` 以及加深 `BaseDialog` / `ConfirmDialog` / `AppButton` / `AppInput` 等通用基础组件）**完全保持了既有协议层（`@draw-guess/shared`）与 Socket.IO 事件接口的契约不变**。

所有组件改造均遵循「服务端权威 + 纯前端展示与编排优化」原则，未修改任何上送与推送载荷结构，因此**当前无需对服务端代码做任何破坏性或必选变更**。

---

## 二、 潜在联动优化点备忘清单

以下记录在 UI 组件重构排查过程中发现的、未来服务端重构时可协同优化的事项：

### 条目 1：大厅房间列表项状态与模式展示的原语化

1. **当时的情况**：
   在大厅视图（`LobbyView.vue`）中，公开房间列表由 `<article>` 手写实现，需要从 `publicRoom` 对象中取 `gameMode`、`playerCount` 等字段拼接徽标和状态。
2. **对应组件的改动**：
   目前前端统一使用 `ActionCard` 收敛了入口卡片；未来大厅房间列表项可进一步抽象为 `RoomListItem` 或扩展 `ActionCard`。
3. **需要服务端做出的改动（建议项）**：
   服务端 `PublicRoom` DTO 目前已下发 `gameMode`，若未来支持更丰富的房间状态（如自定义标签、轮数进度 `currentRound/totalRounds`），可在 `PublicRoomSchema` 中扩充只读展示字段。
4. **为什么要这样改**：
   让大厅玩家在未进入房间前就能更直观地获知公开房间的对局进度，提高房间发现体验。

---

### 条目 2：头像选择白名单校验与本地一致性

1. **当时的情况**：
   `ProfileView` 与 `DiagnosticsTab` 此前各自手写头像更换按钮与 `AvatarPickerDialog` 弹窗。
2. **对应组件的改动**：
   抽取出统一的深模块 `AvatarPickerField`，内置 `AVATAR_IDS` 常量与弹窗自闭环。
3. **需要服务端做出的改动**：
   无须改动。服务端 `apps/server/src/domain/session/session-service.ts` 与 `packages/shared/src/protocol/constants.ts` 已经拥有严格的 40 个 SVG 编号白名单校验闸门，前后端规则完全一致。
4. **为什么要这样改**：
   前端组件自闭环保证了即使新增使用头像选择的场景，也能保证选择结果受协议常量约束，不会发生非法 ID 上送。
