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

  it('区间默认值越界时中止启动（点名字段）', () => {
    const config = mutableConfig()
    const drawSeconds = config.game!.drawSeconds as Record<string, number>
    drawSeconds.default = drawSeconds.max! + 1
    expect(() => validateBusinessConfig(config as unknown as typeof APP_CONFIG)).toThrow(
      '作画秒数 默认值必须落在 min～max 区间内',
    )
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
