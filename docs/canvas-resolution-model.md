# 画布双层分辨率模型

画板使用两个彼此隔离的像素缓冲：

- 逻辑 Canvas 不挂载到 DOM，短边固定为 720 像素，长边按画板 CSS 宽高比计算。服务端确认命令、
  本地乐观笔画、撤销重放和洪泛填充都只作用于该层；因此 DPR 不会改变填充结果或增加像素读回
  成本。
- DOM 展示 Canvas 的 backing store 为 `CSS 尺寸 × min(devicePixelRatio, 2)`。每次逻辑层变化后
  使用关闭图像平滑的 `drawImage` 投影，避免浏览器再把低分辨率 DOM backing store 模糊拉伸。
- 指针位置始终相对 DOM Canvas 的 `getBoundingClientRect()` 归一化到 0～1；逻辑重放再映射到
  `[0, width - 1] / [0, height - 1]`，网络中的归一化点和 fill command 没有变化。
- 只有 CSS 宽高比改变导致逻辑尺寸变化时才完整重放历史；单纯 DPR 或展示尺寸变化只重新投影，
  不重复执行洪泛填充。

`devicePixelRatioCap` 用于展示层分配。兼容性测试覆盖 Chromium DPR 1、1.5
与 Firefox DPR 2，以及逻辑缓冲跨客户端哈希、展示层像素尺寸与后台标签页恢复。

洪泛填充采用可取消 Worker job，扫描线算法、性能基线和一致性约束见
[`flood-fill-performance.md`](./flood-fill-performance.md)。
