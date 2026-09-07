/**
 * 音效与背景音乐的音量计算纯函数。
 * 无环境依赖，可在 Node/浏览器直接单测。
 */
export interface AudioSettingsState {
  readonly masterVolume: number
  readonly soundVolume: number
  readonly musicVolume: number
  readonly muted: boolean
}

/**
 * 折算最终有效播放音量（0~1）。
 * 若用户开启静音，返回 0；否则综合 主音量 * 对应总线音量 * 音效特定微调倍率 * 单次缩放。
 */
export function calculateEffectiveVolume(
  settings: AudioSettingsState,
  channel: 'sfx' | 'bgm',
  volumeMultiplier = 1.0,
  volumeScale = 1.0,
): number {
  if (settings.muted) return 0
  const channelVolume = channel === 'sfx' ? settings.soundVolume : settings.musicVolume
  const raw = settings.masterVolume * channelVolume * volumeMultiplier * volumeScale
  return Math.max(0, Math.min(1, raw))
}
