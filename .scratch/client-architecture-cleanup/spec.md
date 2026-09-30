# 规格：客户端架构清理与注释治理（第一阶段）

> 来源：2026-09-30 对 `apps/client/src`（约 13.7k 行）的 codebase-design 深审（四域并行审查报告）。
> 基线：`main@293e8bf`（客户端文件与审查基线 87f4b75 之间零差异，行号有效）。
> 工作目录：git worktree `F:\javascript_project\draw-and-guess-wt`，分支 `agent/session-20260930`。

## 用户裁决（三条，作为本阶段的范围边界）

1. **死表面分类处置**：生产零消费且已被新机制取代的纯残留 → 删除并同步修测试断言；
   有观测/诊断意义的接缝（request.ts 的 `timeout`/`cancelled`、`RequestOptions.requestId`、
   transport 的 `requestState`/`cancelRequests`、协议诊断 get/clear、FloodFillJobResult 观测字段、
   useStrokeSession 的 `pendingBatches`/`activeStrokeId`、useCanvasViewport 的 `resizeCanvas`、
   useCanvasCursor 的 `cursorVisible` 等）→ 保留并在注释中定性为「测试观测接缝/诊断预留」。
2. **行为修复授权**：① useInviteQueue 接受在途停止倒计时；② VocabularyDialog 视图切换统一为
   单入口（清搜索词 + 滚动复位）；③ snapshot-gate 无房间时绘图增量决策改 `ignore`、
   `acceptRoomSnapshot` 返回类型收窄并删消费侧不可达分支。均获准。
3. **传输接缝（request.ts + game-transport.ts + socket.ts 三层收敛）本轮不动**，列为下轮专项候选。

## 明确不做（避免范围蔓延）

- 不拆分长组件（VocabularyDialog/SelectDropdown/ContextMenu）——留作第二阶段专项。
- 不动 barrel 导入风格（AGENTS 约定 barrel 优先，直连引用属约定演进，另议）。
- 不删除各 store 模块的类型导出（无害且测试可能引用）。
- 不合并 `useVirtualRows` 到 `useVirtualTableRows`（唯一消费方判断待第二阶段）。
- `audio/manifest` 的 `required:false`/`optional-missing` 分支：词库音效未来可能标可选，保留（仅注释定性）。
- 不动服务端、shared、strings；`packages/config/src/audio.ts` 仅允许「导出类型」这类零行为改动。

## 验收口径

- 每张工单完成后：改动文件 `npx prettier --write`、`npx eslint <改动文件>`（0 warning）、
  `pnpm typecheck` 全绿、涉及的单测文件 `pnpm vitest run <file>` 通过。
- 全部工单完成后（由主会话执行）：`pnpm format && pnpm lint && pnpm typecheck && pnpm build`，
  再跑 `pnpm test:unit`、`pnpm test:component`、`pnpm test:integration`；关键逻辑另抽跑 `pnpm test:coverage`。
- 提交：每张工单一个 commit，遵循 `type(scope)：中文 subject`。

## 工单索引（文件归属互不重叠，按编号顺序串行执行）

| 编号 | 工单 | 域 |
| --- | --- | --- |
| 01 | issues/01-stores-comments-seams.md | stores 注释修正 + 观测接缝定性 + vocabulary.ts 同形合并 |
| 02 | issues/02-snapshot-gate-narrowing.md | 修复③：门禁类型收窄 + useRoomSync 死分支/死成员回收 |
| 03 | issues/03-canvas-comments-deadcode.md | canvas 注释修正/补全 + replay-machine 死守卫清理 + useStrokeSession 样式单源 |
| 04 | issues/04-audio-surface-trim.md | audio 死表面删除（dispose 链等）+ 注释修正 + 不变量硬化 |
| 05 | issues/05-composables-misc.md | composables 杂项：死分支、bumpTick 删除、修复①、比较器合并 |
| 06 | issues/06-views-comments-simplify.md | views/App/入口：错误注释 + 不可达防御精简 |
| 07 | issues/07-common-components-comments.md | components/common + 词库表格：scrollToIndex 链、类型单源、注释修正 |
| 08 | issues/08-game-room-components.md | components/game + room：修复②、GameHud 接缝消费、MultiSelect 分支回收 |

## 审查结论摘要（供各工单对照）

- stores/composables 层整体质量高，问题集中在「写只存死表面」「返回类型过宽导致的不可达分支」
  「演进后未同步的注释」三类；跨网络/localStorage/DOM 边界的防御均判定正当，不在清理范围。
- 最严重的事实性错误注释：图标按钮四件套 + SideNav 的「aria-\* 无法绑定为 prop」（与 Vue 3.5 行为
  和仓内 ToolButton/AppInput 等事实矛盾）；useToasts/AppToaster 互指样式归属且引用不存在的
  `.toast-bar`；DataTable 占位行注释与模板实现自相矛盾。
- 潜伏陷阱：`SoundManager.dispose` 注释宣称的「应用级注销」调用链不存在；canvas `resize` 同尺寸
  早退分支掩盖「同尺寸赋值亦清空位图」的浏览器语义；audio manifest 键大小写不变量无断言支撑。
