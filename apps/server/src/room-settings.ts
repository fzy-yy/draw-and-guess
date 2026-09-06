import { APP_CONFIG } from '../../../config/index.ts'
import type { RoomSettings } from '@draw-guess/shared'
import { serverStrings } from '../../../string/index.ts'
import { GameError } from './errors.ts'

/** 房间规则边界的单一领域校验，供建房与修改规则共同使用。 */
export function validateRoomSettings(settings: RoomSettings): void {
  const { hintStartRatioRange, score } = APP_CONFIG.game
  const valid =
    Number.isInteger(settings.maxPlayers) &&
    settings.maxPlayers >= APP_CONFIG.player.minPlayers &&
    settings.maxPlayers <= APP_CONFIG.player.maxPlayers &&
    settings.roundsPerPlayer >= APP_CONFIG.game.roundsPerPlayer.min &&
    settings.roundsPerPlayer <= APP_CONFIG.game.roundsPerPlayer.max &&
    settings.drawSeconds >= APP_CONFIG.game.drawSeconds.min &&
    settings.drawSeconds <= APP_CONFIG.game.drawSeconds.max &&
    settings.chooseSeconds >= APP_CONFIG.game.chooseSeconds.min &&
    settings.chooseSeconds <= APP_CONFIG.game.chooseSeconds.max &&
    settings.optionCount >= APP_CONFIG.game.optionCount.min &&
    settings.optionCount <= APP_CONFIG.game.optionCount.max &&
    settings.hintStartRatio >= hintStartRatioRange.min &&
    settings.hintStartRatio <= hintStartRatioRange.max &&
    Number.isInteger(settings.guessBaseScore) &&
    settings.guessBaseScore >= score.guessBaseRange.min &&
    settings.guessBaseScore <= score.guessBaseRange.max &&
    typeof settings.allowWordReroll === 'boolean' &&
    (settings.scoreMode === 'standard' || settings.scoreMode === 'flat')
  if (!valid) throw new GameError('INVALID_SETTINGS', serverStrings.errors.INVALID_SETTINGS)
}
