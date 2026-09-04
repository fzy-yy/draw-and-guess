/**
 * 词库加载统一入口（Provider 分发）。
 *
 * 按 config/vocabulary.ts 的 provider 字段选择具体实现并完成加载：
 * - 'sqlite'：SqliteProvider（SQLite 词库库文件，当前默认）；
 * - 将来新增来源：在此追加分支 + 新 Provider 文件即可，领域层零改动。
 *
 * 内存 Store 结构对领域层保持稳定：{ items, byId, version, meta }。
 * 加载失败抛出带中文文案的 Error，由启动流程阻止服务带病运行。
 */
import { APP_CONFIG } from '../../../../config.ts'
import type { VocabularyWord } from '@draw-guess/shared'
import type { VocabularyMeta, VocabularyProvider } from './contract.ts'
import { SqliteProvider } from './sqlite.provider.ts'

export type { LoadedVocabulary, VocabularyMeta, VocabularyProvider } from './contract.ts'
export { canonicalWordId, hashWords } from './normalize.ts'

/** 词库装载结果：词条列表 + 按 ID 索引 + 内容哈希版本 + 元信息。 */
export interface VocabularyStore {
  items: VocabularyWord[]
  byId: Map<string, VocabularyWord>
  version: string
  meta: VocabularyMeta
}

/** 按配置构建 Provider 实例（新增来源时在此追加分支）。 */
function createProvider(): VocabularyProvider {
  switch (APP_CONFIG.vocabulary.provider) {
    case 'sqlite':
      return new SqliteProvider(APP_CONFIG.vocabulary.dbPath)
    default: {
      const known = 'sqlite'
      throw new Error(`未知的词库来源「${APP_CONFIG.vocabulary.provider}」，当前支持：${known}`)
    }
  }
}

/**
 * 加载词库并构建内存 Store。
 * 词库文件定位已收敛到各 Provider 内部（见 SqliteProvider.resolveDbPath），调用方无需传路径。
 */
export async function loadVocabulary(): Promise<VocabularyStore> {
  const provider = createProvider()
  const loaded = await provider.load()
  return {
    items: loaded.words,
    byId: new Map(loaded.words.map((word) => [word.id, word])),
    version: loaded.version,
    meta: loaded.meta,
  }
}
