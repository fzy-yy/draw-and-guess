# 0048 · 词库表结构落地瘦身：words 只留词面/分类/别称

**状态**：已采纳

- 来源：2026-10-01「简化项目复杂度」方向；执行 [ADR-0046](0046-vocabulary-slimming-and-unified-round-time.md)
  决策 3 里「代码先不依赖、数据后删列」的后半截。删列经 DBX（`@dbx-app/mcp-server`）连接词库文件执行。

## 背景

ADR-0046 把词条模型收窄为 `id` / `text` / `category` / `aliases`，但当时只做到「代码不依赖」：磁盘上的词库
文件仍带 `difficulty` / `drawability` / `hint` / `enabled` / `updated_at` 列，`metadata` 仍带
`difficulty_enum` / `drawability_enum` / `drawability_desc` / `enabled_enum` / `level_config`。

结果是同一件事有两套口径：代码里早已没有难度与提示，文件里却还摆着它们的取值；Provider 还得常备一段
「多余列不读不校验」的兼容解释。更危险的是 `enabled`——它看起来仍是一个生效中的开关，实际上没有任何
代码读它，改成 0 也照样进候选池。

## 决策

1. **words 表只留 `id` / `text` / `category` / `aliases`**：删除 `difficulty`、`drawability`、`hint`、
   `enabled`、`updated_at`，并删除 `idx_words_pick`（它按 `enabled, category, difficulty` 建，抽词早已
   全部在内存完成，索引没有消费者）。
2. **metadata 只留 `name` / `description` / `category_enum` / `version` / `updated_at`**：删除
   `difficulty_enum`、`drawability_enum`、`drawability_desc`、`enabled_enum`、`level_config`。
   保留的 `version` / `updated_at` 是词库包自身的版本与更新日期，仍由词库包列表展示。
3. **删除「是否启用」语义**：所有词条一律进入候选池，Provider 不再有 `enabled` 过滤；旧库里
   `enabled=0` 的行现在会照常加载（不再被解释为下架）。内容哈希本就不含该列，版本号与词条集不变。
4. **一次性执行、不引入迁移框架**：删列以 `ALTER TABLE ... DROP COLUMN` + `VACUUM` 直接作用在词库文件上；
   Provider 继续「只 `SELECT` 自己需要的列」，旧库文件里若仍残留这些列既不读也不校验。

## 后果

- 词库文件、Provider 与文档三处口径一致；新增词库来源要提供的字段最少。
- 失去「下架词条但保留数据」的能力：要下架就删词条，或另存一份词库包。这是减法方向接受的取舍。
- 删列不可逆：回滚要靠文件备份或版本库里的旧文件；`metadata` 的 `version` 仍由词库作者手动维护。
- 协议与 DTO 不变（本来就不含这些字段），客户端无需同步改动。

## 关联

- 代码：`apps/server/src/vocabulary/{sqlite-provider,contract,test-fixture}.ts`、
  `test/unit/vocabulary-provider.spec.ts`、`vocabulary/base_words.db`
- 相关：[ADR-0046](0046-vocabulary-slimming-and-unified-round-time.md)（词库瘦身与统一回合时长）、
  [ADR-0047](0047-fixed-100-point-scoring.md)（固定 100 分制）
