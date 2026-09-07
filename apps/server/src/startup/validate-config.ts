import { z } from 'zod'
import { APP_CONFIG } from '../../../../config/index.ts'

/** 启动前校验关键业务配置与跨字段关系。 */
export function validateBusinessConfig(): void {
  z.object({
    player: z.object({ minPlayers: z.number().int().min(2), maxPlayers: z.number().int().max(6) }),
    game: z.object({
      roundsPerPlayer: z.object({
        min: z.number().int().positive(),
        max: z.number().int().positive(),
        default: z.number().int().positive(),
      }),
      drawSeconds: z.object({
        min: z.number().int().positive(),
        max: z.number().int().positive(),
        default: z.number().int().positive(),
      }),
      chooseSeconds: z.object({
        min: z.number().int().positive(),
        max: z.number().int().positive(),
        default: z.number().int().positive(),
      }),
    }),
    drawing: z.object({
      colors: z.array(z.string().regex(new RegExp(APP_CONFIG.drawing.colorPattern))).min(2),
      width: z.object({
        min: z.number().positive(),
        max: z.number().positive(),
        default: z.number().positive(),
        step: z.number().positive(),
        wheelStep: z.number().positive(),
      }),
      fillTolerance: z.number().int().min(0).max(255),
    }),
    vocabulary: z.object({
      minWords: z.number().int().min(1),
      maxWordLength: z.number().int().min(1),
      maxAliasesPerWord: z.number().int().min(1),
      difficultyRange: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }),
    }),
  }).parse(APP_CONFIG)
  if (APP_CONFIG.player.minPlayers > APP_CONFIG.player.maxPlayers)
    throw new Error('玩家最小人数不能大于最大人数')
  if (APP_CONFIG.vocabulary.difficultyRange.min > APP_CONFIG.vocabulary.difficultyRange.max)
    throw new Error('词库难度下限不能大于上限')
  if (APP_CONFIG.vocabulary.minWords > APP_CONFIG.vocabulary.maxWords)
    throw new Error('词库最小词条数不能大于最大词条数')
}
