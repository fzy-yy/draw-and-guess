# 0017 画布重放原子提交：后备缓冲整帧换入，根除填充空白窗口

**状态**：已采纳

- 来源：e2e 09（绘图历史上限）满载偶发失败的诊断（diagnosing-bugs 全流程）

## 背景

09 用例在完整套件中出现约 2/3 的偶发失败：画家端（增量画布）的逻辑栅格指纹丢失早期红色
填充区域（`00000000-1f2937ff-00000000`），而晚加入者（全量重放画布）正确。类型整改期间的
怀疑「既有负载 flake」经反馈回路证实为**真实渲染缺陷**，且用户可见：

- 专用复现 spec 以 10 次点击/轮的采样在并发负载下 **4/4 命中白帧**；平静负载下每轮洪泛
  （1500 条命令、约 40 笔/秒）也观察到 **18–50 次填充可见性翻转**——画布在作画过程中
  反复丢失又找回填充色。
- 客户端插桩时间线显示：每一笔的权威 ack 都会经 `useStrokeSession` 的「合并点列重放」
  触发一次**全画布重放**；160 次重放中 **92–98 次的填充任务在 Worker 计算刚开始 1–3ms 后
  就被下一笔 ack 的重放取消**。旧实现的重放在开头对**逻辑画布**执行 `clearRect`，随后
  同步画边界、**异步 await 填充**——取消窗口内逻辑层停留在「已清空、仅边界」的半成品帧，
  任何外部读回（e2e 探针 / present 投影）都会看到填充消失。
- 更深的结构洞：`drawnPoints` 簿记只在一帧重放**成功后**重建。若某代重放在填充处中止且
  恰无后继（终态中止），逻辑层停在无填充状态，而簿记仍声称「填充已画」——增量路径、
  快照替换、`fillFailure` resync 全部据此跳过补画，丢失变为**永久**；权威快照同 id 替换
  不触发重绘 + `requestFullSnapshot` 1s 冷却让双保险皆哑。

## 决策

**重放原子提交（double-buffered commit）**：权威历史重放只绘制进组件内隐藏的后备 canvas
（`scratchCanvas`，与逻辑层同尺寸、`willReadFrequently`），整帧全部命令成功后才一次性
`clearRect + drawImage(scratch → logical)` 换入逻辑层并 `present()`。配套不变式：

1. **逻辑层只在提交瞬间变化**：重放中止（取消/过期/故障）不产生任何可见中间态；
2. **簿记与后备内容同口径**：`drawnPoints`/`committed*` 按重放开跑时的命令快照重建，
   绝不高估逻辑层内容——即使极端时序下中止留白，任何后续事件都会经
   `missingFill → redraw()` 自愈，不再有「永久空白」路径；
3. **重放期间新到达的命令**：提交后走 `drawIncoming(logical)` 增量补画（含新填充时它自行
   再排一次全量重放），同时把在途本地预览笔画整体补画回逻辑层（帧交换会抹去预览）；
4. fill 的 `getImageData/putImageData` 全部落在后备上，`putImageData` 整层回写不再可能
   抹掉 await 期间增量画到逻辑层的新笔画。

不改变既有约束：坐标归一化、直线段描边、序号单调、橡皮/填充只传点击与颜色的重放模型
不变（ADR-0003/0009/0010 全部维持）；`present()` 的 DPR 投影与 `__logicalCanvas` 探针语义不变。

## 后果

- 正面：画家端填充空白窗口在复现回路由 **18–50 次/轮降为 0**；e2e 09 的采样竞态从根上
  消失（重放中止不再触碰逻辑层）；ack 合并重放的性能特征不变（160 次重放照旧，只是
  中止的 92–98 次不再产生视觉与簿记副作用）。
- 代价：每帧提交多一次 1040×720 的 `drawImage`（约 1–3ms）与一张后备 canvas（约 3MB），
  换取无闪烁、可预测的提交点。
- 维护约定：**任何新的重放绘制路径都必须经由 `DrawingReplayMachine`（原 `redrawLogical`，现位于 `canvas/replay-machine.ts`，见 ADR-0018）的提交段换入**，
  不得直接向逻辑层 `clearRect`；回归守卫见 `test/component/GameCanvas.spec.ts` 两条
  「09 flake 回归」用例（断言逻辑层在重放在途/被中止时不出现空白中间态）。

## 关联

- 组件：`apps/client/src/components/game/GameCanvas.vue`（装配壳）；重放与提交段已迁入
  `apps/client/src/canvas/replay-machine.ts`（见 ADR-0018）
- 触发方：`apps/client/src/composables/useStrokeSession.ts`（ack 合并重放保持现状，其语义
  由本 ADR 变为不可见）
- 前序：ADR-0003（坐标边界）、ADR-0009（填充降级与两把锁）、ADR-0010（历史上限只增不删）
- 测试：`test/component/GameCanvas.spec.ts`（提交模型断言 + 2 条回归）、e2e 09（稳态比对）
