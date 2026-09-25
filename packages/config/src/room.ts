import { PRIVATE_ROOM_CODE } from '@draw-guess/shared/protocol/constants'
import { roomSettingsDefaults } from './game.ts'

/**
 * 领域配置：房间默认规则；短码协议约束复用 shared，尝试限频留在服务端。
 * 规则默认值统一取 game.ts 的 roomSettingsDefaults（旧玩法预设已移除）。
 */
export const room = {
  defaultName: '快乐画室',
  /** 六个固定席位的稳定识别色；房间页不展示，进入对局后用于玩家条带与消息气泡。 */
  seatColors: ['#dc2626', '#facc15', '#16a34a', '#dbeafe', '#2563eb', '#c026d3'],
  allowPlayerInvite: roomSettingsDefaults.allowPlayerInvite,
  allowPause: roomSettingsDefaults.allowPause,
  joinPolicy: roomSettingsDefaults.joinPolicy,
  /** 私密房间码使用排除易混淆字符的服务端随机字符集。 */
  privateCodeAlphabet: PRIVATE_ROOM_CODE.alphabet,
  privateCodeLength: PRIVATE_ROOM_CODE.length,
} as const
