# 0013 词库重建适配：难度级配置加载期解析与提示字段改版

- 状态：已采纳
- 来源：词库 SQLite 重建（`vocabulary/base_words.db` 结构大改）的适配需求

## 背景

词库被整体重建，库表与元数据发生了不兼容变化：

- `words` 表**删除**逐词 `time_limit`/`score_weight` 两列，**新增** `drawability`（可绘制性 1~5，
  词库作者标注）与 `hint`（提示文案 ≤10 字）两列，另有仅记录编辑时间、不参与玩法的 `updated_at`；
- `metadata` 表**删除** `time_limit_enum`/`score_weight_enum`/`default_time_limit`/`default_score_weight`，
  **新增** `level_config`（难度 → `{time_limit, score_weight}` 映射）、`difficulty_enum`、
  `drawability_enum`、`enabled_enum` 与 `drawability_desc`；
- 目录内现仅 `base_words.db` 一个词库（旧 `test_words.db` 删除）；`hint` 在现有 2000 词中全部非空。

下游对旧结构有一串耦合点：回合时限读逐词 `timeLimit`、计分读逐词 `scoreWeight`、
结构化提示揭示的是词条**分类**（旧词库没有独立提示字段）、词库管理表格与画家选词卡只展示难度。
适配时必须回答三个问题：难度级配置在哪里解析成词条字段？提示揭示改用什么内容？协议 DTO 如何演进？

## 决策

### 1. level_config 在 Provider 加载期解析，下游语义不变

`SqliteProvider.load()` 读词条时按 `difficulty` 查 `metadata.level_config`，把该难度级的
时限与权重**派生**到词条的 `timeLimit`/`scoreWeight` 字段。回合状态机（时限覆盖房间统一秒数）、
计分（权重缩放基础分）、词库管理 UI（时限/权重列）与内容哈希全部沿用原字段，**零感知**这次库表变化。

- 否掉的备选 A「把 level_config 下发到各消费端各自查表」：时限/权重的解析规则会复制进
  round-machine、scoring、snapshot、客户端多处，与「配置单一来源」原则冲突；
- 否掉的备选 B「逐词展开存储、放弃 level_config」：词库作者维护 2000 词的逐词数值远不如
  维护 5 级映射可靠，且与重建词库的既定数据格式不符；
- 库内 JSON 条目沿用库表 **snake_case** 命名（`time_limit`/`score_weight`），Provider 解析时
  一次性收窄为契约层 camelCase——数据库命名域与运行时命名域在此边界完成翻译；
- 校验 fail-fast：`level_config` 与 `difficulty_enum` 必须**严格互相覆盖**（每级都有条目、
  无多余键、`time_limit` 正整数秒、`score_weight` 正数）；`drawability ⊆ drawability_enum`、
  `hint` trim 后 ≤ `maxHintLength`（服务端私有配置，现值 10）。任何异常以带中文文案的 Error
  阻止启动。词库对服务端是只读资产，宁可启动失败也不带病运行——缺一级配置意味着该难度词条
  的时限/权重**无从派生**，静默兜底会让回合时长与得分悄悄偏离词库作者意图；
- 逐词 `updated_at` 与 `metadata.drawability_desc` 仅是词库作者的编辑注记，不进入运行时 DTO。

### 2. 结构化提示改为揭示 `hint`，空则回退分类

单槽位揭示机制与时机（`hintStartRatio`）完全不变，只改揭示内容：
`round-machine` 的开启条件从「有分类」改为「`hint || category`」，
`snapshot` 的 `revealedHints` 映射从 `category` 改为 `hint || category`。

- 选词卡**不给画家**显示 `hint`（协议里 `wordOptions` 只新增 `drawability`），避免提示在选词阶段泄露；
- 保留分类回退：`hint` 允许为空串，旧语义作保底，未来词库若不再维护分类也不受影响。

### 3. 协议 DTO 加必填字段，protocolVersion 11 → 12

`VocabularyWordSchema`（词库快照条目）新增必填 `hint: string` 与 `drawability: int`；
推送 `wordOptions` 条目新增必填 `drawability`。因 strict Schema 会让旧客户端拒绝新服务端
（反之新客户端拒绝缺字段的旧服务端响应），属**不兼容变更**，按约定 `protocolVersion +1`，
客户端注册时校验版本、不匹配即拒绝并提示刷新。

### 4. 配套收敛

- 删除死开关 `useWordScoreWeight`：权重自 SQLite 词库接入起恒参与计分缩放，该开关从未开启过，
  留着只会让人误以为权重可以关闭；
- 兜底词库文件名 `draw_guess_words.db` → `base_words.db`（目录扫描不到任何 `.db` 时的探测路径，
  与现库对齐）；
- `hashWords` 输入纳入 `hint`/`drawability`：两字段变化必须产生新版本号，
  否则客户端与房间词库重置判断会漏检；
- 客户端 UI：选词卡展示「难度 + 可绘」两行星级（文字小标签 + 精确星数），
  词库管理弹窗新增「可绘制性」（星级）与「提示」两列并支持可绘制性多选筛选；
  星级上限 `ui.drawabilityMax` 进 `@draw-guess/config`，与 `difficultyMax` 并列。

## 后果

- 领域层（round-machine/scoring/snapshot）与客户端玩法代码**没有**因库表变化而改变职责边界，
  变化被完整封装在 Provider 与协议 DTO 两处；
- 换词库文件的成本降低：只要新库的 `level_config` 覆盖其 `difficulty_enum` 全部难度级，
  时限/权重策略即随词库数据包走，不需要改任何代码；
- `protocolVersion` 提升要求前后端同步升级：局域网场景下所有玩家需同时刷新页面（既有约定）；
- 提示内容更友好（「喵喵叫的宠物」而非「动物」），但也更依赖词库维护质量——
  `maxHintLength` 校验保证提示不会挤爆 HUD 提示位；
- 新增守护测试：`test/unit/vocabulary-provider.spec.ts` 覆盖派生、透传与全部 fail-fast 分支
  （其 fixture 用真实库的 snake_case 命名，第一时间抓住了「Provider 误按 camelCase 读库」的缺陷）；
  E2E 夹具 `test-fixture.ts` 与新库表同构，词库链路在端到端层持续受验。

## 关联

- 代码：`apps/server/src/vocabulary/sqlite-provider.ts`（解析与校验）、
  `apps/server/src/vocabulary/contract.ts`（`VocabularyMeta`/`VocabularyLevelConfig`）、
  `apps/server/src/round-machine.ts`（提示开启条件）、`apps/server/src/snapshot.ts`（揭示映射与
  wordOptions）、`packages/shared/src/protocol/{constants,response,push}.ts`（DTO 与版本）、
  `apps/server/src/config/private.ts`（`maxHintLength`/兜底 `dbPath`）
- 测试：`test/unit/vocabulary-provider.spec.ts`、`test/e2e/launcher.mts`（fixture 生成）
- 相关：ADR 0004（词库默认包选择）、ADR 0012（ack 运行时边界——`hint`/`drawability` 的
  strict 校验正运行在该边界上）
