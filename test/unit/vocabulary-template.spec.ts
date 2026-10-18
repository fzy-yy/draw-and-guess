/**
 * 词库包与「样板口径」的结构一致性（含玩家自定义词库）。
 *
 * 样板（`vocabulary/templates/example.db`）是玩家自定义词库的起点：扫描目录里任何一份词库只要
 * 结构漂移（多一列、缺 CHECK、text 上多一个 UNIQUE 之类的隐式索引），玩家照着改就会在别处踩坑。
 * 用例以样板为基准，把被跟踪的每一份词库复制到临时目录再打开（不碰仓库资产），断言：
 * metadata/words 的列定义与建表 SQL 逐字一致、表与索引集合一致、integrity_check 通过；
 * 并对玩家词库额外断言「词条一条不少、元数据四项齐全」。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createDatabase, type DatabaseContext } from '../../apps/server/src/db/index.ts'

const root = process.cwd()
const VOCABULARY_DIR = 'vocabulary'
const TEMPLATE_DB = 'vocabulary/templates/example.db'

/** 玩家自定义词库：与基础词库同为「有内容」的包，但由玩家自己填写，必须同样符合样板口径。 */
const PLAYER_DB = 'vocabulary/fzyyy_words.db'

/** 样板 metadata 必须齐全的键（顺序无关；与基础词库口径一致）。 */
const TEMPLATE_META_KEYS = ['author', 'description', 'name', 'remark', 'updated_at', 'version']

let directory = ''

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'draw-guess-vocabulary-schema-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

/** 把仓库里的词库复制到临时目录后再打开，避免用例写坏被跟踪的库文件。 */
function openCopy(relativePath: string): DatabaseContext {
  const target = join(directory, relativePath.replaceAll('/', '_'))
  copyFileSync(resolve(root, relativePath), target)
  return createDatabase(target)
}

/** 列定义元组（名字/类型/非空/默认值/主键位）：CHECK 等约束由建表 SQL 比对覆盖。 */
function columnsOf(context: DatabaseContext, table: string): unknown[] {
  return context.connection
    .prepare('SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?)')
    .all(table)
}

/** 归一化建表 SQL：去掉行注释与空白差异，只留结构与约束本身。 */
function ddlOf(context: DatabaseContext, table: string): string {
  const row = context.connection
    .prepare('SELECT sql FROM sqlite_master WHERE name = ?')
    .get(table) as { sql: string }
  return row.sql
    .replace(/--[^\n]*/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** 表与索引的签名集合：隐式索引（如 text 上的 UNIQUE）同样计入，结构漂移无所遁形。 */
function schemaObjectsOf(context: DatabaseContext): string[] {
  const rows = context.connection
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
    .all() as Array<{ type: string; name: string; sql: string | null }>
  return rows
    .map(
      (row) =>
        `${row.type}:${row.name}:${
          row.sql
            ?.replace(/--[^\n]*/gu, '')
            .replace(/\s+/gu, ' ')
            .trim() ?? ''
        }`,
    )
    .sort()
}

function metaValue(context: DatabaseContext, key: string): string {
  const row = context.connection
    .prepare('SELECT meta_data_value v FROM metadata WHERE meta_data_key = ?')
    .get(key) as { v: string } | undefined
  return row?.v ?? ''
}

/** 断言一份词库的库结构与样板逐项一致。 */
function expectMatchesTemplate(relativePath: string): void {
  const template = openCopy(TEMPLATE_DB)
  const candidate = openCopy(relativePath)
  try {
    expect(columnsOf(candidate, 'words')).toEqual(columnsOf(template, 'words'))
    expect(columnsOf(candidate, 'metadata')).toEqual(columnsOf(template, 'metadata'))
    expect(ddlOf(candidate, 'words')).toBe(ddlOf(template, 'words'))
    expect(ddlOf(candidate, 'metadata')).toBe(ddlOf(template, 'metadata'))
    expect(schemaObjectsOf(candidate)).toEqual(schemaObjectsOf(template))
    expect(candidate.connection.pragma('integrity_check', { simple: true })).toBe('ok')
  } finally {
    template.close()
    candidate.close()
  }
}

describe('词库包符合样板口径', () => {
  it('扫描目录下的每一份词库都与样板结构一致（含基础词库与玩家词库）', () => {
    const tracked = readdirSync(resolve(root, VOCABULARY_DIR))
      .filter((file) => file.endsWith('.db'))
      .map((file) => `${VOCABULARY_DIR}/${file}`)
      .sort()
    // 至少要覆盖基础词库与玩家词库：扫描目录只剩一份时，本用例就等于没在守新增包。
    expect(tracked).toEqual(expect.arrayContaining([`${VOCABULARY_DIR}/base_words.db`, PLAYER_DB]))
    for (const relativePath of tracked) expectMatchesTemplate(relativePath)
  })

  it('玩家词库保留全部词条，且 metadata 四项（name/description/version/updated_at）齐全', () => {
    const template = openCopy(TEMPLATE_DB)
    const player = openCopy(PLAYER_DB)
    try {
      const templateKeys = (
        template.connection
          .prepare('SELECT meta_data_key k FROM metadata ORDER BY meta_data_key')
          .all() as Array<{ k: string }>
      ).map((row) => row.k)
      expect(templateKeys).toEqual(TEMPLATE_META_KEYS)

      const playerKeys = (
        player.connection
          .prepare('SELECT meta_data_key k FROM metadata ORDER BY meta_data_key')
          .all() as Array<{ k: string }>
      ).map((row) => row.k)
      expect(playerKeys).toEqual(TEMPLATE_META_KEYS)
      for (const key of ['name', 'description', 'version', 'updated_at']) {
        expect(metaValue(player, key).trim(), `metadata.${key} 不能为空`).not.toBe('')
      }

      // 词条一条不少：928 条（迁移前后逐条比对过 id/text/collection/aliases）。
      expect(player.connection.prepare('SELECT count(*) c FROM words').get()).toEqual({ c: 928 })
      expect(
        player.connection
          .prepare(
            "SELECT count(*) c FROM words WHERE text IS NULL OR text = '' OR collection IS NULL OR collection = ''",
          )
          .get(),
      ).toEqual({ c: 0 })
      expect(
        player.connection
          .prepare('SELECT count(*) c FROM words WHERE json_valid(aliases) = 0')
          .get(),
      ).toEqual({ c: 0 })
    } finally {
      template.close()
      player.close()
    }
  })
})
