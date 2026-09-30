# 06 views/入口：错误注释修正与不可达防御精简

Status: resolved

## 背景

views 域审查：多处注释引用已删除机制（懒加载弹窗理由复制残留等）；RoomView 存在与
v-model:open 重复的 @close 绑定、不可达草稿守卫、私密码三层防御中的冗余层；
SettingsView 挂着无消费者的 slot 和纯过桥状态；App.vue 数错视图个数。全部为行为等价
清理或注释修正。

## 文件归属

- apps/client/src/views/ProfileView.vue
- apps/client/src/views/RoomView.vue
- apps/client/src/views/LobbyView.vue
- apps/client/src/views/SettingsView.vue
- apps/client/src/components/settings/DiagnosticsTab.vue（仅第 4 条过桥状态回收）
- apps/client/src/App.vue
- apps/client/src/vue-augmentations.d.ts
- 测试联动：grep `header-actions` / `show-avatar-picker` / `showAvatarPicker` 命中的
  test/component、test/e2e（e2e pages/settings.page.ts 可能有头像选择器操作——若行为等价则
  不改；若必须改测试先停下来在报告说明）

## 事项清单

1. **ProfileView.vue:30**：`relative` 布局理由注释失实（此处无懒加载弹窗，理由是从 RoomView
   复制的）——改为「为 BaseDialog 的 absolute 遮罩提供定位容器」。
2. **RoomView.vue**：
   - :228 `@close="showVocabulary = false"` 删除（关闭已由 v-model:open 写回，且与 221-223
     行注释「只由 v-model:open 控制显隐」自相矛盾）；
   - :83-85 `saveSettings` 的 `if (!settingsDraft.value) return` 不可达守卫删除，
     `settingsDraft.value = draft` 写回入参再原样传 store 的绕圈简化为直接
     `await store.updateRoomSettings(draft)`（先核对 settingsDraft 在弹窗关闭等路径是否还需
     维护，若删赋值会破坏别的读取点则保留赋值只删守卫，报告中说明）；
   - :61,69 私密码复制：删 handler 内 `if (!store.room?.privateJoinCode) return` 一层
     （保留 getter 的 `?? ''`，类型必需；模板 v-if 已挡）。
3. **LobbyView.vue:228 附近**：`room.onlineCount` 等必选数值字段的 `?.`/`?? 0` 兜底与
   `Math.max(0, ...)` 钳位删除（大厅快照经 Zod schema 解码、字段必选且 ≥0——先核对 shared
   lobby schema 再动手）。
4. **SettingsView.vue**：
   - :152 无消费者的 `<slot name="header-actions" />` 删除（连带 :142 相关注释行）；
   - :53 `showAvatarPicker` 上转过桥回收：DiagnosticsTab 的 `v-model:show-avatar-picker`
     defineModel 改为组件本地 `ref`，SettingsView 删该 ref 与模板绑定（先 grep 确认
     SettingsView 从不读写该状态、头像弹窗流程完全归 DiagnosticsTab）。
5. **App.vue**：:60「四个页面视图」改「五个」（对局>房间>设置>大厅>资料）；:27 注释若同样
   写「四个视图组件」一并修正。
6. **vue-augmentations.d.ts**：删除「本次整改正是靠它抓出了 RulesDialog 的联合类型缺陷」等
   时效性过程语（AGENTS 禁止不可追溯的过程表述）；技术性解释保留。:7 对 ADR-0008 的引用若
   与主题（浮层透传）确属牵强，改为泛指「右键菜单/弹窗浮层的透传放行惯例」或直接删半句，
   保留 ADR 编号引用仅当语义真实。

## 约束

- 全部改动行为等价（第 2/4 条有极窄竞态语义差异的，按报告说明取舍）。
- 中文注释；行号为审查快照，先验证。

## 验收

`npx prettier --write <改动文件>` → `npx eslint <改动文件>` → `pnpm typecheck` 全绿 →
grep 定位并 `pnpm vitest run` SettingsView/DiagnosticsTab/RoomView 相关 component/integration spec。
