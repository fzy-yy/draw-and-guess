# 07 common 组件：scrollToIndex 链回收、列类型单源、注释事实修正

Status: ready-for-agent

## 背景

components/common 域审查：DataTable 的 `scrollToIndex` 整条链无消费者（搜索定位预留未兑现）；
`DataTableHeaderColumn` 与共享 `DataTableColumn` 手抄同形；占位行注释与模板实现自相矛盾；
图标按钮家族四份「aria-* 无法绑定为 prop」的**事实性错误注释**（与 Vue 3.5 行为和仓内
ToolButton/AppInput 等真实 ariaLabel prop 矛盾）。

## 文件归属

- apps/client/src/components/common/DataTable.vue
- apps/client/src/components/common/data-table.types.ts
- apps/client/src/components/common/DataTableHeader.vue
- apps/client/src/components/room/VocabTableView.vue（仅删 scrollToIndex 转发一行）
- apps/client/src/components/room/VocabPackageTableView.vue（仅删 scrollToIndex 转发 + 第 7 条注释）
- apps/client/src/components/common/BaseDialog.vue
- apps/client/src/components/common/AsyncModuleFallback.vue
- apps/client/src/components/common/ConfirmDialog.vue
- apps/client/src/components/common/AvatarPickerDialog.vue
- apps/client/src/components/common/BaseIconButton.vue
- apps/client/src/components/common/IconButton.vue
- apps/client/src/components/common/RoundIconButton.vue
- apps/client/src/components/common/SideNav.vue（若不在 common 则以实际路径为准）
- apps/client/src/components/common/HostCrownBadge.vue
- apps/client/src/components/common/AvatarImage.vue
- 测试联动：grep `scrollToIndex` / `DataTableHeaderColumn` 命中的 spec 同步；
  test/unit/documentation.consistency.spec.ts 若引用被改路径需检查（预计不涉及）

## 事项清单

1. **scrollToIndex 链删除**：DataTable.vue 的 expose 与实现、data-table.types.ts 的
   `ScrollableTable.scrollToIndex`（若接口仅剩 scrollToTop 则保留单成员接口或就地定义，
   取简洁者）、VocabTableView / VocabPackageTableView 的转发；`scrollToTop` 链**保留**
   （有真实消费者）。
2. **DataTable.vue:135-137 注释重写**：现模板把虚拟占位渲染为 **tbody 内的 tr/td[colspan]**，
   旧注释宣称「table 外的 div 承载」与「占位 tr 会干扰列宽读取」均已随 colgroup 定宽方案失效
   且与 :165 自相矛盾——按现行实现重写（colgroup 定宽 → 占位行放 tbody 内不推挤 sticky thead，
   并解释为何不能把占位高度挂 th）。
3. **DataTable.vue:23**：「已按『显示字段』过滤」的失效举例改为中性示例（列显隐功能已删）。
4. **DataTableHeaderColumn 单源**：DataTableHeader.vue 的本地重复 interface 删除，改用
   `Pick<DataTableColumn<T>, 'key' | 'label' | 'sortable'>`（或直接 DataTableColumn[]，
   按消费面取最小），DataTable.vue 传参处与相关 spec 同步。
5. **data-table.types.ts**：`sortable?: boolean` 补「undefined = 可排序」语义注释
   （DataTableHeader.vue 的 `!== false` 反直觉判定有处可循）。
6. **BaseDialog.vue**：
   - :102 Esc 路径的 `if (props.dismissible)` 与 closeDialog 内 `if (!props.dismissible) return`
     双保险删一处（保留 closeDialog 内那道，让模板关闭钮同走此路）；
   - `isTopmostDialog` 的 `querySelectorAll('[role="dialog"]')` 处补注释：ActionPopover 面板
     同为 role=dialog 会进入仲裁集合，依赖其 `@keydown.esc.stop` 先截获——两处隐性耦合点名
     互指（ActionPopover 侧的注释由 08 单负责，本单只写 BaseDialog 侧；在 08 单完成前该
     注释以「见 ActionPopover.vue」指向即可）。
7. **注释事实修正（ariaLabel 家族）**：BaseIconButton / IconButton / RoundIconButton / SideNav
   四处「Vue 对 aria-* 恒透传、无法绑定为 prop」为错误表述——改为准确口径：「图标按钮统一用
   `label` prop 命名（表单类原语用 `ariaLabel`），组件内部落到 aria-label」。若你想统一命名
   属于重构，**本单不做**。
8. **HostCrownBadge.vue:6**：删「对局玩家得分条（行尾标记）」使用场景（ScoreStrip 明确不展示
   皇冠）。
9. **AsyncModuleFallback.vue:3**：「充当 defineAsyncComponent 的 loadingComponent/errorComponent」
   改为「由 utils/lazy-component 自管理包装组件在 loading/error 两态渲染」。
10. **ConfirmDialog.vue:3**：「统一红色 danger 确认按钮」改为「默认 danger，可按场景
    （confirmVariant）换 primary——诊断页恢复默认即 primary」。
11. **InviteDialog/RulesDialog 的 close emit 删除不属本单**（归 08 的 room 域文件）；
    AvatarPickerDialog 若无既有 label 命名问题则不动（第 7 条口径检查其注释）。
12. **AvatarImage.vue**：`<span :aria-label="label">` 补 `role="img"`（对齐 HostCrownBadge /
    DifficultyStars 的既有做法，否则无障碍名对 generic 不保证生效）；不改视觉。
13. **StageHeader.vue 若在 common**：:3「大厅与房间等待页共用」补「设置页」消费者。

## 约束

- 组件视觉样式一律行内 Tailwind，不新增共享 CSS；文案零变动（strings 不动）。
- 中文注释；行号为审查快照，先验证。

## 验收

`npx prettier --write <改动文件>` → `npx eslint <改动文件>` → `pnpm typecheck` 全绿 →
grep 定位 DataTable / BaseDialog / focus-trap / 头像相关 component/integration spec 并
`pnpm vitest run` 通过。
