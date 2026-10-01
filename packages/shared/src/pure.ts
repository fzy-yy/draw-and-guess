/**
 * 共享领域纯函数：答案规范化、遮罩生成、计分与状态机转换表。
 * 无任何运行时依赖，可在 Node 与浏览器中直接单测。
 */
import type { RoomPhase } from './types/index.ts'

/**
 * 规范化画板颜色为大写 HEX。
 * 格式合法性由协议 Schema（同一条 colorPattern）在统一请求绑定层裁决，
 * 本函数只承担「规范化」这一职责，不再重复校验——校验点保持单一。
 */
export function normalizeHexColor(value: string): string {
  return value.toUpperCase()
}

/** 标准化猜词；Unicode NFKC 可合并全角拉丁字符，中文词面不会被破坏。
 * 统一用 toLowerCase()（确定性），避免 toLocaleLowerCase() 随服务器 locale
 * 改变大小写折叠（如土耳其语 I→ı、德语 SS/ß），否则答对判定与昵称去重不可移植。 */
export function normalizeAnswer(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

/** 按用户可见字符（Unicode grapheme cluster）计数，避免 emoji/组合音标被拆成多个字符。 */
export function countGraphemes(value: string): number {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity?: string },
      ) => {
        segment(input: string): Iterable<unknown>
      }
    }
  ).Segmenter
  if (Segmenter)
    return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)).length
  return Array.from(value).length
}

/** 按用户可见字符截断，服务端与客户端的昵称规范化使用同一规则。 */
export function truncateGraphemes(value: string, maxLength: number): string {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity?: string },
      ) => {
        segment(input: string): Iterable<{ segment: string }>
      }
    }
  ).Segmenter
  if (Segmenter) {
    return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(value))
      .slice(0, maxLength)
      .map((part) => part.segment)
      .join('')
  }
  return Array.from(value).slice(0, maxLength).join('')
}

/**
 * 是否为标点或空白字符（按单个 Unicode 码点判断）。
 * 遮罩保留的字符与提示可揭示的字符必须共用这一份分类：三处各写一份正则时，
 * 任何一处漂移都会造成「调度了永远揭示不了的计时器」或「提前泄露答案」。
 */
export function isPunctuationOrSpace(character: string): boolean {
  return /^[\p{P}\p{Z}\s]$/u.test(character)
}

/** 按 Unicode 码点生成遮罩，标点和空白保留，避免中文代理对被拆开。 */
export function createAnswerMask(
  answer: string,
  revealed: ReadonlySet<number> = new Set(),
): string {
  return Array.from(answer)
    .map((character, index) =>
      isPunctuationOrSpace(character) || revealed.has(index) ? character : '＿',
    )
    .join('')
}

/**
 * 猜中得分：只由本回合猜中顺序决定（得分表由调用方注入，见公开配置包的 game.score）。
 * 速度奖、顺序奖与词条权重已随固定 100 分制移除
 *（见 docs/adr/0047-fixed-100-point-scoring.md）。
 *
 * 顺序超出表长时取表内最后一档：最低分仍然给分，避免 6 人局第 6 名得 0
 * 与「猜中就该有分」的玩法口径冲突。
 */
export function guessScoreForOrder(correctOrder: number, orderScores: readonly number[]): number {
  if (orderScores.length === 0) return 0
  const index = Math.max(1, Math.trunc(correctOrder)) - 1
  return orderScores[Math.min(index, orderScores.length - 1)] ?? 0
}

/**
 * 房间阶段合法转换表：每个阶段列出的目标阶段都是显式允许的。
 * 任何未列出的转换都会被服务端拒绝并返回 INVALID_TRANSITION。
 */
const LEGAL_PHASES: Record<RoomPhase, readonly RoomPhase[]> = {
  waiting: ['starting', 'closed'],
  starting: ['waiting', 'choosing_word', 'closed'],
  // choosing_word → round_result 表示“画家弃权，本回合作废”后进入（由 abandonChoosing 使用）
  choosing_word: ['drawing', 'paused', 'closed', 'game_result', 'round_result'],
  drawing: ['round_result', 'paused', 'closed', 'game_result'],
  round_result: ['choosing_word', 'game_result', 'paused', 'closed'],
  paused: ['choosing_word', 'drawing', 'round_result', 'game_result', 'closed'],
  game_result: ['waiting', 'closed'],
  closed: [],
}

/** 状态转换显式白名单；非法转换必须由调用方拒绝并记录。 */
export function canTransition(from: RoomPhase, to: RoomPhase): boolean {
  return LEGAL_PHASES[from].includes(to)
}
