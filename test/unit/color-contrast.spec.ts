import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type Rgb = readonly [number, number, number]

const tokensSource = readFileSync(
  fileURLToPath(new URL('../../apps/client/src/style/tokens.css', import.meta.url)),
  'utf8',
)

function token(name: string): string {
  const value = tokensSource.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'iu'))?.[1]
  if (!value) throw new Error(`缺少颜色令牌：${name}`)
  return value
}

function rgb(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = rgb(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as unknown as Rgb
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  )
}

function composite(foreground: string, opacity: number, background: string): string {
  const result = rgb(foreground).map((channel, index) => {
    const backgroundChannel = rgb(background)[index] ?? 0
    return Math.round(channel * opacity + backgroundChannel * (1 - opacity))
  })
  return `#${result.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

const white = '#ffffff'

describe('WCAG AA 颜色对比契约', () => {
  it.each([
    ['muted/white', token('muted'), white],
    ['muted/paper', token('muted'), token('paper')],
    ['muted/sky', token('muted'), token('sky')],
    ['muted/line', token('muted'), token('line')],
    ['blue/sky', token('blue'), token('sky')],
    ['success/white', token('success-fg'), white],
    ['success/paper', token('success-fg'), token('paper')],
    ['success/line', token('success-fg'), token('line')],
    ['warning/white', token('warning-fg'), white],
    ['warning/paper', token('warning-fg'), token('paper')],
    ['navy/yellow', token('navy'), token('yellow')],
    ['white/blue', white, token('blue')],
    ['white/red', white, token('red')],
    ['white/success', white, token('success-fg')],
  ])('%s 普通文字至少达到 4.5:1', (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['control/white', token('control'), white],
    ['control/paper', token('control'), token('paper')],
    ['control/sky', token('control'), token('sky')],
    ['control/line', token('control'), token('line')],
    ['focus/white', token('focus'), white],
    ['focus/paper', token('focus'), token('paper')],
    ['focus/sky', token('focus'), token('sky')],
    ['focus/navy', token('focus'), token('navy')],
    ['yellow icon/blue', token('yellow'), token('blue')],
    [
      'warning icon/yellow tint',
      token('warning-fg'),
      composite(token('yellow'), 0.25, token('paper')),
    ],
  ])('%s 非文字图形或控件边界至少达到 3:1', (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3)
  })

  it.each([
    ['success on dark', token('success-on-dark'), composite(token('green'), 0.15, token('navy'))],
    ['warning on dark', token('yellow'), composite(token('yellow'), 0.15, token('navy'))],
    ['danger on dark', token('danger-on-dark'), composite(token('red'), 0.15, token('navy'))],
    ['sky on dark', token('sky'), composite(white, 0.1, token('navy'))],
  ])('%s 状态文字在深色顶栏至少达到 4.5:1', (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })
})
