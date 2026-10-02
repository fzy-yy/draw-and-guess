# 0053 · 词库分类升级为自定义合集与工具栏图文胶囊化

**状态**：已采纳

- 来源：2026-10-03 词库管理与交互走查。

## 背景

此前词库模块存在四处交互与数据模型痛点：

1. **分类白名单限制过死**：库表使用 `category` 列与 `metadata` 的 `category_enum` 强校验，词条必须属于预设白名单，玩家自定义词库无法自由定义词组主题；
2. **工具栏搜索框宽度跳动**：在「词条管理」与「词库包选择」两种视图切换时，右侧筛选区出现/消失导致左侧搜索框弹性伸缩；
3. **工具栏图标按钮过于简陋**：切换视图与字段筛选此前使用纯圆形小图标（`<RoundIconButton>`），无可见文字说明，初次使用的玩家难以理解功能；
4. **保存词库弹出两条 Toast**：房主保存词库后，客户端本地 `commitVocabulary` 与服务端全房广播的 `systemNotice` 同时触发，弹出两条文案近乎相同的提示；
5. **表格复选框未垂直居中**：数据表格（DataTable）默认左对齐，且单元格内行首复选框因内联元素基线对齐偏上，未处于几何正中央；
6. **悬浮面板与底部工具栏遮挡争抢**：对局界面内悬浮聊天面板与底部横向绘图工具栏在右下角重叠时，层级固定，用户无法通过点击切换前后置顶关系。

## 决策

1. **分类全链路升级为自定义「合集」（collection）**：
   - SQLite `words` 表的 `category` 列重命名为 `collection`；`metadata` 表彻底删除 `category_enum`；
   - 取消枚举值校验，词条合集名由玩家自由定义（如“动物”、“成语”、“食物”等），代表一组词的集合；
   - 服务端 `SqliteProvider` 在加载时自动从词库词条中去重聚合出全部合集列表 `collections: string[]` 并下发快照；对遗留历史库的 `category` 列做向下兼容自动映射；
   - 前端词库表格将「分类」列改为「合集」列，筛选器自动读取快照聚合的合集列表供一键筛选与全选启用。
2. **搜索框固定宽度与竖向分隔线**：
   - 搜索框设定固定宽度 `w-[22em]`，无论视图如何切换，长度恒定不抖动；
   - 在搜索框与操作按钮之间增加竖向分割线（`h-[2.8cqh] w-[0.16cqh] bg-line`），区隔更清晰。
3. **工具栏按钮升级为「图标 + 文字」胶囊按钮**：
   - 视图切换按钮改为胶囊形态，根据当前视图显示 `<Library /> 词库包` 或 `<ListFilter /> 词条列表`；
   - 筛选器升级 `MultiSelectPopover` 与 `ActionPopover` 支持 `variant="pill"`，显示 `<Tags /> 合集筛选`，词库包视图下自然隐藏。
4. **收敛词库保存通知为单条服务端权威推送**：
   - 移除客户端 `commitVocabulary` 的冗余本地通知，统一由服务端的 `systemNotice` 向房间全员广播单条 Toast，彻底消除双重提示。
5. **表格内容全列水平垂直双向居中**：
   - 通用数据表格 `DataTable` 与表头 `DataTableHeader` 全字段（表头、复选框列、数据列）应用水平居中（`text-center`）与垂直居中（`align-middle`）；
   - 表头与行首复选框使用 `<div class="grid place-items-center">` 包裹，根治复选框在单元格内未垂直居中的问题。
6. **悬浮面板与底部工具栏焦点层级联动**：
   - 在 `floating-panel-z.ts` 引入 `activeSurface` 响应式焦点协调器；
   - 点击画布作画或点击工具栏时，工具栏置顶（`z-28`），面板降级（`z-21..26`）；
   - 点击悬浮面板（包含标题栏拖动、聊天消息区、输入框打字）时，面板置顶（`z-26`），工具栏降至底层（`z-20`），确保正在交互的控件始终位于最上层，同时绝不越过阶段遮罩（`z-30`）。

## 后果

- 玩家自制词库可任意扩展合集名，并能通过「合集筛选 + 表格全选」快速批量启用/禁用某组词；
- 词库弹窗工具栏排版稳定、按钮意图一目了然；
- 表格全字段水平垂直居中，复选框严格居中；
- 悬浮面板与工具栏层级随用户焦点实时响应，作画与聊天互不干扰且无遮挡死锁；
- 词库保存后的用户反馈干净统一。

## 关联

- 代码：`apps/server/src/vocabulary/{sqlite-provider,contract,normalize,test-fixture,test-word-specs}.ts`、`packages/shared/src/protocol/response.ts`、`apps/client/src/components/room/{VocabularyDialog,VocabTableView,VocabPackageTableView}.vue`、`apps/client/src/components/common/{ActionPopover,MultiSelectPopover,DataTable,DataTableHeader}.vue`、`apps/client/src/components/game/{FloatingPanel,CanvasToolbar,floating-panel-z}.vue`、`apps/client/src/views/GameView.vue`、`apps/client/src/stores/vocabulary.ts`、`packages/strings/src/ui/room.ts`
- 规范：`CONTEXT.md`（「词库包」、「词条合集」条目）、`AGENTS.md`（「词库与内容」章节）
- 相关：[ADR-0046](0046-vocabulary-slimming-and-unified-round-time.md)（词库瘦身与统一回合时长）、[ADR-0048](0048-vocabulary-schema-slimming.md)（词库表结构落地瘦身）、[ADR-0052](0052-stage-header-button-unification.md)（顶栏操作按钮统一为图文胶囊并收敛基座组件）
