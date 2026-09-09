/**
 * 类名合并工具（cn）。
 *
 * 组合 clsx 与 tailwind-merge：
 * - clsx 负责拼接：支持字符串、条件表达式、对象形式，统一简洁；
 * - tailwind-merge 负责去重冲突类（如 bg-white 与 bg-blue 并存时保留靠后者），
 *   避免多个可切换类串在一起产生互相覆盖的残留。
 *
 * 本项目使用 Tailwind v4 并在 @theme 中自定义了语义色令牌（见 apps/client/src/style/index.css
 * 的 @theme 品牌基色与无障碍前景色），
 * 这些自定义颜色不在 tailwind-merge 的默认类名推断表内，
 * 若不加声明会被当作“普通未知类”而在冲突合并时误删。
 * 因此这里用 extendTailwindMerge 把全部自定义语义色注册进颜色合并组，
 * 保证 bg-navy/bg-blue、text-muted/text-navy、border-line/border-blue 等正确参与合并判断。
 */
import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** 项目自定义语义色令牌（与 apps/client/src/style/index.css 的 @theme 保持一致）。 */
const CUSTOM_COLORS = [
  'navy',
  'muted',
  'line',
  'paper',
  'blue',
  'sky',
  'yellow',
  'green',
  'red',
  'purple',
  'success-fg',
  'success-on-dark',
  'warning-fg',
  'danger-on-dark',
  'control',
  'focus',
] as const

/** 项目自定义语义偶数字号标尺（与 style/tokens.css 的 @theme 保持一致）。 */
const CUSTOM_FONT_SIZES = [
  'fs-10',
  'fs-12',
  'fs-14',
  'fs-16',
  'fs-18',
  'fs-20',
  'fs-24',
  'fs-28',
  'fs-36',
  'fs-48',
  'fs-96',
] as const

/**
 * 扩展后的 twMerge：把自定义语义色与偶数字号标尺并入冲突组。
 * 保证 bg-*、text-*（颜色）与 text-fs-*（字号）能正确参与“保留靠后者”的冲突消解。
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: CUSTOM_COLORS,
    },
    classGroups: {
      'font-size': [{ text: CUSTOM_FONT_SIZES }],
    },
  },
})

/**
 * 合并类名：先 clsx 归一化输入，再用扩展过的 twMerge 去除冲突类。
 * @param inputs 任意数量的类名/条件类（ClassValue），透传给 clsx。
 * @returns 合并后的类名字符串。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
