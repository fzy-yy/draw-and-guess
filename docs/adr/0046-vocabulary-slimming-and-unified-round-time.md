# 0046 · 词库瘦身与统一回合时长

**状态**：已采纳（取代 [ADR-0013](0013-vocabulary-level-config-and-hints.md)）

- 来源：2026-10-01「简化项目复杂度」方向（规格见 `.scratch/custom-word-and-simplification/spec.md`）。

## 背景

词条携带难度（1~~5）、可绘制性（1~~5）、提示（≤10 字）与从 `metadata.level_config` 按难度派生的
时限/权重四类元数据，加载期要跑「枚举互覆盖 + 难度区间 + 提示长度 + 难度级配置完整性」一整条 fail-fast
校验链（见 ADR-0013）。但这四个维度对玩家的实际作用很薄：难度只影响候选抽样的分层与计分缩放，
可绘制性只影响抽样，提示自 [ADR-0042](0042-remove-structured-hints.md) 起已不进入对局链路。

回合时长同样被这层元数据遮蔽：实际时长是
`clamp(词条难度派生时限 ?? 房间 drawSeconds, 45, 180) + extraGuessSeconds`，房主在规则弹窗里看到的
「作画时间回退」只在该词条没有派生时限时才生效，同一个滑块在不同词条上产生不同回合长度。

## 决策

1. **词条只保留必需字段**：`id` / `text` / `category` / `aliases`。删除 `difficulty`、`drawability`、
   `hint` 与按难度派生的 `timeLimit` / `scoreWeight`；词库包元数据只保留名称、描述、版本、更新时间与
   分类枚举。
2. **加载期校验同步收缩**：删除难度/可绘制性枚举、难度区间、提示长度、难度级配置与难度枚举严格互相
   覆盖等校验；保留分类 ⊆ `category_enum`、词面长度、别称长度与数量、主键与词面重复、词数门槛。
3. **代码先不依赖、数据后删列**：Provider 改为只 `SELECT` 自己需要的列，磁盘上的旧词库文件仍带这些
   遗留列时**既不读也不校验**（多余列不报错）。删列属另一次词库重建任务。
4. **候选抽词只留一条偏好**：删除按目标难度分层与难度接近度兜底的逻辑，保留「同一回合的候选尽量来自
   不同分类」——同回合抽到两个「动物」是玩家能直接感知的退化，与难度无关。
5. **单回合时长统一为四档白名单**：`drawSeconds` 收窄为 60 / 90 / 120 / 150（默认 **120**），
   它就是整个作画/猜词阶段的时长；删除 `extraGuessSeconds` 与服务端开关 `useWordTimeLimit`。
   控件由滑块改为 `SelectDropdown` 四档（协议用字面量联合，105 / 135 这类区间内的旧值一律非法）。
6. **暂停语义按「有无截止时间」分支**：`phaseEndsAt === 0` 表示该阶段无截止时间，恢复后不重建倒计时
   （见 [ADR-0045](0045-custom-word-and-untimed-choosing.md)）。

## 后果

- 词库构建与维护成本大幅下降：新词库来源只需提供词面/分类/别称/启用，不再需要造难度、可绘制性与提示。
- 「房间规则决定回合时长」成为唯一口径，房主的选择与实际体验一致；代价是失去 45–180 的连续细粒度，
  只剩四档（这正是减法要的结果）。
- 词库文件与代码在过渡期处于**字段不对齐**状态：旧库里的难度/可绘制性/提示列无人校验。这是刻意接受的
  取舍——把内部重构变成「玩家必须换词库文件」是不可接受的成本。
- 内容哈希的输入字段同步收缩，词库版本号会因这次改动整体变化（客户端按版本号对比，属预期）。

## 关联

- 代码：`apps/server/src/vocabulary/{sqlite-provider,normalize,contract,test-fixture,test-word-specs}.ts`、
  `apps/server/src/domain/vocabulary/candidate-selector.ts`、`packages/shared/src/protocol/response.ts`、
  `apps/client/src/components/room/{VocabularyDialog,VocabTableView}.vue`
- 取代：[ADR-0013](0013-vocabulary-level-config-and-hints.md)（难度级配置加载期解析与提示字段改版）
- 相关：[ADR-0042](0042-remove-structured-hints.md)（结构化提示退出对局链路）、
  [ADR-0047](0047-fixed-100-point-scoring.md)（固定 100 分制）
- 后续：[ADR-0048](0048-vocabulary-schema-slimming.md) 已执行本 ADR 决策 3 的「数据后删列」，并删除
  「是否启用」语义（词库文件不再有 `enabled` 列）。
