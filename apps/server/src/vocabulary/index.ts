/**
 * 词库加载统一入口（Provider 分发）。
 *
 * 按 config/vocabulary.ts 的 provider 字段选择具体实现并完成加载：
 * - 'json-file'：JsonFileProvider（JSON 文件词库，当前默认）；
 * - 将来新增来源（如 'sqlite'）：在此追加分支 + 新 Provider 文件即可，领域层零改动。
 *
 * 内存 Store 结构对领域层保持稳定：{ items, byId, version, meta }。
 * 加载失败抛出带中文文案的 Error，由启动流程阻止服务带病运行。
 */
import { APP_CONFIG } from '../../../../config.ts'
import type { VocabularyWord } from '@draw-guess/shared'
import type { VocabularyMeta, VocabularyProvider } from './contract.ts'
import { JsonFileProvider } from './json-file.provider.ts'

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
    case 'json-file':
      return new JsonFileProvider(APP_CONFIG.vocabulary.filePath, APP_CONFIG.vocabulary.encoding)
    default: {
      const known = 'json-file'
      throw new Error(`未知的词库来源「${APP_CONFIG.vocabulary.provider}」，当前支持：${known}`)
    }
  }
}

/**
 * 加载词库并构建内存 Store。
 * @param rootDirectory 项目根目录（Provider 内部用于定位文件；保留参数兼容既有调用方）。
 */
export async function loadVocabulary(rootDirectory = process.cwd()): Promise<VocabularyStore> {
  void rootDirectory // 路径解析已收敛到各 Provider（见 JsonFileProvider.readWithFallback）
  const provider = createProvider()
  const loaded = await provider.load()
  return {
    items: loaded.words,
    byId: new Map(loaded.words.map((word) => [word.id, word])),
    version: loaded.version,
    meta: loaded.meta,
  }
}
