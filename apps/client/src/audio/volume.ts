/**
 * 短音效的音量计算纯函数。
 * 无环境依赖，可在 Node/浏览器直接单测。
 * （背景音乐通道已随 BGM 系统移除，只剩「主音量 × 音效总线音量」一条折算链。）
 */
export interface AudioSettingsState {
  readonly masterVolume: number
  readonly soundVolume: number
  readonly muted: boolean
}

/**
 * 折算最终有效播放音量（0~1）。
 * 若用户开启静音，返回 0；否则综合 主音量 * 音效总线音量 * 音效特定微调倍率。
 */
export function calculateEffectiveVolume(
  settings: AudioSettingsState,
  volumeMultiplier = 1.0,
): number {
  if (settings.muted) return 0
  const raw = settings.masterVolume * settings.soundVolume * volumeMultiplier
  return Math.max(0, Math.min(1, raw))
}
