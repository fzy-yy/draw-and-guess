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
  // starting 之后按房间玩法分流：经典进选词，接龙进接龙选词（S22）
  starting: ['waiting', 'choosing_word', 'relay_choose', 'closed'],
  // choosing_word → round_result 表示“画家弃权，本回合作废”后进入（由 abandonChoosing 使用）
  choosing_word: ['drawing', 'closed', 'game_result', 'round_result'],
  drawing: ['round_result', 'closed', 'game_result'],
  round_result: ['choosing_word', 'game_result', 'closed'],
  /**
   * 接龙四步链（S22 / S23）：
   * `starting → relay_choose → relay_draw(步1) → relay_guess(步2) → relay_draw(步3) → relay_guess(步4)
   *  → relay_showcase ⇄ relay_vote → game_result → waiting`。
   * 接龙的 `relay_draw` 与 `relay_guess` 各出现两次，步骤号属接龙局状态（不在这里表达）。
   * 对局期（choose/draw/guess）房主可提前结束进 `game_result`（S34 / S38）；
   * 展示期（showcase/vote）禁止提前结束，故没有 `relay_showcase → game_result` 这条边（S12）。
   * `paused` 在接龙全链不可达（接龙禁用暂停，S19）。
   */
  relay_choose: ['relay_draw', 'game_result', 'closed'],
  // 步 1 与步 3 共用 `relay_draw` 这个阶段名（步骤号属接龙局状态），四步链严格递进
  //（draw → guess → draw → guess）：任何阶段都不会写回自己，因此这里没有任何自环边。
  relay_draw: ['relay_guess', 'game_result', 'closed'],
  relay_guess: ['relay_draw', 'relay_showcase', 'game_result', 'closed'],
  relay_showcase: ['relay_vote', 'closed'],
  relay_vote: ['relay_showcase', 'game_result', 'closed'],
  game_result: ['waiting', 'closed'],
  closed: [],
}

/** 状态转换显式白名单；非法转换必须由调用方拒绝并记录。 */
export function canTransition(from: RoomPhase, to: RoomPhase): boolean {
  return LEGAL_PHASES[from].includes(to)
}

/**
 * 计算两个字符串基于 Unicode 码点（或字符）的 Levenshtein 编辑距离。
 * 使用空间优化的单行/双行动态规划，时间复杂度 O(M*N)，空间复杂度 O(min(M, N))。
 */
export function levenshteinDistance(a: string, b: string): number {
  const charsA = Array.from(a)
  const charsB = Array.from(b)
  const lenA = charsA.length
  const lenB = charsB.length

  if (lenA === 0) return lenB
  if (lenB === 0) return lenA

  // 保证 dp 数组长度为较短的串，节省内存分配
  if (lenA < lenB) {
    return levenshteinDistance(b, a)
  }

  let previousRow = Array.from({ length: lenB + 1 }, (_, index) => index)
  let currentRow = new Array<number>(lenB + 1)

  for (let i = 1; i <= lenA; i++) {
    currentRow[0] = i
    const charA = charsA[i - 1]

    for (let j = 1; j <= lenB; j++) {
      const charB = charsB[j - 1]
      const cost = charA === charB ? 0 : 1
      const deleteCost = (previousRow[j] ?? 0) + 1
      const insertCost = (currentRow[j - 1] ?? 0) + 1
      const replaceCost = (previousRow[j - 1] ?? 0) + cost
      currentRow[j] = Math.min(deleteCost, insertCost, replaceCost)
    }

    const temp = previousRow
    previousRow = currentRow
    currentRow = temp
  }

  return previousRow[lenB] ?? 0
}

/**
 * 判定猜词是否与正确答案「仅差一个字」（差一字私密提示）。
 * 规则：
 * 1. 规范化后的答案字数必须 >= 2，单字词恒返回 false（避免盲猜无成本套出线索）；
 * 2. 规范化后的猜词与规范化后的答案之间的 Levenshtein 编辑距离严格等于 1。
 */
export function isNearMissAnswer(guess: string, answer: string): boolean {
  const normalizedGuess = normalizeAnswer(guess)
  const normalizedAnswer = normalizeAnswer(answer)
  const answerLength = Array.from(normalizedAnswer).length

  // 单字词答案不触发差一字提示
  if (answerLength < 2) {
    return false
  }

  return levenshteinDistance(normalizedGuess, normalizedAnswer) === 1
}
