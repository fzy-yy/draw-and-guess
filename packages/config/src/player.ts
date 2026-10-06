import { AVATAR_IDS, PLAYER_PROTOCOL_LIMITS } from '@draw-guess/shared/protocol/constants'

/**
 * 领域配置：玩家资料默认值；协议长度和头像白名单复用 shared 公开约束。
 */
export const player = {
  /** 开局所需的最少玩家人数（服务端开局门禁与房间页提示共用）。 */
  minPlayers: PLAYER_PROTOCOL_LIMITS.minPlayers,
  /** 房间席位数与人数上限（固定 6，房主不可调整）。 */
  maxPlayers: PLAYER_PROTOCOL_LIMITS.maxPlayers,
  /** 昵称最少字符数（按 grapheme 计）。 */
  nicknameMinLength: PLAYER_PROTOCOL_LIMITS.nicknameMinLength,
  /** 昵称最多字符数（按 grapheme 计）。 */
  nicknameMaxLength: PLAYER_PROTOCOL_LIMITS.nicknameMaxLength,
  /** 房间名最多字符数（建房输入框与服务端校验共用）。 */
  roomNameMaxLength: PLAYER_PROTOCOL_LIMITS.roomNameMaxLength,
  /** 聊天/猜词单条最多字符数（输入框与服务端校验共用）。 */
  chatMaxLength: PLAYER_PROTOCOL_LIMITS.chatMaxLength,
  /** 首次进入时的随机昵称池（未填写昵称时从这里随机取一个）。 */
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
   * 保持字面量元组类型（AvatarId 联合），校验任意字符串请走 shared 的 isAvatarId 守卫。
   */
  avatarIds: AVATAR_IDS,
  /** 默认头像编号（资料缺失或服务端兜底时的头像）。 */
  defaultAvatarId: '01',
} as const
