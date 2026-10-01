/**
 * 词库来源提供者契约（Provider 架构的核心扩展点）。
 *
 * 本文件是 Provider 侧契约（加载与校验的扩展点）；领域侧消费面见 index.ts 的
 * VocabularyRegistry / VocabularyStore（GameService/RoundMachine/Snapshot 等依赖后者），
 * 与「词库数据从哪来」彻底解耦：
 * - 当前实现：sqlite-provider.ts（SQLite 词库库文件，words/metadata 表）；
 * - 将来扩展：实现本接口的新 Provider 后，在 vocabulary/index.ts 的 loadVocabulary
 *   构造点接入（当前无按配置分发——不存在 provider 开关字段）。
 *
 * 各 Provider 的职责边界：
 * 1. 读取原始数据（文件 / 数据库 / 远程）；
 * 2. 严格校验（与自身元数据的交叉校验，如 category ⊆ category_enum）；
 * 3. 规范化（见 normalize.ts：ID 生成、去重、enabled 过滤、内容哈希版本号）；
 * 4. 任何异常数据都以带中文文案的 Error 阻止启动，绝不带病运行。
 */
import type { VocabularyWord } from '@draw-guess/shared'

/** 词库元信息：登记来源与分类白名单，不参与玩法裁决（sourceId 与 wordCount 供测试核验来源与词数）。 */
export interface VocabularyMeta {
  /** 来源实现标识（与 VocabularyProvider.sourceId 一致） */
  sourceId: string
  /** 词库唯一标识 ID（如 base_words） */
  id?: string
  /** 词库名称（metadata 的 name 行；无则缺省为文件名） */
  name?: string
  /** 词库描述（metadata 的 description 行） */
  description?: string
  /** 词库数据自身的版本号（SQLite metadata 的 version 行；无则缺省） */
  fileVersion?: string
  /** 词库最后更新日期（SQLite metadata 的 updated_at 行；无则缺省） */
  updatedAt?: string
  /** 分类白名单（category_enum）：词条分类必须是其子集，并透传给管理 UI 做筛选下拉 */
  categoryEnum: string[]
  /** 词库词数（words 表有效词数，服务端预先检查并保存；供测试核验） */
  wordCount?: number
}

/** Provider 加载结果：已是校验后、过滤后、可直接进入内存领域层的最终形态。 */
export interface LoadedVocabulary {
  /** 已启用（enabled=1）且通过分类/别称/词面校验、去重后的全部词条 */
  words: VocabularyWord[]
  /** 内容哈希版本号（随词库内容变化；供客户端与房间词库选择做变更对比） */
  version: string
  meta: VocabularyMeta
}

/** 词库来源提供者契约。 */
export interface VocabularyProvider {
  /** 来源实现标识（日志/排障用，如 'sqlite'） */
  readonly sourceId: string
  /** 加载并校验词库；任何异常数据抛出带中文文案的 Error */
  load(): Promise<LoadedVocabulary>
}
