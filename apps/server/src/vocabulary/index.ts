/**
 * 词库加载统一入口（Provider 分发与多词库注册表）。
 *
 * 启动时自动扫描 vocabulary 目录下的所有 *.db 词库文件：
 * - 逐个加载并严格校验其 words 与 metadata；
 * - 预先统计各词库的有效词数 wordCount 与元数据（name, description, version, updated_at）；
 * - 默认选择有效词条数最多（wordCount 最大）的词库作为 defaultPackageId；
 * - 提供 VocabularyRegistry 统一管理多词库包，同时兼容单一 VocabularyStore 接口。
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_CONFIG } from '../config/index.ts'
import type { VocabularyPackageInfo, VocabularyWord } from '@draw-guess/shared'
import type { VocabularyMeta } from './contract.ts'
import { SqliteProvider } from './sqlite-provider.ts'

export type { LoadedVocabulary, VocabularyMeta, VocabularyProvider } from './contract.ts'

/** 项目根目录：由文件位置上溯（apps/server/src/vocabulary/../../../..）。 */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

/** 词库装载结果：词条列表 + 按 ID 索引 + 内容哈希版本 + 元信息。 */
export interface VocabularyStore {
  items: VocabularyWord[]
  byId: Map<string, VocabularyWord>
  version: string
  meta: VocabularyMeta
}

/** 多词库注册表：管理所有可用词库包，支持按 ID 检索与默认词库获取。 */
export interface VocabularyRegistry extends VocabularyStore {
  /** 全部已加载词库包元数据列表 */
  packages: VocabularyPackageInfo[]
  /** 默认选中的词库 ID（词数最多者） */
  defaultPackageId: string
  /** 按 ID 获取对应词库 Store */
  get(id: string): VocabularyStore | undefined
  /** 获取默认词库 Store */
  getDefault(): VocabularyStore
}

/** 判断目录项是否为可加载的词库文件（排除 SQLite 运行期附属文件）。 */
function isVocabularyFile(file: string): boolean {
  return (
    file.endsWith('.db') &&
    !file.endsWith('-journal') &&
    !file.endsWith('-wal') &&
    !file.endsWith('-shm')
  )
}

/**
 * 解析词库目录绝对路径列表。
 * 可传入单个或多个显式目录（测试隔离、分发产物「内置 + 用户自定义」双目录），
 * 否则按默认候选路径探测（仓库根 vocabulary 优先）。
 */
function resolveVocabularyDirs(override?: string | readonly string[]): string[] {
  if (override !== undefined) {
    const dirs = typeof override === 'string' ? [override] : [...override]
    return dirs.length > 0 ? dirs : [path.resolve(PROJECT_ROOT, 'vocabulary')]
  }
  const candidates = [
    path.resolve(PROJECT_ROOT, 'vocabulary'),
    path.resolve(process.cwd(), 'vocabulary'),
    path.resolve(process.cwd(), '../../vocabulary'),
  ]
  const found = candidates.find((c) => existsSync(c))
  return [found ?? path.resolve(PROJECT_ROOT, 'vocabulary')]
}

/**
 * 加载所有词库并构建多词库注册表（VocabularyRegistry）。
 * 逐目录扫描 *.db，预先校验并统计词数，默认选择词数最多者。
 * @param dirs 显式词库目录（单个、多个）；缺省按默认候选路径探测。分发产物传入「内置目录 + 数据目录 custom 目录」。
 */
export async function loadVocabulary(
  dirs?: string | readonly string[],
): Promise<VocabularyRegistry> {
  const vocabDirs = resolveVocabularyDirs(dirs)
  const dbFiles: Array<{ dir: string; file: string }> = []
  for (const dir of vocabDirs) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (isVocabularyFile(file)) dbFiles.push({ dir, file })
    }
  }

  // 兜底：所有目录都未扫描到任何 db 时，在首个目录沿用配置指定的默认词库文件名。
  if (dbFiles.length === 0) {
    dbFiles.push({
      dir: vocabDirs[0] ?? path.resolve(PROJECT_ROOT, 'vocabulary'),
      file: path.basename(APP_CONFIG.vocabulary.dbPath),
    })
  }

  const stores = new Map<string, VocabularyStore>()
  const packages: VocabularyPackageInfo[] = []

  for (const { dir, file } of dbFiles) {
    const filePath = path.join(dir, file)
    const provider = new SqliteProvider(filePath)
    const loaded = await provider.load()
    const baseId = loaded.meta.id || path.basename(file, '.db')
    // 内置与用户自定义目录可能出现同名词库：追加数字后缀保证 ID 唯一、互不覆盖。
    // 跨目录归属是确定的（内置目录先扫描）；若同一目录内两个包的 meta.id 相同，
    // 后缀归谁取决于文件系统枚举顺序——那属异常配置，这里只兜底保证不互相吞掉。
    let pkgId = baseId
    for (let suffix = 2; stores.has(pkgId); suffix += 1) pkgId = `${baseId}-${suffix}`
    const store: VocabularyStore = {
      items: loaded.words,
      byId: new Map(loaded.words.map((word) => [word.id, word])),
      version: loaded.version,
      meta: loaded.meta,
    }
    stores.set(pkgId, store)
    packages.push({
      id: pkgId,
      name: loaded.meta.name || baseId,
      wordCount: loaded.words.length,
      description: loaded.meta.description || '',
      version: loaded.meta.fileVersion || '1.0.0',
      updatedAt: loaded.meta.updatedAt || '',
    })
  }

  // 默认选择词数最多的词库；词数相同时按 id 的 UTF-16 码元升序稳定选择，
  // 避免依赖 readdirSync 遍历序导致的结果不确定（见 docs/adr/0004-vocabulary-default-package.md）。
  const byId = (left: { id: string }, right: { id: string }): number =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  const sortedPackages = [...packages].sort(
    (left, right) => right.wordCount - left.wordCount || byId(left, right),
  )
  const defaultPackageId = sortedPackages[0]?.id ?? ''

  const getDefault = (): VocabularyStore => {
    const found = stores.get(defaultPackageId)
    if (!found) {
      const first = stores.values().next().value
      if (!first) throw new Error('没有任何有效词库已被加载')
      return first
    }
    return found
  }

  return {
    packages,
    defaultPackageId,
    get: (id: string) => stores.get(id),
    getDefault,
    // 兼容原 VocabularyStore 接口属性（直接转发至默认词库）
    get items() {
      return getDefault().items
    },
    get byId() {
      return getDefault().byId
    },
    get version() {
      return getDefault().version
    },
    get meta() {
      return getDefault().meta
    },
  }
}
