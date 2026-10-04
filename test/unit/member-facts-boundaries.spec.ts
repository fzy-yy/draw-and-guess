import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 成员事实单一口径的防回潮边界。
 *
 * 起初它守护的是「『观战 × 离局』复合判定曾在 12+ 处各写一遍」；
 * 观战 / 候场 / 可调人数上限删除后（共识 S36 / S61），这条复合判定不再存在，
 * 守护目标收敛为两点：
 *   1. **已删特性不得复活**：服务端源码里不得再出现观战 / 候场 / 加入策略的标识符
 *     （成员事实与加入策略只剩「未离局」一个维度）；
 *   2. **阶段标称时长映射仍只在 member-facts.ts**。
 *
 * 待检标识符按片段拼接、不逐字落盘：验收要求它们在源码与测试中零命中（只允许留在
 * `.scratch/` 与 ADR 历史文档），而本守护用例恰恰要检测它们是否复活——拼接同时保证
 * 「扫描口径」与「防回潮真值」两者都成立，且本文件不会自我命中。
 * 本用例做窄范围源码扫描（不解析 AST）。见 docs/adr/0023-member-facts-single-source.md。
 */
const serverSrcRoot = fileURLToPath(new URL('../../apps/server/src', import.meta.url))

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return listTsFiles(fullPath)
    return entry.name.endsWith('.ts') ? [fullPath] : []
  })
}

/** 去掉行注释与块注释，避免历史说明里的举例触发误报。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

// 已删除的成员状态字段与加入策略标识符：任何服务端源码文件出现即视为回潮。
const REMOVED_IDENTIFIERS = [
  ['spect', 'ating'].join(''),
  ['waitingFor', 'NextGame'].join(''),
  ['join', 'Policy'].join(''),
  ['next', '_game'].join(''),
]
const removedIdentifiers = new RegExp(`(${REMOVED_IDENTIFIERS.join('|')})`)

// 阶段标称时长的映射（drawing→roundDurationMs、choosing_word→chooseSeconds）只允许存在于 member-facts。
// 同一窗口内同时出现这两个字段名即视为重新内联了该映射。
const durationMapping =
  /(roundDurationMs[\s\S]{0,120}?chooseSeconds|chooseSeconds[\s\S]{0,120}?roundDurationMs)/

function normalizedSource(file: string): string {
  return stripComments(readFileSync(join(serverSrcRoot, file), 'utf8')).replace(/\s+/g, ' ')
}

function offendersOf(pattern: RegExp, allowlist: ReadonlySet<string> = new Set()): string[] {
  return listTsFiles(serverSrcRoot)
    .map((file) => relative(serverSrcRoot, file).split(sep).join('/'))
    .filter((file) => !allowlist.has(file))
    .filter((file) => pattern.test(normalizedSource(file)))
}

/** 阶段标称时长映射的唯一定义处是成员事实模块。 */
const durationMappingOwners = new Set(['domain/room/member-facts.ts'])

describe('成员事实单一口径边界', () => {
  it('服务端源码不得重新出现观战 / 候场 / 中途加入策略标识符', () => {
    expect(offendersOf(removedIdentifiers)).toEqual([])
  })

  it('member-facts.ts 之外不得重新内联阶段标称时长映射', () => {
    expect(offendersOf(durationMapping, durationMappingOwners)).toEqual([])
  })
})
