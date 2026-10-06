/**
 * 空白词库样板（`vocabulary/templates/example.db`）与基础词库的字段一致性。
 *
 * 样板是玩家自定义词库的起点：字段一旦与基础词库漂移，玩家照着样板填出来的库会在
 * Provider 校验阶段莫名失败。用例把两份库各复制到临时目录再打开（不碰仓库里的词库资产），
 * 断言 words/metadata 列定义、words 建表约束与分类白名单一致，且样板确实是空的。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createDatabase, type DatabaseContext } from '../../apps/server/src/db/index.ts'

const root = process.cwd()
const BASE_DB = 'vocabulary/base_words.db'
const TEMPLATE_DB = 'vocabulary/templates/example.db'

/** 样板 metadata 允许出现的键（与基础词库口径一致：author/description/name/remark/updated_at/version）。 */
const TEMPLATE_META_KEYS = ['author', 'description', 'name', 'remark', 'updated_at', 'version']
let directory = ''

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'draw-guess-template-test-'))
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

function metaValue(context: DatabaseContext, key: string): string {
  const row = context.connection
    .prepare('SELECT meta_data_value v FROM metadata WHERE meta_data_key = ?')
    .get(key) as { v: string } | undefined
  return row?.v ?? ''
}

describe('空白词库样板与基础词库字段一致', () => {
  it('样板文件存在，且 words/metadata 列定义与建表约束和基础词库一致', () => {
    expect(existsSync(resolve(root, BASE_DB)), `缺少基础词库：${BASE_DB}`).toBe(true)
    expect(existsSync(resolve(root, TEMPLATE_DB)), `缺少空白样板：${TEMPLATE_DB}`).toBe(true)

    const base = openCopy(BASE_DB)
    const template = openCopy(TEMPLATE_DB)
    try {
      expect(columnsOf(template, 'words')).toEqual(columnsOf(base, 'words'))
      expect(columnsOf(template, 'metadata')).toEqual(columnsOf(base, 'metadata'))
      expect(ddlOf(template, 'words')).toBe(ddlOf(base, 'words'))
      expect(template.connection.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      base.close()
      template.close()
    }
  })

  it('样板是空库：0 词条，metadata 包含六个键，不强制 category_enum 白名单', () => {
    const base = openCopy(BASE_DB)
    const template = openCopy(TEMPLATE_DB)
    try {
      expect(template.connection.prepare('SELECT count(*) c FROM words').get()).toEqual({ c: 0 })
      const keys = (
        template.connection
          .prepare('SELECT meta_data_key k FROM metadata ORDER BY meta_data_key')
          .all() as Array<{ k: string }>
      ).map((row) => row.k)
      expect(keys).toEqual(TEMPLATE_META_KEYS)
      expect(metaValue(template, 'category_enum')).toBe('')
      expect(metaValue(base, 'category_enum')).toBe('')
    } finally {
      base.close()
      template.close()
    }
  })
})
