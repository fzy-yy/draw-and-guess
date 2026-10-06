# 0060 UI 组件深度模块化与视觉稳定性治理

**状态**：已采纳

## 背景

在客户端界面的持续迭代与多模式扩展过程中，逐渐累积了若干前端架构摩擦点与视觉稳定性缺陷：

1. **未复用与样式重复手写（模块浅薄）**：
   - `LobbyView`（创建公开画室、加入私密房间快捷卡片）与 `RuleSummary`（词库管理入口）虽然具有完全相同的“左侧大图标 + 中间标题/说明 + 右侧导航箭头”结构与悬浮动效，但由于缺乏统一的卡片原语，各处均使用原生 `<button>` 并手工拼接长串 Tailwind 类名；
   - `ProfileView` 与 `DiagnosticsTab` 此前各自手写了头像显示按钮，并在组件内部自行声明 `const showAvatarPicker = ref(false)` 且显式挂载 `<AvatarPickerDialog>`，导致调用方承担了本应由字段原语自包含的弹窗生命周期编排；
   - `CreateRoomDialog` 中玩法模式单选与可见性单选各自复制了一整套 `<fieldset><label><input type="radio">...</label></fieldset>` 结构，存在原生 `<input>` 裸露，违反了表单输入原语规范；
   - `App.vue` 根舞台针对协议不兼容、断线重连恢复阻断、被踢提示 3 处场景，重复书写了带有相同圆底图标、大标题、说明文本的 `<BaseDialog>` 裸类名结构，代码冗余且视觉口径分散；
   - `SquareIconButton` 在一次重构中偶然漏掉了默认插槽，导致画板底部工具栏全部图标消失。
2. **弹窗定位上下文嵌套陷阱（局部遮罩错位）**：
   - `BaseDialog` 采用 `absolute inset-0` 实现全屏居中遮罩，其定位依赖于最近的 `relative` 定位祖先；
   - 在 `SettingsView` 中，顶层 `<main>` 缺失 `relative`，反而分别在内部右侧内容区 `div` 及 `DiagnosticsTab` 的 `<section>` 上添加了 `relative`；
   - 这导致当在设置页中通过 `AvatarPickerField` 打开头像弹窗时，弹窗遮罩被困在右侧 1.3 列表单区域内，未能遮蔽顶栏与左侧导航，且弹窗偏离 16:9 舞台中心、产生严重错位。
3. **顶栏阶段字数跳变与视觉抖动**：
   - 接龙顶栏左侧胶囊展示的阶段名称在不同时期字数不均（选词 2 字、作画 2 字、猜词 2 字、复盘展示 4 字、投票 2 字），阶段流转时导致胶囊宽度频繁跳动，破坏了界面的稳定感；
   - 接龙复盘投票卡片的动作文案与图标曾使用“赞同 / 不赞同”与拇指图标，未能最直观地呼应复盘阶段“初始词与最终画作是否匹配”的判定语境。
4. **房间等待页开局提示条件逻辑不全**：
   - 开局准备提示此前仅在接龙模式下生效，且未能清晰隔离房主与非房主视角，未能实现双模式下统一的“等待其他玩家全部准备”提示。

## 决策

### 1. 抽象高复用深模块与消除手写原语

依据 `docs/Vue组件开发规范.md`（M1–M12、S1–S10）规范，将分散手写的样式收敛为通用深模块：

- **`ActionCard.vue`**：提供 `primary`（蓝底）、`navy`（藏青底）、`sky`（浅蓝底带左边框）三种语义变体，内置图标与箭头插槽，替换大厅建房卡片与房间词库管理条目；
- **`AvatarPickerField.vue`**：自包含当前头像展示、点击更换按钮、模态选择弹窗挂载与打开/关闭状态机，外部仅通过 `defineModel<AvatarId>()` 交互，消除外部状态编排；
- **`RadioCardGroup.vue`**：建立通用单选卡片组表单原语，支持泛型值绑定、`useId()` 独立分组、`role="radiogroup"` 与无障碍键盘导航，彻底消除业务模板裸写 `<input type="radio">`；
- **`AlertDialog.vue`**：提炼系统通知与单操作阻断提示深模块，提供 `danger`/`warning`/`info`/`primary` 四种语义图标色阶与标准居中排版，收敛 `App.vue` 中的 3 处手写弹窗；
- **加深 `BaseDialog` 接口**：增加语义化 `size`（`sm` 40cqw、`md` 47cqw、`lg` 58cqw、`xl` 64cqw）与 `centered` 排版属性，`ConfirmDialog` 切换为使用 `size="sm"` 与 `centered`，避免外部直接拼写原子样式类。
- **修复插槽传递**：恢复 `SquareIconButton.vue` 内部的默认插槽 `<slot />`，确保图标正常投影。

