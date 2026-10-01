import { APP_CONFIG } from '../config/index.ts'

/** 启动期配置断言：失败信息带明确成因，直接终止启动（fail-fast，见 ADR-0035）。 */
function requireConfig(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

/** 区间与默认值关系：default 必须落在 [min, max] 内，否则界面滑块与开局校验会自相矛盾。 */
function requireDefaultInRange(
  name: string,
  range: { min: number; max: number; default: number },
): void {
  requireConfig(
    range.min <= range.default && range.default <= range.max,
    `${name} 默认值必须落在 min～max 区间内`,
  )
}

/**
 * 启动前校验关键业务配置的跨字段关系。
 *
 * 不做字段存在性与基本类型的复核：APP_CONFIG 是 `as const` 的编译期常量，类型系统已保证
 * 字段形状（Zod 复核只会与类型约束双养）；这里只校验类型表达不了的约束——区间与默认值
 * 的关系、字符串格式、值域。参数化默认值便于测试注入非法配置验证失败路径。
 */
export function validateBusinessConfig(config: typeof APP_CONFIG = APP_CONFIG): void {
  const { player, game, drawing, vocabulary } = config
  requireConfig(player.minPlayers <= player.maxPlayers, '玩家最小人数不能大于最大人数')
  requireDefaultInRange('每人轮数', game.roundsPerPlayer)
  requireConfig(
    game.drawSeconds.options.includes(game.drawSeconds.default),
    '单回合时长默认值必须落在合法档位内',
  )
  requireDefaultInRange('选词秒数', game.chooseSeconds)
  requireDefaultInRange('画笔宽度', drawing.width)
  requireConfig(
    Number.isInteger(drawing.fillTolerance) &&
      drawing.fillTolerance >= 0 &&
      drawing.fillTolerance <= 255,
    '填充容差必须是 0～255 的整数',
  )
  const colorPattern = new RegExp(drawing.colorPattern)
  for (const color of drawing.colors) {
    requireConfig(colorPattern.test(color), `画板颜色必须是 ${drawing.colorPattern} 格式：${color}`)
  }
  requireConfig(
    vocabulary.difficultyRange.min <= vocabulary.difficultyRange.max,
    '词库难度下限不能大于上限',
  )
  requireConfig(vocabulary.minWords <= vocabulary.maxWords, '词库最小词条数不能大于最大词条数')
}
