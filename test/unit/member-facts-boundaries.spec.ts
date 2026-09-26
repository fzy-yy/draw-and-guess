import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 成员事实单一口径的防回潮边界。
 *
 * 之所以需要：`!spectating && !leftGame` 这类复合判定曾在 12+ 处各写一遍，
 * 语义漂移（把「可玩」误缩为「未离局」）会静默改变人数与容量口径。
 * 本用例做**窄范围源码扫描**（不解析 AST）：member-facts.ts 之外一旦重新内联
 * 「观战 × 离局」的组合谓词即失败。见 docs/adr/0023-member-facts-single-source.md。
 */
const serverSrcRoot = fileURLToPath(new URL('../../apps/server/src', import.meta.url))

/** 唯一定义处是成员事实模块；models.ts 只在类型里声明这两个字段，不算谓词。 */
const allowlist = new Set(['domain/room/member-facts.ts', 'models.ts'])

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return listTsFiles(fullPath)
    return entry.name.endsWith('.ts') ? [fullPath] : []
  })
}

/** 去掉行注释与块注释，避免文档说明里的举例触发误报。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

// 归一化空白后，复合谓词的两个字段名相距极近；80 字符窗口足以覆盖
// `!member.spectating && !member.leftGame` 及其多行变体，又能避开相邻但独立的单字段守卫。
const compositePredicate = /(spectating[\s\S]{0,80}?leftGame|leftGame[\s\S]{0,80}?spectating)/

// 阶段标称时长的映射（drawing→roundDurationMs、choosing_word→chooseSeconds）也只允许存在于 member-facts。
// 同一窗口内同时出现这两个字段名即视为重新内联了该映射。
const durationMapping =
  /(roundDurationMs[\s\S]{0,120}?chooseSeconds|chooseSeconds[\s\S]{0,120}?roundDurationMs)/

function normalizedSource(file: string): string {
  return stripComments(readFileSync(join(serverSrcRoot, file), 'utf8')).replace(/\s+/g, ' ')
}

function offendersOf(pattern: RegExp): string[] {
  return listTsFiles(serverSrcRoot)
    .map((file) => relative(serverSrcRoot, file).split(sep).join('/'))
    .filter((file) => !allowlist.has(file))
    .filter((file) => pattern.test(normalizedSource(file)))
}

describe('成员事实单一口径边界', () => {
  it('member-facts.ts 之外不得重新内联「观战 × 离局」复合谓词', () => {
    expect(offendersOf(compositePredicate)).toEqual([])
  })

  it('member-facts.ts 之外不得重新内联阶段标称时长映射', () => {
    expect(offendersOf(durationMapping)).toEqual([])
  })
})
