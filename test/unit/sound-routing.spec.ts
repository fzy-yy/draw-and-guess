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
  it('每个房间阶段都有确定结果（BGM 移除后允许无入场音，但绝不抛错）', () => {
    for (const phase of PHASES) {
      expect(() => phaseToAudio(phase)).not.toThrow()
    }
  })

  it('有入场音的阶段映射精确；无入场音的阶段返回 undefined', () => {
    expect(phaseToAudio('starting')).toBe('start')
    expect(phaseToAudio('drawing')).toBe('drawing')
    expect(phaseToAudio('round_result')).toBe('round_result')
    expect(phaseToAudio('game_result')).toBe('game_result')
    expect(phaseToAudio('waiting')).toBeUndefined()
    expect(phaseToAudio('choosing_word')).toBeUndefined()
    expect(phaseToAudio('paused')).toBeUndefined()
    expect(phaseToAudio('closed')).toBeUndefined()
  })
})

describe('音效路由阶段切换', () => {
  it('阶段切换过程是幂等的：同一阶段重复查询返回稳定结果', () => {
    for (const phase of PHASES) {
      expect(phaseToAudio(phase)).toBe(phaseToAudio(phase))
    }
  })
})

describe('音效路由领域事件', () => {
  it('一次性事件映射到对应短音效', () => {
    expect(eventToAudio('self-ready')).toBe('ready')
    expect(eventToAudio('self-guessed')).toBe('correct')
    expect(eventToAudio('invite')).toBe('invite')
    expect(eventToAudio('countdown-tick')).toBe('tick')
    expect(eventToAudio('room-leave')).toBe('close')
    expect(eventToAudio('session-restore')).toBe('switch')
  })
})

describe('音效路由通用交互', () => {
  it('组件只表达交互语义，由路由集中选择具体资源', () => {
    expect(interactionToAudio('activate')).toBe('click')
    expect(interactionToAudio('select')).toBe('switch')
    expect(interactionToAudio('toggle')).toBe('switch')
    expect(interactionToAudio('open')).toBe('popup')
    expect(interactionToAudio('close')).toBe('close')
  })
})
