/**
 * 类名合并工具（cn）。
 *
 * 组合 clsx 与 tailwind-merge：
 * - clsx 负责拼接：支持字符串、条件表达式、对象形式，统一简洁；
 * - tailwind-merge 负责去重冲突类（如 bg-white 与 bg-blue 并存时保留靠后者），
 *   避免多个可切换类串在一起产生互相覆盖的残留。
 *
 * 本项目使用 Tailwind v4 并在 @theme 中自定义了语义色令牌（navy/blue/sky/yellow/...），
 * 这些自定义颜色不在 tailwind-merge 的默认类名推断表内，
 * 若不加声明会被当作“普通未知类”而在冲突合并时误删。
 * 因此这里用 extendTailwindMerge 把全部自定义语义色注册进颜色合并组，
 * 保证 bg-navy/bg-blue、text-muted/text-ink、border-line/border-slate-400 等正确参与合并判断。
 */
import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** 项目自定义语义色令牌（与 apps/client/src/style/index.css 的 @theme 保持一致）。 */
const CUSTOM_COLORS = [
  'navy',
  'blue',
  'sky',
  'yellow',
  'orange',
  'green',
  'red',
  'ink',
  'muted',
  'paper',
  'line',
] as const

/**
 * 扩展后的 twMerge：把自定义语义色并入 color 冲突组。
 * 这样 bg-navy 与 bg-blue、text-muted 与 text-ink、border-line 与 border-slate-400
 * 等同类（背景/文字/边框颜色）才能正确参与“保留靠后者”的冲突消解。
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: CUSTOM_COLORS,
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
