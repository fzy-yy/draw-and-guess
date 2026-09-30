# 0015 下拉面板改为 fixed 视口锚定，祖先滚动即关闭

**状态**：已采纳

- 来源：建房弹窗「最大人数」下拉布局异常缺陷（用户截图标注）

## 背景

`SelectDropdown` 的展开面板原为 `absolute` 定位在字段行内。放进弹窗后暴露两类问题：

1. 弹窗表单区是 `overflow-y-auto`（`.dialog-shell` 又 `overflow-hidden`），绝对定位面板虽然
   不参与常规流，但**会贡献最近滚动容器的可滚动溢出区**——面板超出表单下沿时弹窗凭空多出
   一条滚动条（截图右侧），且面板被裁剪、需要滚动才能看全选项，观感即「下拉框进入了布局流」；
2. 触发按钮贴近弹窗底部时（如「最大人数」行），面板必然溢出滚动区，问题 1 必现。

候选方案：Teleport 到 body（丢失 `cqh` 容器单位与舞台字号基准，且跳出 BaseDialog 的
focus-trap，与 ADR-0008 的既定取舍冲突）；每帧跟随重定位（复杂度最高、收益存疑）；
fixed 锚定 + 滚动关闭（原生 `<select>` 在主流浏览器即为滚动关闭语义）。

## 决策

- 面板改 `position: fixed`，打开瞬间由触发按钮 `getBoundingClientRect()` 计算
  `left/top/width/maxHeight`（宽度与按钮等宽；下方放不下整高面板且上方更宽裕时向上翻转；
  `maxHeight = min(26cqh 标尺, 所选侧可用空间)`，cqh 标尺按 `.game-stage` 实际高度换算为 px）；
  面板 DOM 仍留在弹窗内部——不 Teleport，容器单位、focus-trap、aria 关联全部保留；
- **祖先滚动容器滚动（window capture）或 resize → 直接关闭**；面板自身选项列表滚动不关闭。
  配套把 `scrollActiveIntoView` 从 `scrollIntoView` 改为手动设置面板 `scrollTop`——
  前者会连带滚动祖先容器，恰好触发「滚动即关闭」，造成打开瞬间自我关闭；
- 层级沿用面板 `z-40`（弹窗 overlay 为 `z-30`，模态期间面板在全部可见内容之上）。

## 后果

- 面板不再贡献弹窗滚动区、不再被 `overflow` 裁剪，「进入布局流」观感根除；
- 带 `transform` 的祖先会把 fixed 的包含块变成该祖先：弹窗入场 160ms 过渡
  （`scale(0.92)`）期间若强行打开下拉，锚定坐标会相对动画元素偏移。触发按钮在弹窗刚出现的
  160ms 内几乎不可能被点中，属可接受取舍；
- 滚动即关闭与原生 select 语义一致；若未来要求「滚动跟随」，只需把 `onScrollClose` 换成
  rAF 内重跑 `computePanelStyle()`，锚定计算已收敛在单一函数；
- fixed 面板的坐标是内联 px（运行时计算值，非样式表可枚举），组件测试改以
  `style.position === 'fixed'` 与滚动关闭行为为断言对象。

## 关联

- 组件：`apps/client/src/components/common/SelectDropdown.vue`
- 字段行：`apps/client/src/components/common/RuleSelectField.vue`（建房/规则弹窗经其使用）
- 前序取舍：`docs/adr/0008-context-menu-singleton-vs-teleport.md`（不 Teleport 的理由同样适用）
- 测试：`test/component/SelectDropdown.spec.ts`
