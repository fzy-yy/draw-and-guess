# 0008 右键菜单采用「舞台内单例状态 + 受控组件」而非 Teleport

**状态**：已采纳

- 来源：通用右键菜单需求

## 背景

游戏需要一个可复用的右键菜单：同一次右键要能按场景弹出不同列表（聊天消息、席位、画板……），
点击列表项执行各自动作。项目此前没有任何菜单/下拉原语，只有「挂在触发按钮上」的 ActionPopover。

两条路各有代价：

- **每个调用点各挂一个菜单实例**：最贴近普通组件，但菜单会被祖先容器的 `overflow-hidden`
  裁剪（聊天消息列表本身就是滚动容器），且每个调用点都要重复「定位 + Esc + 点外关闭」样板；
- **Teleport 到 body**：实现简单，但全站渲染上下文是 `.game-stage`（`container-type: size` +
  `font-size: clamp(12px, 2cqh, 18px)`）；挂到 body 会同时丢失 `cqh/cqw` 容器单位与舞台字号基准，
  菜单尺寸、字号、阴影全部需要另起一套标尺，且项目此前没有任何 Teleport 先例。

## 决策

- 菜单在**游戏舞台根层级**渲染（`absolute inset-0` 的透明层 + 层内绝对定位面板），
  于是既保留容器单位上下文，又不会被任何中间容器裁剪；定位以舞台为坐标系，越界时先翻转到
  落点左上、再夹取到 `EDGE_GAP` 内（纯函数 `context-menu-position.ts`，可脱离 DOM 单测）；
- 状态与渲染分离：`composables/useContextMenu.ts` 持有模块级单例状态（同 `useToasts` 的架构），
  `components/common/ContextMenu.vue` 是标准的受控组件（`v-model:open` + `items/x/y/ariaLabel` props
  - `select` 事件），由 `App.vue` 挂载唯一实例并接线。任意场景只需一行
    `menu.open(event, items)`，同一时刻天然只有一个菜单；
- 单例状态用 `shallowReactive`：菜单项里的 `icon` 是 Vue 组件对象，深层响应式会把组件也代理一层；
- 透明层为 `pointer-events-none`，只有面板接收指针事件。因此「点外关闭」这一次左键会穿透给下层
  UI（与 ActionPopover 的 `onClickOutside` 语义一致）；而右键点另一处目标时不会关闭再重开，
  `@vueuse/core` 的 `onClickOutside` 只响应 `click`（左键），菜单在同一次手势内原地换成新场景。

## 后果

- 任意场景接入成本为一行；菜单层级、定位、键盘行为只有一处实现，不会随接入点增多而分叉；
- 透明层不拦截指针，首次点外关闭会同时触发下层控件（例如点到画板会落下一笔）。这是与既有
  浮层一致的取舍；若改为整屏拦截遮罩，右键换场景就需要按两次，与「按场景换列表」的目标冲突；
- 菜单内容区不做键盘焦点陷阱（非模态语义）：Tab 会收起菜单并把焦点交还页面；Esc 在捕获阶段
  终止传播，因此不会顺手关掉下层弹窗；
- 组件不引入 Teleport，后续若要支持二级子菜单、触屏长按，可在 `ContextMenuItem` 模型上增量扩展
  （子项递归 / 长按计时器），不需要改变本决策。

## 关联

- 组件：`apps/client/src/components/common/ContextMenu.vue`
- 定位纯函数：`apps/client/src/components/common/context-menu-position.ts`
- 状态层：`apps/client/src/composables/useContextMenu.ts`
- 唯一实例与接线：`apps/client/src/App.vue`
- 过渡钩子：`apps/client/src/style/animations.css`（`.context-menu-*`）
