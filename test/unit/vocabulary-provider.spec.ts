/**
 * SQLite 词库 Provider 专项单测（词库重建适配后新增）。
 *
 * 覆盖点：
 * 1. 正常加载：level_config 按难度派生 timeLimit/scoreWeight、hint trim、enabled 过滤、meta 透传与版本哈希；
 * 2. 严格校验（异常数据必须以中文 Error 阻止加载，绝不带病运行）：
 *    level_config 缺失/缺级/多余键/条目非法、difficulty_enum/drawability_enum/category_enum 缺失、
 *    分类越界、可绘制性越界、提示超长、别称超数、词面重复；
 * 3. 内容哈希对 hint/drawability 变化的敏感性。
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

/** 测试词条输入：与 words 表列一致（均可显式指定，便于构造异常数据）。 */
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

/** 默认合法词条：6 条启用 + 1 条下架（minWords=6 恰好通过）。 */
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
      text: '下架词',
      category: '动物',
      difficulty: 1,
      drawability: 1,
      enabled: 0,
      aliases: [],
      hint: '不应加载',
    },
  ]
}

/** 默认合法 level_config：难度 1~5 各有时限与权重（与时序无关的固定值）。 */
function defaultLevelConfig(): Record<string, { time_limit: number; score_weight: number }> {
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

/** 在临时目录生成一份词库库文件并返回其绝对路径。 */
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
    const levelConfig = defaultLevelConfig()
    const meta: Record<string, string> = {
      name: '测试词库',
      description: 'Provider 单测词库',
      version: '1.0.0',
      updated_at: '2026-09-23',
      category_enum: JSON.stringify(['动物', '植物', '自然', '电器']),
      difficulty_enum: JSON.stringify([1, 2, 3, 4, 5]),
      drawability_enum: JSON.stringify([1, 2, 3, 4, 5]),
      enabled_enum: JSON.stringify([0, 1]),
      level_config: JSON.stringify(levelConfig),
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

describe('SqliteProvider 正常加载（词库重建版）', () => {
  it('按难度从 level_config 派生时限与权重，透传枚举与提示，并过滤 enabled=0', async () => {
    const loaded = await load(createVocabDb())
    // 6 条启用词（第 7 条 enabled=0 不进候选池）
    expect(loaded.words).toHaveLength(6)
    expect(loaded.words.map((word) => word.id)).toEqual([
      'sqlite:1',
      'sqlite:2',
      'sqlite:3',
      'sqlite:4',
      'sqlite:5',
      'sqlite:6',
    ])
    const cat = loaded.words[0]!
    const river = loaded.words.find((word) => word.text === '河流')!
    // 难度 1 → 45s/权重 5；难度 5 → 90s/权重 9（加载期解析，逐词不再携带原始列）
    expect({ timeLimit: cat.timeLimit, scoreWeight: cat.scoreWeight }).toEqual({
      timeLimit: 45,
      scoreWeight: 5,
    })
    expect({ timeLimit: river.timeLimit, scoreWeight: river.scoreWeight }).toEqual({
      timeLimit: 90,
      scoreWeight: 9,
    })
    // hint/drawability 透传；hint 两端空白被收紧
    expect(cat.hint).toBe('喵喵叫的宠物')
    expect(cat.drawability).toBe(1)
    // 版本号为 12 位 hex 内容哈希
    expect(loaded.version).toMatch(/^[0-9a-f]{12}$/)
  })

  it('meta 透传 level_config、difficulty_enum 与 drawability_enum 供下游与排障使用', async () => {
    const loaded = await load(createVocabDb())
    expect(loaded.meta.sourceId).toBe('sqlite')
    expect(loaded.meta.name).toBe('测试词库')
    expect(loaded.meta.fileVersion).toBe('1.0.0')
    expect(loaded.meta.categoryEnum).toEqual(['动物', '植物', '自然', '电器'])
    expect(loaded.meta.difficultyEnum).toEqual([1, 2, 3, 4, 5])
    expect(loaded.meta.drawabilityEnum).toEqual([1, 2, 3, 4, 5])
    expect(loaded.meta.levelConfig[2]).toEqual({ timeLimit: 60, scoreWeight: 6 })
    expect(loaded.meta.wordCount).toBe(6)
  })

  it('trim 词条与别称两端空白', async () => {
    const loaded = await load(
      createVocabDb({
        words: (words) => {
          const first = words[0]!
          return [
            { ...first, hint: '  喵喵叫的宠物  ', aliases: [' 小猫 ', '喵星人'] },
            ...words.slice(1),
          ]
        },
      }),
    )
    expect(loaded.words[0]!.hint).toBe('喵喵叫的宠物')
    expect(loaded.words[0]!.aliases).toEqual(['小猫', '喵星人'])
  })
})

describe('SqliteProvider 严格校验（异常数据阻止加载）', () => {
  /** 用「覆盖第 1 条词条」的便捷构造生成异常库文件。 */
  function withFirstWord(patch: Partial<WordInput>): FixtureOptions {
    return { words: (words) => [{ ...words[0]!, ...patch }, ...words.slice(1)] }
  }

  it('缺少 level_config → 中文错误', async () => {
    await expect(load(createVocabDb({ removeMeta: ['level_config'] }))).rejects.toThrow(
      /level_config/,
    )
  })

  it('level_config 缺少某个难度级 → 指明缺失的难度', async () => {
    const partial = { ...defaultLevelConfig() }
    delete partial['5']
    await expect(
      load(createVocabDb({ meta: { level_config: JSON.stringify(partial) } })),
    ).rejects.toThrow(/缺少难度「5」/)
  })

  it('level_config 存在 difficulty_enum 之外的多余键 → 拒绝', async () => {
    await expect(
      load(
        createVocabDb({
          meta: {
            level_config: JSON.stringify({
              ...defaultLevelConfig(),
              '9': { time_limit: 45, score_weight: 5 },
            }),
          },
        }),
      ),
    ).rejects.toThrow(/difficulty_enum 内的难度键「9」/)
  })

  it('level_config 非法 JSON → 拒绝', async () => {
    await expect(load(createVocabDb({ meta: { level_config: '{bad' } }))).rejects.toThrow(
      /不是合法 JSON/,
    )
  })

  it('level_config 时限非正整数 → 拒绝', async () => {
    await expect(
      load(
        createVocabDb({
          meta: {
            level_config: JSON.stringify({
              ...defaultLevelConfig(),
              '1': { time_limit: 0, score_weight: 5 },
            }),
          },
        }),
      ),
    ).rejects.toThrow(/time_limit 需为正整数秒/)
  })

  it('缺少 difficulty_enum / drawability_enum → 拒绝', async () => {
    await expect(load(createVocabDb({ removeMeta: ['difficulty_enum'] }))).rejects.toThrow(
      /difficulty_enum/,
    )
    await expect(load(createVocabDb({ removeMeta: ['drawability_enum'] }))).rejects.toThrow(
      /drawability_enum/,
    )
  })

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

  it('难度越出配置区间 → 拒绝', async () => {
    await expect(load(createVocabDb(withFirstWord({ difficulty: 9 })))).rejects.toThrow(
      /不在合法区间/,
    )
  })

  it('难度在配置区间内但越出 difficulty_enum → 拒绝（level_config 需同步收窄）', async () => {
    const narrowed = { ...defaultLevelConfig() }
    delete narrowed['5']
    await expect(
      load(
        createVocabDb({
          meta: {
            difficulty_enum: JSON.stringify([1, 2, 3, 4]),
            level_config: JSON.stringify(narrowed),
          },
          words: (words) =>
            [{ ...words[0]!, difficulty: 4 }, ...words.slice(1)].map((word) =>
              word.text === '河流' ? { ...word, difficulty: 5 } : word,
            ),
        }),
      ),
    ).rejects.toThrow(/不在 difficulty_enum 白名单内/)
  })

  it('可绘制性越出 drawability_enum → 拒绝', async () => {
    await expect(load(createVocabDb(withFirstWord({ drawability: 7 })))).rejects.toThrow(
      /不在 drawability_enum 白名单内/,
    )
  })

  it('提示超过长度上限 → 拒绝', async () => {
    await expect(
      load(createVocabDb(withFirstWord({ hint: '这条提示实在是太长了超过了十字上限' }))),
    ).rejects.toThrow(/提示.*长度.*超过上限/)
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

  it('启用词数不足 minWords → 拒绝', async () => {
    await expect(load(createVocabDb({ words: (words) => words.slice(0, 5) }))).rejects.toThrow(
      /有效词条仅 5 个，至少需要 6 个/,
    )
  })
})

describe('内容哈希敏感性', () => {
  it('hint 或 drawability 变化都会产生新版本号（全部玩法字段进哈希）', async () => {
    const baseline = await load(createVocabDb())
    const hintChanged = await load(
      createVocabDb({ words: (w) => [{ ...w[0]!, hint: '换了说法的提示' }, ...w.slice(1)] }),
    )
    const drawabilityChanged = await load(
      createVocabDb({ words: (w) => [{ ...w[0]!, drawability: 5 }, ...w.slice(1)] }),
    )
    expect(hintChanged.version).not.toBe(baseline.version)
    expect(drawabilityChanged.version).not.toBe(baseline.version)
  })
})
