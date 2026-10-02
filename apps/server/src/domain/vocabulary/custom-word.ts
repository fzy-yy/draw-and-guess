/**
 * 画家自定义题目的领域规则（纯函数，可独立单测）。
 *
 * 自定义词是「没有词库元数据的词条」：它没有难度/可绘制性/别称，时长取房间单回合时长，
 * 遮罩与计分与词库词完全同构（见 docs/adr/0045-custom-word-and-untimed-choosing.md）。
 */
import {
  CUSTOM_WORD_MAX_LENGTH,
  countGraphemes,
  isPunctuationOrSpace,
  type VocabularyWord,
} from '@draw-guess/shared'
import { serverStrings } from '@draw-guess/strings'
import { GameError } from '../../errors.ts'

/** 自定义词在候选池里的分类标记：不参与词库分类白名单，只为统一候选对象形状。 */
const CUSTOM_WORD_CATEGORY = '自定义'

/**
 * 禁止出现的字符：控制字符、格式字符（含零宽连接符）与 emoji。
 * 逐字遮罩按字符逐格揭示并「保留末尾非标点字符」，emoji 的 ZWJ 组合序列会被拆成多格，
 * 让猜词者读到无意义的半截序列，因此整类拒绝而不是尝试兼容。
 */
const FORBIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\u200D\p{Extended_Pictographic}]/u

/**
 * 校验并规范化画家自定义词：成功返回可直接进入对局的词条；
 * 任何不合法输入抛 GameError（INVALID_CUSTOM_WORD），具体原因用中文文案回传。
 */
export function buildCustomWord(input: { rawText: string; wordId: string }): VocabularyWord {
  // 折叠空白：内部连续空白压成单个空格、两端裁掉——与猜词比较的 normalizeAnswer 口径一致
  const text = input.rawText.trim().replace(/\s+/gu, ' ')
  if (!text) throw new GameError('INVALID_CUSTOM_WORD', serverStrings.errors.CUSTOM_WORD_EMPTY)
  if (countGraphemes(text) > CUSTOM_WORD_MAX_LENGTH) {
    throw new GameError(
      'INVALID_CUSTOM_WORD',
      serverStrings.errors.CUSTOM_WORD_TOO_LONG(CUSTOM_WORD_MAX_LENGTH),
    )
  }
  if (FORBIDDEN_CHARACTER.test(text)) {
    throw new GameError('INVALID_CUSTOM_WORD', serverStrings.errors.CUSTOM_WORD_INVALID_CHARACTER)
  }
  const characters = Array.from(text)
  if (characters.every((character) => isPunctuationOrSpace(character))) {
    throw new GameError('INVALID_CUSTOM_WORD', serverStrings.errors.CUSTOM_WORD_ONLY_PUNCTUATION)
  }
  return { id: input.wordId, text, aliases: [], category: CUSTOM_WORD_CATEGORY }
}
