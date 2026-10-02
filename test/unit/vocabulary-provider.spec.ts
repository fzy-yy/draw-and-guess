/**
 * SQLite 词库 Provider 专项单测。
 *
 * 覆盖点：
 * 1. 正常加载：只读出词面/合集/别称，meta 透传、合集自动聚合与版本哈希；
 * 2. 严格校验（异常数据必须以中文 Error 阻止加载，绝不带病运行）：
 *    合集为空、词面为空/超长、别称超数/超长、主键与词面重复、词数不足；
 * 3. 内容哈希对词面/别称/合集变化的敏感性。
 *
 * 测试词库只写系统临时目录，每例结束即删除；表结构刻意不带 CHECK 约束，
 * 以便验证「Provider 是异常数据的最后防线」而非依赖数据库约束。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDatabase } from '../../apps/server/src/db/index.ts'
import { SqliteProvider } from '../../apps/server/src/vocabulary/sqlite-provider.ts'

/** 测试词条输入：与当前精简后的 words 表列一致。 */
interface WordInput {
  id: number
  text: string
  collection: string
  aliases: string[]
}

/** 默认合法词条：7 条（minWords=6 通过）。 */
function defaultWords(): WordInput[] {
  return [
    { id: 1, text: '猫', collection: '动物', aliases: ['小猫'] },
    { id: 2, text: '狗', collection: '动物', aliases: [] },
    { id: 3, text: '树', collection: '植物', aliases: [] },
    { id: 4, text: '山', collection: '自然', aliases: [] },
    { id: 5, text: '河流', collection: '自然', aliases: [] },
    { id: 6, text: '电脑', collection: '电器', aliases: [] },
    { id: 7, text: '手机', collection: '电器', aliases: [] },
  ]
}

interface FixtureOptions {
  /** 追加/覆盖的 metadata 行 */
  meta?: Record<string, string>
  /** 需要删除的 metadata 键（模拟缺失） */
  removeMeta?: string[]
  /** 覆盖词条列表；传函数则基于默认词条修改 */
  words?: WordInput[] | ((words: WordInput[]) => WordInput[])
}

let testDirectory = ''
let counter = 0

/** 在临时目录生成一份测试词库库文件（当前精简口径）并返回其绝对路径。 */
function createVocabDb(options: FixtureOptions = {}): string {
  const file = join(testDirectory, `vocab-${(counter += 1)}.db`)
  // 经服务端 db 上下文取连接：pnpm 严格 node_modules 下测试目录不能直接 import better-sqlite3
  const context = createDatabase(file)
  try {
    context.connection.exec(`
      CREATE TABLE metadata(meta_data_key TEXT PRIMARY KEY, meta_data_value TEXT NOT NULL);
      CREATE TABLE words(
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL,
        collection TEXT NOT NULL,
        aliases TEXT NOT NULL
      );
    `)
    const meta: Record<string, string> = {
      name: '测试词库',
      description: 'Provider 单测词库',
      version: '1.0.0',
      updated_at: '2026-09-23',
      ...(options.meta ?? {}),
    }
    if (options.removeMeta) for (const key of options.removeMeta) delete meta[key]
    const insertMeta = context.connection.prepare(
      'INSERT INTO metadata(meta_data_key, meta_data_value) VALUES(?, ?)',
    )
    for (const [key, value] of Object.entries(meta)) insertMeta.run(key, value)

    const words =
      typeof options.words === 'function'
        ? options.words(defaultWords())
        : (options.words ?? defaultWords())
    const insertWord = context.connection.prepare(
      'INSERT INTO words(id, text, collection, aliases) VALUES(?, ?, ?, ?)',
    )
    for (const word of words) {
      insertWord.run(word.id, word.text, word.collection, JSON.stringify(word.aliases))
    }
  } finally {
    context.close()
  }
  return file
}

/** 用给定库文件构造 Provider 并加载。 */
function load(file: string) {
  return new SqliteProvider(file).load()
}

beforeEach(() => {
  testDirectory = mkdtempSync(join(tmpdir(), 'draw-guess-vocab-test-'))
  counter = 0
})

afterEach(() => {
  rmSync(testDirectory, { recursive: true, force: true })
})

describe('SqliteProvider 正常加载', () => {
  it('只读出词面/合集/别称', async () => {
    const loaded = await load(createVocabDb())
    expect(loaded.words).toHaveLength(7)
    expect(loaded.words.map((word) => word.id)).toEqual([
      'sqlite:1',
      'sqlite:2',
      'sqlite:3',
      'sqlite:4',
      'sqlite:5',
      'sqlite:6',
      'sqlite:7',
    ])
    // 词条只剩词面/合集/别称/ID
    expect(loaded.words[0]).toEqual({
      id: 'sqlite:1',
      text: '猫',
      aliases: ['小猫'],
      collection: '动物',
    })
    // 版本号为 12 位 hex 内容哈希
    expect(loaded.version).toMatch(/^[0-9a-f]{12}$/)
  })

  it('meta 透传名称/版本/自动聚合合集列表与词数', async () => {
    const loaded = await load(createVocabDb())
    expect(loaded.meta.sourceId).toBe('sqlite')
    expect(loaded.meta.name).toBe('测试词库')
    expect(loaded.meta.fileVersion).toBe('1.0.0')
    expect(loaded.meta.collections).toEqual(['动物', '植物', '自然', '电器'])
    expect(loaded.meta.wordCount).toBe(7)
  })

  it('trim 别称两端空白', async () => {
    const loaded = await load(
      createVocabDb({
        words: (words) => {
          const first = words[0]!
          return [{ ...first, aliases: [' 小猫 ', '喵星人'] }, ...words.slice(1)]
        },
      }),
    )
    expect(loaded.words[0]!.aliases).toEqual(['小猫', '喵星人'])
  })
})

