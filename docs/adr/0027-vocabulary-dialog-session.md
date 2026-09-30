# 0027 · 词库弹窗会话生命周期独立成 composable

**状态**：已采纳

## 背景

`VocabularyDialog.vue` 是一个 431 行的 SFC，同时承担三件事：

1. **会话生命周期**：`loadGeneration` 世代计数、`vocabularyLoading` 拉取标记、`watch(open)`
   的「打开即拉取 → 迟到结果按世代作废 → 失败自动关闭」、`handleClose` 的取消在途与关闭、
   `saveVocabulary` 的保存后关闭；
2. **词条管理**：列定义、三类筛选、搜索、选择集合与全选；
3. **词库包管理**：包排序、pending 单选与切换。

第 2、3 件事的**无状态部分**已经抽成 `useVocabularyQuery` / `useVocabularySelection` /
`useVocabularyPackages`，但第 1 件事（加载竞态与关闭/保存时序）没有落点，只能在挂载弹窗的
组件测试里间接验证——happy-dom 没有布局尺寸，虚拟表格不会挂载数据行，测试还得替换表格边界。

## 决策

新建 `apps/client/src/composables/useVocabularyDialogSession.ts`，拥有弹窗的会话生命周期：

- **输入**（结构化端口，测试可传 stub）：`open` / `loading` 两个 v-model ref、词库 store 窄面
  （`vocabulary` / `loadVocabulary` / `saveVocabulary` / `cancelVocabularyRequests`）、
  `selectedIds`、`isReadOnly()`，以及三个钩子 `onLoaded`（加载成功后重置选择/搜索/视图）、
  `cancelInFlight`（取消查询防抖 / 词库请求 / 包 pending）、`emitClose`（通知父层）。
- **输出**：`handleClose()` 与 `saveVocabulary()`。

行为与原实现逐条对齐：`open` 变化时以世代计数处理「打开即拉取 / 关闭作废迟到结果 / 拉取中
防重入」，加载成功但 `store.vocabulary` 为空时自动关闭交父层重试，保存成功才关闭。

`VocabularyDialog.vue` 删除 `loadGeneration`、`vocabularyLoading`、`handleClose`、
`saveVocabulary` 与 `open` 监听，改为调用该 composable 并提供协作者与 `onLoaded` 钩子；
`viewMode` 作为纯视图状态**留在组件**（`onLoaded` 里重置为词条模式），不作为会话状态。

## 后果

- 加载竞态（迟到结果作废、拉取防重入、失败自动关闭）与关闭/保存时序可以脱离挂载直测：
  新增 5 个用例（打开即拉取、关闭作废迟到、失败自动关闭、只读/成功/失败保存、handleClose），
  组件级用例保持不变。
- 弹窗组件只保留渲染编排与视图状态；会话生命周期只有一处，`handleClose` 的取消/复位清单
  不再散在 SFC 里。
- 代价：composable 的 options 有若干协作者与钩子（本质是 UI 生命周期协调者）；协作者以结构化
  端口声明，测试传最小 stub 即可，不必拉起整个 store。
- 边界：`useVocabularyQuery` / `useVocabularySelection` / `useVocabularyPackages` 保持不动；
  `viewMode`、表格列、筛选定义与滚动编排仍属组件。

## 关联

- 代码：`apps/client/src/composables/useVocabularyDialogSession.ts`、
  `components/room/VocabularyDialog.vue`、`composables/useVocabularyQuery.ts`、
  `useVocabularySelection.ts`、`useVocabularyPackages.ts`
- 测试：`test/component/ClientComposables.spec.ts`（直测）、
  `test/component/RoomConfigurationDialogs.spec.ts`（组件级）
- 来源：2026-09-26 架构评审候选 5（从 VocabularyDialog 拆出会话生命周期 seam）
- 相关：ADR-0024（回合所有权，同型「决策归模块」取舍）、ADR-0025（resync 模块）
