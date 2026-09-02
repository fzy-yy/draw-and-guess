/**
 * 领域配置：房间默认规则。
 * 归入根级 config/ 目录后由 config.ts 聚合，保持“唯一业务配置中心”不变。
 */
export const room = {
  defaultName: '快乐画室',
  /** 六个固定席位的稳定识别色；房间页不展示，进入对局后用于玩家条带与消息气泡。 */
  seatColors: ['#dc2626', '#facc15', '#16a34a', '#dbeafe', '#2563eb', '#c026d3'],
  allowPlayerInvite: true,
  allowPause: true,
  joinPolicy: 'next_game' as const,
  /** 私密房间码使用排除易混淆字符的服务端随机字符集。 */
  privateCodeAlphabet: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
  privateCodeLength: 6,
  privateJoinWindowMs: 10_000,
  privateJoinMaxAttempts: 5,
} as const