describe('SqliteProvider 严格校验（异常数据阻止加载）', () => {
  /** 用「覆盖第 1 条词条」的便捷构造生成异常库文件。 */
  function withFirstWord(patch: Partial<WordInput>): FixtureOptions {
    return { words: (words) => [{ ...words[0]!, ...patch }, ...words.slice(1)] }
  }

  it('合集为空 → 拒绝', async () => {
    await expect(load(createVocabDb(withFirstWord({ collection: '   ' })))).rejects.toThrow(
      /合集（collection）不能为空/,
    )
  })

  it('兼容包含遗留 category 列的历史词库', async () => {
    const file = join(testDirectory, `legacy-category-${(counter += 1)}.db`)
    const ctx = createDatabase(file)
    try {
      ctx.connection.exec(`
        CREATE TABLE metadata(meta_data_key TEXT PRIMARY KEY, meta_data_value TEXT NOT NULL);
        CREATE TABLE words(id INTEGER PRIMARY KEY, text TEXT NOT NULL, category TEXT NOT NULL, aliases TEXT NOT NULL);
      `)
      ctx.connection
        .prepare('INSERT INTO metadata(meta_data_key, meta_data_value) VALUES(?, ?)')
        .run('name', '遗留词库')
      const ins = ctx.connection.prepare(
        'INSERT INTO words(id, text, category, aliases) VALUES(?, ?, ?, ?)',
      )
      for (const w of defaultWords()) {
        ins.run(w.id, w.text, w.collection, JSON.stringify(w.aliases))
      }
    } finally {
      ctx.close()
    }
    const legacyLoaded = await load(file)
    expect(legacyLoaded.words[0]!.collection).toBe('动物')
    expect(legacyLoaded.meta.collections).toEqual(['动物', '植物', '自然', '电器'])
  })

  it('词面超长 → 拒绝', async () => {
    await expect(
      load(
        createVocabDb(
          withFirstWord({ text: '这是一个非常非常长的词面用于触发词面长度校验的上限约束条件' }),
        ),
      ),
    ).rejects.toThrow(/长度.*超出允许范围/)
  })

  it('别称数量超限 → 拒绝', async () => {
    await expect(
      load(
        createVocabDb(
          withFirstWord({ aliases: ['一', '二', '三', '四', '五', '六', '七', '八', '九'] }),
        ),
      ),
    ).rejects.toThrow(/别称数超过上限/)
  })

  it('别称超长 → 拒绝', async () => {
    await expect(
      load(
        createVocabDb(
          withFirstWord({ aliases: ['这是一个非常非常长的别称用于触发别称长度上限的约束'] }),
        ),
      ),
    ).rejects.toThrow(/别称.*长度超出允许范围/)
  })

  it('词面重复 → 拒绝', async () => {
    await expect(
      load(
        createVocabDb({
          // 把「狗」的词面改成与「猫」相同：Provider 去重校验应拒绝
          words: (words) => words.map((word) => (word.id === 2 ? { ...word, text: '猫' } : word)),
        }),
      ),
    ).rejects.toThrow(/重复词面/)
  })

  it('词数不足 minWords → 拒绝', async () => {
    await expect(load(createVocabDb({ words: (words) => words.slice(0, 5) }))).rejects.toThrow(
      /有效词条仅 5 个，至少需要 6 个/,
    )
  })
})

describe('内容哈希敏感性', () => {
  it('词面/别称/合集任一变化都会产生新版本号', async () => {
    const baseline = await load(createVocabDb())
    const textChanged = await load(
      createVocabDb({ words: (w) => [{ ...w[0]!, text: '猫咪' }, ...w.slice(1)] }),
    )
    const aliasChanged = await load(
      createVocabDb({ words: (w) => [{ ...w[0]!, aliases: ['小猫', '喵'] }, ...w.slice(1)] }),
    )
    const collectionChanged = await load(
      createVocabDb({ words: (w) => [{ ...w[0]!, collection: '植物' }, ...w.slice(1)] }),
    )
    expect(textChanged.version).not.toBe(baseline.version)
    expect(aliasChanged.version).not.toBe(baseline.version)
    expect(collectionChanged.version).not.toBe(baseline.version)
  })
})
