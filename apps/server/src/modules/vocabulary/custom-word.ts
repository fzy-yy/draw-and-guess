/**
 * 画家自定义题目的领域规则（纯函数）。
 *
 * 遵循架构约定：
 * 1. 自定义词归属「自定义」合集，无预设别称与词库元数据；
 * 2. 严格按用户可见字符（grapheme）校验长度；
 * 3. 拒绝控制字符、零宽连接符与 Emoji，保证逐格遮罩与判定算法确定性。
 */
import {
  CUSTOM_WORD_MAX_LENGTH,
  ERROR_CODES,
  countGraphemes,
  isPunctuationOrSpace,
  type VocabularyWord,
} from '@draw-guess/shared'
import { serverErrorMessages } from '@draw-guess/strings'
import { AppError } from '../../core/errors.ts'

/** 自定义词统一合集名称 */
const CUSTOM_WORD_COLLECTION = '自定义'

/** 禁止出现的特殊字符正则（控制字符、格式控制、零宽连接符及 Emoji） */
const FORBIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\u200D\p{Extended_Pictographic}]/u

/**
 * 校验并规范化画家自定义词输入。
 *
 * @param input 原始文本与生成的词条 UUID
 * @returns 构造合法的 VocabularyWord 实例
 */
export function buildCustomWord(input: { rawText: string; wordId: string }): VocabularyWord {
  const text = input.rawText.trim().replace(/\s+/gu, ' ')
  if (!text) {
    throw new AppError({
      message: serverErrorMessages[ERROR_CODES.INVALID_CUSTOM_WORD],
      code: ERROR_CODES.INVALID_CUSTOM_WORD,
      status: 422,
    })
  }

  if (countGraphemes(text) > CUSTOM_WORD_MAX_LENGTH) {
    throw new AppError({
      message: `自定义题目长度不能超过 ${CUSTOM_WORD_MAX_LENGTH} 个字符`,
      code: ERROR_CODES.INVALID_CUSTOM_WORD,
      status: 422,
    })
  }

  if (FORBIDDEN_CHARACTER.test(text)) {
    throw new AppError({
      message: '自定义题目包含不支持的特殊符号或表情',
      code: ERROR_CODES.INVALID_CUSTOM_WORD,
      status: 422,
    })
  }

  const characters = Array.from(text)
  if (characters.every((character) => isPunctuationOrSpace(character))) {
    throw new AppError({
      message: '自定义题目不能全部由标点符号组成',
      code: ERROR_CODES.INVALID_CUSTOM_WORD,
      status: 422,
    })
  }

  return {
    id: input.wordId,
    text,
    aliases: [],
    collection: CUSTOM_WORD_COLLECTION,
  }
}