### 2. 规范页面主舞台定位上下文（消除遮罩陷阱）

确立全站页面视图的定位层级规范：

- 所有主页面视图（`SettingsView` / `RoomView` / `LobbyView` / `ProfileView`）统一在根 `<main>` 级声明 `class="relative ..."`，建立唯一的视图级绝对定位上下文；
- 严禁在页面内部的子容器（如分栏内容区 `div`、Tab 表单 `<section>`）上声明 `relative` 定位；
- 保证挂载于视图内的任何 `BaseDialog` 弹窗均能通过 `absolute inset-0` 完整覆盖 16:9 的主舞台，遮罩统领整个视口，对话框严格水平与垂直居中。

### 3. 接龙顶栏文案 4 字定宽与投票语境重构

- **顶栏阶段文案 4 字对齐**：更新接龙短阶段文案为固定的 4 个汉字：`选词阶段`、`作画阶段`、`猜词阶段`、`复盘展示`、`投票阶段`；并在 `RelayTopBarLeading.vue` 中为文本容器设置 `w-[4em] text-center whitespace-nowrap`，从机制上杜绝字数跳动引起的布局抖动；
- **投票文案与图标重构**：将复盘投票卡片的两个操作按钮文案更新为“匹配”（`Check` 图标，绿色）与“不匹配”（`X` 图标，红色），直观反映对局链题目吻合度裁决。

### 4. 统一房主开局门禁提示单一口径

重构 `RoomView.vue` 中的 `startGateReason` 派生规则：

- **仅房主可见**：非房主一律不渲染该提示文本（`!store.isHost` 时返回 `undefined`，避免向普通成员展示房主专属的开局阻碍提示）；
- **全员就绪时隐藏**：达到开局条件（`allSet.value === true`）时返回 `undefined`；
- **接龙缺人专属门禁**：接龙模式下在线且可玩人数不足 4 人时，展示 `relayGateNeedPlayers`（如“接龙模式需至少 4 名在线玩家（当前 1/4）”）；
- **全模式等待准备统一**：其余未就绪场景（经典模式人数未齐/未准备，或接龙模式满 4 人但有人未准备），经典与接龙统一展示 `waitForGuestsReady`（“等待其他玩家全部准备”）。

### 5. 废除 `.scratch/`，需求决策全量汇入 ADR

彻底清理历史积累的 `.scratch/` 临时议题与规格目录；后续所有架构与领域决策统一编写为版本化的 ADR 文件记录在 `docs/adr/`，保持单一决策真相源。

## 后果

- **视觉一致性与稳定性恢复**：画板工具栏图标正常显示；设置页中头像选择弹窗全屏遮罩与居中完全恢复；接龙顶栏阶段切换不再产生任何尺寸跳变；
- **组件复用率与心智负担减轻**：卡片、单选组、阻断弹窗与头像选择等典型交互全部封装为单一契约的深模块，页面模板代码大幅精简且严格遵循 Vue 规范；
- **决策沉淀清晰**：所有工程决策归档至 `docs/adr/`，消除了临时需求文档对代码仓库的污染。

## 关联

- 代码：
  `apps/client/src/components/common/{ActionCard,AvatarPickerField,RadioCardGroup,AlertDialog,BaseDialog,ConfirmDialog,SquareIconButton}.vue`、
  `apps/client/src/components/game/relay/{RelayTopBarLeading,RelayVoteOverlay}.vue`、
  `apps/client/src/views/{LobbyView,RoomView,ProfileView,SettingsView}.vue`、
  `apps/client/src/components/settings/DiagnosticsTab.vue`、
  `packages/strings/src/ui/game.ts`
- 测试：
  `test/component/{ActionCard,AvatarPickerField,RadioCardGroup,AlertDialog,CommonControlledComponents,RoomWaitingSurfaces,RelayShowcaseVote}.spec.ts`、
  `test/integration/relay-stage.spec.ts`
- 前序：ADR-0008（舞台内单例不用 Teleport）、ADR-0015（下拉锚定）、ADR-0052（顶栏按钮与胶囊等宽规范）、ADR-0058（接龙权威流程）
