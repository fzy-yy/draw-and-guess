import { PRIVATE_ROOM_CODE } from '@draw-guess/shared/protocol/constants'

/**
 * 领域配置：房间默认规则与短码约束；短码协议约束复用 shared，尝试限频留在服务端。
 *
 * 注意：可调房间规则的默认值只有一处来源——`game.ts` 的 `roomSettingsDefaults`；
 * 本文件只放「不属可调规则」的房间标识信息（房间名、席位色、短码）。
 */
export const room = {
  /** 建房弹窗的默认房间名。 */
  defaultName: '快乐画室',
  /** 六个固定席位的稳定识别色；房间页不展示，进入对局后用于玩家条带与消息气泡。 */
  seatColors: ['#dc2626', '#facc15', '#16a34a', '#0284c7', '#2563eb', '#c026d3'],
  /** 私密房间码的字符表（服务端生成短码用）。 */
  privateCodeAlphabet: PRIVATE_ROOM_CODE.alphabet,
  /** 私密房间码长度（服务端生成与客户端输入框校验共用）。 */
  privateCodeLength: PRIVATE_ROOM_CODE.length,
} as const
