/**
 * 消费面最宽的 store/composable 的「契约锁定」编译期快照。
 *
 * 动机：useGameStore Facade 聚合 8 个子 store、被全部视图消费；useGameHud / useRoomSync /
 * useToasts 是跨目录复用的组合式函数。这些模块的返回类型由实现推断（精度最高、无双重维护），
 * 但「静默改名 / 误删 / 意外新增成员」会无声改变全站契约——本文件用成员名集合的编译期快照
 * 把这类漂移变成 typecheck 失败（本文件非 *.spec.ts，vitest 不执行，由 vue-tsc 程序编译把关）。
 *
 * 维护约定：有意增删成员时，同步更新这里的名单（这是提醒机制，不是阻力）。
 */
import { expectTypeOf } from 'vitest'
import type { useGameStore } from '@/stores/game'
import type { useGameHud } from '@/composables/useGameHud'
import type { useRoomSync } from '@/composables/useRoomSync'
import type { useToasts } from '@/composables/useToasts'

/** Pinia store 实例自带的 $ 前缀 API 与 _customProperties 内部字段不属于业务契约，排除后再比对。 */
type BusinessKeys<T> = Exclude<keyof T, `$${string}` | '_customProperties'>

expectTypeOf<BusinessKeys<ReturnType<typeof useGameStore>>>().toEqualTypeOf<
  | 'config'
  | 'profile'
  | 'settings'
  | 'playerId'
  | 'page'
  | 'connected'
  | 'sessionState'
  | 'connectionLabel'
  | 'latency'
  | 'clockOffset'
  | 'presence'
  | 'room'
  | 'vocabulary'
  | 'invites'
  // 接龙消费面（S84）：视图 + `relay*` 动作族
  | 'relay'
  | 'relaySendStroke'
  | 'relaySendFill'
  | 'relayDrawAction'
  | 'relaySubmitGuess'
  | 'relaySubmitDrawing'
  | 'relayVote'
  | 'relayChat'
  | 'kickedNotice'
  | 'protocolMismatch'
  | 'busy'
  | 'me'
  | 'isHost'
  | 'isDrawer'
  | 'notify'
  | 'register'
  | 'randomizeProfile'
  | 'saveSettings'
  | 'resetSettings'
  | 'clearProfile'
  | 'updateProfile'
  | 'createRoom'
  | 'joinRoom'
  | 'joinPrivateRoom'
  | 'leaveRoom'
  | 'requestFullSnapshot'
  | 'setReady'
  | 'updateRoomSettings'
  | 'loadVocabulary'
  | 'saveVocabulary'
  | 'selectVocabularyPackage'
  | 'cancelVocabularyRequests'
  | 'startGame'
  | 'chooseWord'
  | 'rerollWords'
  | 'chooseCustomWord'
  | 'submitGuess'
  | 'sendPreset'
  | 'sendCanvasPing'
  | 'latestCanvasPing'
  | 'sendStroke'
  | 'sendFill'
  | 'drawAction'
  | 'pause'
  | 'resume'
  | 'endEarly'
  | 'leaveGame'
  | 'returnWaiting'
  | 'kick'
  | 'transferHost'
  | 'invite'
  | 'respondInvite'
  | 'dismissKickedNotice'
>()

expectTypeOf<keyof ReturnType<typeof useGameHud>>().toEqualTypeOf<
  | 'game'
  | 'relay'
  | 'phaseEndsAt'
  | 'secondsLeft'
  | 'progress'
  | 'canGuess'
  | 'phaseLabel'
  | 'rankings'
  // 接龙派生（S74 / S84）：棒次、题面、上一家 chip、提交状态与复盘链进度
  | 'relayStep'
  | 'relayPrompt'
  | 'relayPromptKind'
  | 'relayArtist'
  | 'relayArtistPaints'
  | 'relayStatusMode'
  | 'relaySubmittedIds'
  | 'relayChainProgress'
>()

expectTypeOf<keyof ReturnType<typeof useRoomSync>>().toEqualTypeOf<
  'onRoomSnapshot' | 'onStroke' | 'onFill'
>()

expectTypeOf<keyof ReturnType<typeof useToasts>>().toEqualTypeOf<
  'toasts' | 'notify' | 'dismiss' | 'onBump'
>()
