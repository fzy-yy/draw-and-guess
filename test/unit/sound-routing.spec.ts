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
  it('每个房间阶段都有确定的期望 BGM（SoundName 或 null），绝不为 undefined', () => {
    for (const phase of PHASES) {
      const decision = phaseToAudio(phase)
      expect(decision.bgm, `阶段 ${phase} 必须给出 `).not.toBeUndefined()
    }
  })

  it('bgm_game 真实参与对局 BGM 映射：starting/drawing/round_result/game_result/choosing_word/paused', () => {
    for (const phase of [
      'starting',
      'choosing_word',
      'drawing',
      'round_result',
      'game_result',
      'paused',
    ] as const) {
      expect(phaseToAudio(phase).bgm).toBe('bgm_game')
    }
  })

  it('waiting → bgm_lobby；closed → 停止 BGM', () => {
    expect(phaseToAudio('waiting').bgm).toBe('bgm_lobby')
    expect(phaseToAudio('closed').bgm).toBeNull()
  })
})

describe('音效路由阶段切换', () => {
  it('阶段序列触发对应入场 SFX 与 BGM 切换（waiting → starting → drawing → round_result → game_result）', () => {
    // waiting：大厅 BGM，无入场音效
    expect(phaseToAudio('waiting')).toEqual({ bgm: 'bgm_lobby' })

    // starting：开局号角 + 切到对局 BGM
    expect(phaseToAudio('starting')).toEqual({ sfx: 'start', bgm: 'bgm_game' })

    // choosing_word：无入场音效，仍为对局 BGM
    expect(phaseToAudio('choosing_word')).toEqual({ bgm: 'bgm_game' })

    // drawing：作画提示音
    expect(phaseToAudio('drawing')).toEqual({ sfx: 'drawing', bgm: 'bgm_game' })

    // round_result：回合结算
    expect(phaseToAudio('round_result')).toEqual({ sfx: 'round_result', bgm: 'bgm_game' })

    // game_result：最终结算
    expect(phaseToAudio('game_result')).toEqual({ sfx: 'game_result', bgm: 'bgm_game' })
  })

  it('阶段切换过程是幂等的：同一阶段重复查询返回稳定决策', () => {
    for (const phase of PHASES) {
      expect(phaseToAudio(phase)).toEqual(phaseToAudio(phase))
    }
  })
})

describe('音效路由领域事件', () => {
  it('一次性事件只给出 SFX、不改变 BGM', () => {
    expect(eventToAudio('self-ready')).toEqual({ sfx: 'ready' })
    expect(eventToAudio('self-guessed')).toEqual({ sfx: 'correct' })
    expect(eventToAudio('invite')).toEqual({ sfx: 'invite' })
    expect(eventToAudio('countdown-tick')).toEqual({ sfx: 'tick' })
    expect(eventToAudio('self-ready').bgm).toBeUndefined()
  })

  it('离房停止 BGM；断线恢复只提示、BGM 由阶段重设', () => {
    expect(eventToAudio('room-leave')).toEqual({ sfx: 'close', bgm: null })
    expect(eventToAudio('session-restore')).toEqual({ sfx: 'switch' })
    expect(eventToAudio('session-restore').bgm).toBeUndefined()
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

  it('通用交互不改变当前 BGM', () => {
    for (const event of ['activate', 'select', 'toggle', 'open', 'close'] as const) {
      expect(interactionToAudio(event).bgm).toBeUndefined()
    }
  })
})
