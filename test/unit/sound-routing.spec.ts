import { describe, expect, it } from 'vitest'
import type { RoomPhase } from '@draw-guess/shared'
import {
  eventToAudio,
  interactionToAudio,
  phaseToAudio,
} from '../../apps/client/src/audio/routing.ts'

/** 全部 RoomPhase，用于映射完整性与逐阶段断言的遍历。 */
const PHASES: RoomPhase[] = [
  'waiting',
  'starting',
  'choosing_word',
  'drawing',
  'round_result',
  'paused',
  'game_result',
  'closed',
]

describe('音效路由映射完整性', () => {
  it('每个房间阶段都有确定决策（BGM 移除后允许空决策，但绝不抛错）', () => {
    for (const phase of PHASES) {
      expect(() => phaseToAudio(phase)).not.toThrow()
    }
  })

  it('有入场音的阶段映射精确；无入场音的阶段返回空决策', () => {
    expect(phaseToAudio('starting')).toEqual({ sfx: 'start' })
    expect(phaseToAudio('drawing')).toEqual({ sfx: 'drawing' })
    expect(phaseToAudio('round_result')).toEqual({ sfx: 'round_result' })
    expect(phaseToAudio('game_result')).toEqual({ sfx: 'game_result' })
    expect(phaseToAudio('waiting')).toEqual({})
    expect(phaseToAudio('choosing_word')).toEqual({})
    expect(phaseToAudio('paused')).toEqual({})
    expect(phaseToAudio('closed')).toEqual({})
  })
})

describe('音效路由阶段切换', () => {
  it('阶段切换过程是幂等的：同一阶段重复查询返回稳定决策', () => {
    for (const phase of PHASES) {
      expect(phaseToAudio(phase)).toEqual(phaseToAudio(phase))
    }
  })
})

describe('音效路由领域事件', () => {
  it('一次性事件映射到对应短音效', () => {
    expect(eventToAudio('self-ready')).toEqual({ sfx: 'ready' })
    expect(eventToAudio('self-guessed')).toEqual({ sfx: 'correct' })
    expect(eventToAudio('invite')).toEqual({ sfx: 'invite' })
    expect(eventToAudio('countdown-tick')).toEqual({ sfx: 'tick' })
    expect(eventToAudio('room-leave')).toEqual({ sfx: 'close' })
    expect(eventToAudio('session-restore')).toEqual({ sfx: 'switch' })
  })
})

describe('音效路由通用交互', () => {
  it('组件只表达交互语义，由路由集中选择具体资源', () => {
    expect(interactionToAudio('activate')).toEqual({ sfx: 'click' })
    expect(interactionToAudio('select')).toEqual({ sfx: 'switch' })
    expect(interactionToAudio('toggle')).toEqual({ sfx: 'switch' })
    expect(interactionToAudio('open')).toEqual({ sfx: 'popup' })
    expect(interactionToAudio('close')).toEqual({ sfx: 'close' })
  })
})
