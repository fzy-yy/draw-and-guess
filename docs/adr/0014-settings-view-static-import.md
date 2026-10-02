# 0014 设置页改为静态导入，消除首开白闪

**状态**：已废弃（被 0049 取代）

## 背景

用户报告：进入大厅后**首次**点击「设置」会出现一瞬间的白闪，随后设置页一切正常；
第二次及以后打开不再闪；dev 与生产模式均可复现，控制台无任何报错。

排查确认的机制（非猜测，均有复现证据）：

1. 设置页是全应用唯一的**主视图级懒加载**（`App.vue` 经 `defineLazyComponent`）。
   点击「设置」时 `store.page` 同步切换，`App.vue` 的 `v-else-if` 互斥链**立刻卸载
   LobbyView**，而 SettingsView 的异步模块尚未就绪——期间舞台渲染为空。
2. 舞台 `game-stage` 的底色是 `bg-paper`（#f8fafc，近白），空档期露出即「白闪」。
   实测 dev 冷编译下真空窗口约 75~~100ms（高频采样：点击 24ms 后 `<main>` 已消失、
   98ms 后设置页就绪）；生产 chunk 一次网络往返仍有 1~~2 帧空档。
3. 懒加载工厂的 `delay: 120`（防占位闪烁的设计）反而保证空档至少裸露 120ms 窗口；
   第二次打开因浏览器 ESM 缓存同帧 resolve，故「之后正常」。
4. 排查中另发现确凿缺陷：Vue 3.5 的 `defineAsyncComponent` 渲染 `errorComponent` 时
   **只注入 `error`、从不注入 `retry`**（`@vue/runtime-core` createVNode 处可见），
   而 `AsyncModuleFallback.vue` 的重试按钮依赖 `v-if="retry"` ——真实加载失败时
   重试按钮**永远不会渲染**，用户只能手动刷新。

## 决策

1. **SettingsView 与 DiagnosticsTab 改为静态导入**（`App.vue`、`GameView.vue`、
   `components/settings/index.ts`）：整页视图与设置页内二级懒加载的异步边界全部消除，
   视图替换在同一帧完成，白闪从根上不存在。本项目为局域网网页游戏，入口 +5.5 KiB gzip
   （实测 163.1 → 168.1）不构成真实传输压力。
2. **性能预算门禁保留、阈值上调**（入口 gzip 165→176 KiB、首屏 180→192 KiB，约 +5% 余量）：
   门禁的价值是防未来某次改动意外把重依赖拉进入口，不因本次取舍而废除。
3. **懒加载重试改为自管理包装组件**（`utils/lazy-component.ts`）：不再使用 Vue 的
   `defineAsyncComponent`。排查证实其 `errorComponent` 只收 `error` 不注入 `retry`；
   且即便经 `onError` 截获重试函数，先调 `fail()` 进入错误态后内部 Promise 已 settled，
   后续 `retry()` 无法让当前实例回到成功渲染（探针实测：loader 重跑成功、UI 仍卡错误态）。
   新实现用极小包装组件自持 pending/占位/超时/错误状态，「重试」即重跑 loader——
   ESM 失败不进模块缓存，重新 import 会真实重拉；剩余懒模块（词库弹窗、礼花库）的
   失败态从此真正可重试。
4. **守卫反转**（`test/unit/bundle-splitting.spec.ts`）：新增「设置页/诊断页必须静态导入、
   禁止回潮动态 import」的源码守卫，白闪缺陷不允许被无意改回。
5. 整页视图不再走懒加载；`defineLazyComponent` 仅用于视图内部低频组件。该约定写入
   `lazy-component.ts` 头注释与 AGENTS.md。

## 后果

- 正面：首开设置零白闪、零异步边界；加载失败可真正重试；懒加载语义收敛为
  「组件级」单一用途，心智负担更低。
- 代价：入口 gzip +5.5 KiB（约 +3.4%）；首屏下载 +5 KiB 量级，预算阈值随之上调。
- 残余风险：`delay:120` 的占位策略对**组件级**懒加载（词库弹窗）仍可能闪一下占位，
  但其宿主是弹窗内的 `relative` 容器、底色与宿主一致，无白闪观感；如未来词库弹窗
  出现同类反馈，优先评估静态化而不是调 delay。
