import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * 文案分层护栏（见 CONTEXT.md）。
 *
 * 契约：无障碍绑定（aria-* 家族、图标按钮的 label、原生元素的 title）引用的文案
 * 必须来自 `strings.a11y.*`，不得指向 `strings.ui.*`；`strings.ui.*` 只用于可见处。
 *
 * 这是整层契约的最高接缝：扫描源码里的绑定，不逐个组件断言，新增文案放错类别即失败。
 */
const clientSrc = join(process.cwd(), 'apps/client/src')

/** 图标按钮/头像等「label 即无障碍名」的组件（label prop 落到 aria-label 或悬浮提示）。 */
const LABEL_IS_ARIA_COMPONENTS = new Set([
  'AvatarImage',
  'HostCrownBadge',
  'IconButton',
  'RoundIconButton',
  'SquareIconButton',
  'BaseIconButton',
  'ColorSwatchButton',
])

/** 始终承载无障碍名的属性。 */
const ARIA_ATTRS = [
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'panel-aria-label',
  'close-aria',
  'trigger-aria',
  'trigger-label',
  'select-all-aria',
  'row-aria',
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

/** 取属性所在的起始标签名；属性不在标签内（已越过 `>`）时返回 null。 */
function owningTag(content: string, index: number): string | null {
  const lt = content.lastIndexOf('<', index)
  if (lt === -1) return null
  if (content.slice(lt, index).includes('>')) return null
  const matched = content.slice(lt).match(/^<([A-Za-z][A-Za-z0-9-]*)/)
  return matched ? matched[1]! : null
}

/** 是否原生 HTML 元素（小写开头，含自定义元素连字符）。 */
function isNativeTag(tag: string): boolean {
  return /^[a-z]/.test(tag)
}

interface Violation {
  file: string
  line: number
  attr: string
  path: string
}

function collect(): Violation[] {
  const violations: Violation[] = []
  for (const file of walk(clientSrc)) {
    const content = readFileSync(file, 'utf8')
    const check = (attr: string, value: string, offset: number) => {
      for (const match of value.matchAll(/strings\.([A-Za-z0-9_]+)/g)) {
        const path = match[1]!
        if (path !== 'a11y') {
          const line = content.slice(0, offset + match.index).split('\n').length
          violations.push({ file: relative(process.cwd(), file), line, attr, path })
        }
      }
    }

    // aria 家族属性：无论元素是原生还是组件，都属无障碍。
    for (const attr of ARIA_ATTRS) {
      const re = new RegExp(`:?${attr}="([^"]*)"`, 'g')
      for (const m of content.matchAll(re)) check(attr, m[1]!, m.index)
    }

    // 图标组件上的 label：label 落到 aria-label。
    const labelRe = /:?label="([^"]*)"/g
    for (const m of content.matchAll(labelRe)) {
      const tag = owningTag(content, m.index)
      if (tag && LABEL_IS_ARIA_COMPONENTS.has(tag)) check('label', m[1]!, m.index)
    }

    // 原生元素上的 title：悬浮提示，属无障碍；组件 title prop（PascalCase）是可见标题，跳过。
    const titleRe = /:?title="([^"]*)"/g
    for (const m of content.matchAll(titleRe)) {
      const tag = owningTag(content, m.index)
      if (tag && isNativeTag(tag)) check('title', m[1]!, m.index)
    }
  }
  return violations
}

describe('文案分层护栏', () => {
  it('无障碍绑定只引用 strings.a11y.*，不引用 strings.ui.*', () => {
    const violations = collect()
    const message = violations
      .map((v) => `${v.file}:${v.line} [${v.attr}] 指向 strings.${v.path}.*`)
      .join('\n')
    expect(violations, `以下无障碍绑定指向了可见文案：\n${message}`).toEqual([])
  })
})
