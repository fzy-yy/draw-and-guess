/**
 * SQLite 词库 Provider 专项单测（词库瘦身适配后）。
 *
 * 覆盖点：
 * 1. 正常加载：只读出词面/分类/别称，meta 透传与版本哈希；
 * 2. **兼容路径**：旧词库文件仍带 difficulty/drawability/hint/enabled 列与 level_config /
 *    difficulty_enum / drawability_enum / enabled_enum 元数据键时照常加载，多余列既不读也不校验
 *    （词库表已删列，见 ADR-0048）；
 * 3. 严格校验（异常数据必须以中文 Error 阻止加载，绝不带病运行）：
 *    category_enum 缺失、分类越界、词面为空/超长、别称超数/超长、主键与词面重复、词数不足；
 * 4. 内容哈希对词面/别称/分类变化的敏感性。
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

/** 测试词条输入：与旧词库 words 表列一致（遗留列仍在，用于覆盖兼容路径）。 */
interface WordInput {
  id: number
  text: string
  category: string
  difficulty: number
  drawability: number
  enabled: number
  aliases: string[]
  hint: string
}

/** 默认合法词条：7 条（minWords=6 通过）；legacy 列 enabled 仍写出，用于证明它不再参与过滤。 */
function defaultWords(): WordInput[] {
  return [
    {
      id: 1,
      text: '猫',
      category: '动物',
      difficulty: 1,
      drawability: 1,
      enabled: 1,
      aliases: ['小猫'],
      hint: '喵喵叫的宠物',
    },
    {
      id: 2,
      text: '狗',
      category: '动物',
      difficulty: 2,
      drawability: 1,
      enabled: 1,
      aliases: [],
      hint: '人类的好朋友',
    },
    {
      id: 3,
      text: '树',
      category: '植物',
      difficulty: 3,
      drawability: 2,
      enabled: 1,
      aliases: [],
      hint: '秋天会落叶',
    },
    {
      id: 4,
      text: '山',
      category: '自然',
      difficulty: 4,
      drawability: 3,
      enabled: 1,
      aliases: [],
      hint: '',
    },
    {
      id: 5,
      text: '河流',
      category: '自然',
      difficulty: 5,
      drawability: 2,
      enabled: 1,
      aliases: [],
      hint: '水往这里流',
    },
    {
      id: 6,
      text: '电脑',
      category: '电器',
      difficulty: 2,
      drawability: 4,
      enabled: 1,
      aliases: [],
      hint: '可以打字',
    },
    {
      id: 7,
      text: '遗留启用位为零的词',
      category: '动物',
      difficulty: 1,
      drawability: 1,
      enabled: 0,
      aliases: [],
      hint: '启用位列已退出领域模型，写入 0 也照常加载',
    },
  ]
}

/** 旧词库遗留的 level_config：Provider 已不再读取，夹具写出只为覆盖兼容路径。 */
function legacyLevelConfig(): Record<string, { time_limit: number; score_weight: number }> {
  return {
    '1': { time_limit: 45, score_weight: 5 },
    '2': { time_limit: 60, score_weight: 6 },
    '3': { time_limit: 75, score_weight: 6 },
    '4': { time_limit: 75, score_weight: 7 },
    '5': { time_limit: 90, score_weight: 9 },
  }
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

/** 在临时目录生成一份「旧版词库」库文件（带全部遗留列与元数据键）并返回其绝对路径。 */
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
        category TEXT NOT NULL,
        difficulty INTEGER NOT NULL,
        drawability INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        aliases TEXT NOT NULL,
        hint TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `)
    const meta: Record<string, string> = {
      name: '测试词库',
      description: 'Provider 单测词库',
      version: '1.0.0',
      updated_at: '2026-09-23',
      category_enum: JSON.stringify(['动物', '植物', '自然', '电器']),
      // 以下三个键是旧词库遗留：Provider 不再读取，写出只为覆盖兼容路径
      difficulty_enum: JSON.stringify([1, 2, 3, 4, 5]),
      drawability_enum: JSON.stringify([1, 2, 3, 4, 5]),
      enabled_enum: JSON.stringify([0, 1]),
      level_config: JSON.stringify(legacyLevelConfig()),
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
      `INSERT INTO words(id, text, category, difficulty, drawability, enabled, aliases, hint)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const word of words) {
      insertWord.run(
        word.id,
        word.text,
        word.category,
        word.difficulty,
        word.drawability,
        word.enabled,
        JSON.stringify(word.aliases),
        word.hint,
      )
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
  it('只读出词面/分类/别称，遗留的 enabled 列不再参与过滤', async () => {
    const loaded = await load(createVocabDb())
    // 7 条全部加载：词库已删除「是否启用」概念，旧库里的 enabled=0 不再被解释为下架
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
    // 词条只剩词面/分类/别称/ID：难度、可绘制性与提示已随词库瘦身移除
    expect(loaded.words[0]).toEqual({
      id: 'sqlite:1',
      text: '猫',
      aliases: ['小猫'],
      category: '动物',
    })
    // 版本号为 12 位 hex 内容哈希
    expect(loaded.version).toMatch(/^[0-9a-f]{12}$/)
  })

  it('旧词库仍带难度/可绘制性/提示列与 level_config 元数据时照常加载', async () => {
    // createVocabDb 默认就写出全部遗留列与元数据键：加载成功即证明「多余列不报错」
    const loaded = await load(createVocabDb())
    expect(loaded.words).toHaveLength(7)
    expect(loaded.meta).not.toHaveProperty('difficultyEnum')
    expect(loaded.meta).not.toHaveProperty('drawabilityEnum')
    expect(loaded.meta).not.toHaveProperty('levelConfig')
    expect(loaded.words[0]).not.toHaveProperty('difficulty')
    expect(loaded.words[0]).not.toHaveProperty('hint')
  })

  it('meta 透传名称/版本/分类白名单与词数', async () => {
    const loaded = await load(createVocabDb())
    expect(loaded.meta.sourceId).toBe('sqlite')
    expect(loaded.meta.name).toBe('测试词库')
    expect(loaded.meta.fileVersion).toBe('1.0.0')
    expect(loaded.meta.categoryEnum).toEqual(['动物', '植物', '自然', '电器'])
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

  it('缺少 category_enum → 拒绝并点名元数据键（而非误导为词条分类越界）', async () => {
    await expect(load(createVocabDb({ removeMeta: ['category_enum'] }))).rejects.toThrow(
      /category_enum.*非空 JSON 数组/,
    )
  })

  it('分类越出 category_enum → 拒绝', async () => {
    await expect(load(createVocabDb(withFirstWord({ category: '外星语' })))).rejects.toThrow(
      /不在 category_enum 白名单内/,
    )
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
  it('词面/别称/分类任一变化都会产生新版本号', async () => {
    const baseline = await load(createVocabDb())
    const textChanged = await load(
      createVocabDb({ words: (w) => [{ ...w[0]!, text: '猫咪' }, ...w.slice(1)] }),
    )
    const aliasChanged = await load(
      createVocabDb({ words: (w) => [{ ...w[0]!, aliases: ['小猫', '喵'] }, ...w.slice(1)] }),
    )
    const categoryChanged = await load(
      createVocabDb({ words: (w) => [{ ...w[0]!, category: '植物' }, ...w.slice(1)] }),
    )
    expect(textChanged.version).not.toBe(baseline.version)
    expect(aliasChanged.version).not.toBe(baseline.version)
    expect(categoryChanged.version).not.toBe(baseline.version)
  })
})
