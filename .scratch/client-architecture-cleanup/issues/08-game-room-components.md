# 08 game/room 组件：视图切换修复②、ActionPopover/MultiSelect 死面、防御精简

Status: ready-for-agent

## 背景

game/room 域审查：VocabularyDialog 存在两条不等价的视图切换路径（底部按钮绕过清理逻辑，
用户裁决**修复②获批**）；MultiSelectPopover 的非常驻触发分支与 align 机制零消费者；
ActionPopover 的 defineExpose 无人使用；ChatPanel/GameCanvas/GameHud 若干冗余防御与
注释漂移；SeatGrid 声明顺序脆弱。

## 文件归属

- apps/client/src/components/game/ChatPanel.vue
- apps/client/src/components/game/GameCanvas.vue
- apps/client/src/components/game/GameHud.vue
- apps/client/src/components/game/DrawingToolbar.vue
- apps/client/src/components/room/VocabularyDialog.vue
- apps/client/src/components/room/InviteDialog.vue
- apps/client/src/components/room/RulesDialog.vue
- apps/client/src/components/room/SeatGrid.vue
- apps/client/src/components/common/MultiSelectPopover.vue
- apps/client/src/components/common/ActionPopover.vue（仅本单两条：defineExpose、align 机制；
  BaseDialog 的 role=dialog 互指注释也补在 ActionPopover 侧）
- 测试联动：grep 相关组件在 test/component、test/e2e（`test/e2e/pages/room.ts` 的
  toWordListView 走底部按钮——行为改为「清搜索词 + 滚动复位」后确认 e2e 断言不依赖
  「切换后搜索词保留」；若有依赖，报告说明并以 e2e 现状为准调整实现细节，勿改 e2e 期望）

## 事项清单

1. **VocabularyDialog 视图切换统一（修复②）**：新增局部 `switchViewMode(mode)` 单入口
   （封装现 toggleViewMode 的「清搜索词 + 滚动复位 + 切模式」），圆形按钮与底部
   「切换到词条/词库包」按钮全部走它；两条路径行为一致化。
2. **VocabularyDialog 重复计数**：词库包模式下工具栏右侧 `vocabPackageTotal`（307-311）与
   页脚同值展示二选一——保留页脚，删工具栏处（若该位置删除后布局留白突兀，改为放筛选摘要或
   保持空白，以视觉最小变动为准，截图不在本单验收内、报告中说明即可）。
3. **VocabularyDialog:299**：`align="start"` 冗余传参删除（随第 4 条 align 机制移除）。
4. **MultiSelectPopover 死面回收**：
   - 非常驻（Filter 图标 + 文字 + ChevronDown + 数量徽章）触发分支删除——唯一调用方恒传
     `icon-only`；连带 `selectedCount` 徽章逻辑若仅服务该分支则一并删（先核实）；
   - `align` prop 整套删除（'end' 分支零消费者），ActionPopover 的消费点同步；
   - 头注释重写：删「显示字段（列显隐）」职责（功能已删），筛选如实写「分类/难度/可绘制性」。
5. **ActionPopover.vue**：`defineExpose({ close })` 删除（两消费者都经作用域插槽拿 close，
   无人持实例 ref）；`@keydown.esc.stop` 处补注释与 BaseDialog.isTopmostDialog 互指
   （role=dialog 仲裁耦合，防回潮）。
6. **ChatPanel.vue**：
   - :124 `roleTextFor(store.me ?? undefined)` 的 `?? undefined` 删除（类型本就是可空）；
   - :138 消息项 `first:mt-auto` 补「为什么」（不足一屏时整列贴底，聊天窗口锚定技巧）。
7. **GameCanvas.vue**：`revision` prop 从 `revision?: number` + 两处 `?? 0` 收紧为必填
   `revision: number`（唯一绑定点 GameView 传协议必选整数 `game.drawingRevision`——先核对
   push schema；useRoomSync 增量序号同源）；若 strictTemplates 或测试构造缺该 prop 报错，
   同步测试传值。
8. **GameHud.vue:156-166**：`pendingRequests` 本地镜像——computed 已是响应式，删多余 watch
   同步赋值，直接暴露 computed（消费点少一两处 ref 解包，行为不变）。
9. **DrawingToolbar.vue:4**：事件名 `width-change` 更正为 `update:width`；删「本次修改」
   过程语。
10. **InviteDialog.vue**：
    - :2 头注释删「且允许接收邀请」（acceptsInvites 不下发、客户端不可过滤）；
    - :64 「组件在 open=true 时才挂载」的 immediate 理由修正（实际常驻挂载）；
    - `close` emit 删除（RoomView 无监听，关闭已由 v-model:open 承担）——RoomView 侧若
      真有 `@close` 绑定则不删 emit 并报告（先 grep）。
11. **RulesDialog.vue**：同上 close emit 处置。
12. **SeatGrid.vue:37-41**：`pendingKickId` 声明移到引用它的 `kickTarget` computed 之前
    （惰性求值下无运行时风险，纯防顺序腐化）。

## 约束

- 修复②获批；其余为行为等价清理。UI 文案仍全部来自 strings（删分支时若 strings 引用变
  孤儿，**不要**删 strings 包条目——超出本单文件归属，报告列出即可）。
- 中文注释；行号为审查快照，先验证。

## 验收

`npx prettier --write <改动文件>` → `npx eslint <改动文件>` → `pnpm typecheck` 全绿 →
grep 定位相关 component/integration spec 并 `pnpm vitest run` 通过。
