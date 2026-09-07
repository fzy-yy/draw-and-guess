import { describe, expect, it } from 'vitest'
import { soundCatalog, audio } from '@draw-guess/config'
import { calculateEffectiveVolume } from '../../apps/client/src/audio/volume.ts'

describe('音效系统配置与声学参数', () => {
  it('包含所有核心交互与对局事件音效配置', () => {
    const requiredSounds = [
      'click',
      'switch',
      'popup',
      'close',
      'ready',
      'invite',
      'start',
      'drawing',
      'correct',
      'tick',
      'round_result',
      'game_result',
      'bgm_lobby',
    ] as const

    for (const key of requiredSounds) {
      expect(soundCatalog).toHaveProperty(key)
      const meta = soundCatalog[key]
      expect(meta.volumeMultiplier).toBeGreaterThan(0)
      expect(meta.volumeMultiplier).toBeLessThanOrEqual(2)
      expect(meta.cooldownMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('音量区间配置合法且包含最小、最大与步进值', () => {
    expect(audio.volumeRange.min).toBe(0)
    expect(audio.volumeRange.max).toBe(1)
    expect(audio.volumeRange.step).toBeGreaterThan(0)
  })

  it('SFX 发音池参数收敛于配置：上限 >= 1 且抢占策略为 round-robin', () => {
    expect(audio.sfxPool.maxInstances).toBeGreaterThanOrEqual(1)
    expect(audio.sfxPool.preemptStrategy).toBe('round-robin')
  })

  it('已彻底移除旧版 Web Audio 振荡器频率与合成增益参数', () => {
    expect(audio).not.toHaveProperty('cues')
    expect(audio).not.toHaveProperty('synthesizedGain')
  })
})

describe('音量折算算法与静音控制', () => {
  const baseSettings = {
    masterVolume: 0.8,
    soundVolume: 0.8,
    musicVolume: 0.5,
    muted: false,
  }

  it('在未静音状态下正确计算主音量与通道音量乘积', () => {
    // 默认配置下 masterVolume=0.8, soundVolume=0.8
    const volume = calculateEffectiveVolume(baseSettings, 'sfx', 1.0, 1.0)
    expect(volume).toBeCloseTo(0.64, 2)

    // 音量缩放测试
    const scaledVolume = calculateEffectiveVolume(baseSettings, 'sfx', 0.5, 1.0)
    expect(scaledVolume).toBeCloseTo(0.32, 2)

    // 背景音乐通道测试
    const musicVol = calculateEffectiveVolume(baseSettings, 'bgm', 1.0, 1.0)
    expect(musicVol).toBeCloseTo(0.4, 2)
  })

  it('在静音开启时无论音量多大均返回 0', () => {
    const mutedSettings = { ...baseSettings, muted: true }
    expect(calculateEffectiveVolume(mutedSettings, 'sfx', 1.0, 1.0)).toBe(0)
    expect(calculateEffectiveVolume(mutedSettings, 'bgm', 1.0, 1.0)).toBe(0)
  })

  it('音量计算严格被截断在 [0, 1] 区间内', () => {
    const overflow = calculateEffectiveVolume(baseSettings, 'sfx', 5.0, 5.0)
    expect(overflow).toBe(1.0)

    const negative = calculateEffectiveVolume(baseSettings, 'sfx', -1.0, 1.0)
    expect(negative).toBe(0.0)
  })
})
