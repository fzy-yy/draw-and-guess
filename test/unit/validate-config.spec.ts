import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { validateBusinessConfig } from '../../apps/server/src/startup/validate-config.ts'

/** 以当前配置为基线克隆一份可变副本；测试故意构造非法配置验证失败路径。 */
function mutableConfig(): Record<string, Record<string, unknown>> {
  return structuredClone(APP_CONFIG) as unknown as Record<string, Record<string, unknown>>
}

describe('启动期业务配置校验', () => {
  it('当前配置通过全部跨字段校验', () => {
    expect(() => validateBusinessConfig()).not.toThrow()
  })

  it('玩家最小人数大于最大人数时中止启动', () => {
    const config = mutableConfig()
    const player = config.player!
    player.minPlayers = (player.maxPlayers as number) + 1
    expect(() => validateBusinessConfig(config as unknown as typeof APP_CONFIG)).toThrow(
      '玩家最小人数不能大于最大人数',
    )
  })

  it('单回合时长默认值不在合法档位时中止启动', () => {
    const config = mutableConfig()
    const drawSeconds = config.game!.drawSeconds as { options: number[]; default: number }
    drawSeconds.default = 105
    expect(() => validateBusinessConfig(config as unknown as typeof APP_CONFIG)).toThrow(
      '单回合时长默认值必须落在合法档位内',
    )
  })

  it('接龙时长默认值不在合法档位时中止启动（档位在 shared、默认值在 config）', () => {
    const config = mutableConfig()
    for (const [field, message] of [
      ['chooseSeconds', '接龙选词时长默认值必须落在合法档位内'],
      ['drawSeconds', '接龙作画时长默认值必须落在合法档位内'],
      ['guessSeconds', '接龙猜词时长默认值必须落在合法档位内'],
    ] as const) {
      const candidate = structuredClone(config) as unknown as Record<string, unknown>
      const relayConfig = candidate.relay as Record<string, { options: number[]; default: number }>
      relayConfig[field]!.default = 999
      expect(() => validateBusinessConfig(candidate as unknown as typeof APP_CONFIG)).toThrow(
        message,
      )
    }
  })

  it('画板颜色脱离 HEX 格式时中止启动', () => {
    const config = mutableConfig()
    const colors = config.drawing!.colors as string[]
    colors[0] = 'red'
    expect(() => validateBusinessConfig(config as unknown as typeof APP_CONFIG)).toThrow(
      '画板颜色必须是',
    )
  })
})
