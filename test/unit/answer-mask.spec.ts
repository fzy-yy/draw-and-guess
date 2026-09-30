import { describe, expect, it } from 'vitest'
import { createAnswerMask, isPunctuationOrSpace } from '@draw-guess/shared'

/**
 * 答案遮罩与提示揭示共用同一字符分类（isPunctuationOrSpace）：
 * 遮罩保留标点/空白、逐步提示只揭示非标点字符。两处若各自内联正则并漂移，
 * 会出现「调度了永远揭示不了的计时器」或「提前泄露答案」，因此分类本身与遮罩输出一起锁定。
 */
describe('标点/空白分类与答案遮罩', () => {
  it('中英文标点、半角/全角空白与换行判为真，文字与数字判为假', () => {
    expect(isPunctuationOrSpace('，')).toBe(true)
    expect(isPunctuationOrSpace('.')).toBe(true)
    expect(isPunctuationOrSpace(' ')).toBe(true)
    expect(isPunctuationOrSpace('　')).toBe(true) // 全角空格（Unicode Z 类）
    expect(isPunctuationOrSpace('\n')).toBe(true)
    expect(isPunctuationOrSpace('猫')).toBe(false)
    expect(isPunctuationOrSpace('A')).toBe(false)
    expect(isPunctuationOrSpace('7')).toBe(false)
  })

  it('遮罩按 Unicode 码点保留标点/空白与显式揭示的下标，其余替换为全角下划线', () => {
    expect(createAnswerMask('猫，狗')).toBe('＿，＿')
    expect(createAnswerMask('猫，狗', new Set([0]))).toBe('猫，＿')
    expect(createAnswerMask('猫，狗', new Set([0, 1, 2]))).toBe('猫，狗')
    // emoji 等代理对按一个码点处理，不会被拆成两个遮罩字符
    expect(createAnswerMask('🐱')).toBe('＿')
  })
})
