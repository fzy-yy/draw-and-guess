import { AVATAR_IDS, PLAYER_PROTOCOL_LIMITS } from '@draw-guess/shared/protocol/constants'

/**
 * 领域配置：玩家资料默认值；协议长度和头像白名单复用 shared 公开约束。
 */
export const player = {
  minPlayers: PLAYER_PROTOCOL_LIMITS.minPlayers,
  maxPlayers: PLAYER_PROTOCOL_LIMITS.maxPlayers,
  defaultMaxPlayers: PLAYER_PROTOCOL_LIMITS.maxPlayers,
  nicknameMinLength: PLAYER_PROTOCOL_LIMITS.nicknameMinLength,
  nicknameMaxLength: PLAYER_PROTOCOL_LIMITS.nicknameMaxLength,
  roomNameMaxLength: PLAYER_PROTOCOL_LIMITS.roomNameMaxLength,
  chatMaxLength: PLAYER_PROTOCOL_LIMITS.chatMaxLength,
  defaultNicknames: [
    '泡泡狐',
    '棉花喵',
    '竹叶熊',
    '星星兔',
    '布丁汪',
    '荷叶蛙',
    '齿轮仔',
    '月球客',
    '豆豆龙',
    '阳光鸡',
    '云朵熊',
    '小幽灵',
  ],
  /**
   * 头像协议只传递内置 SVG 的稳定编号，不接收任意 URL、路径或 SVG 正文。
   * 服务端以此数组作为白名单，客户端以同一列表生成选择器并映射本地静态资源。
   */
  avatarIds: AVATAR_IDS,
  defaultAvatarId: '01',
} as const
