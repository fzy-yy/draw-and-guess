/**
 * 可见文案（按用途分层）：界面直接可见。
 *
 * 分类口径见 CONTEXT.md。
 */

export const lobby = {
  fullscreenPromptHeading: '全屏体验推荐',
  fullscreenPromptBody: '是否开启全屏？提示：按 F11 可随时退出或进入全屏',
  fullscreenPromptConfirm: '确定',
  fullscreenPromptDismiss: '暂不',
  lobbyTitle: '你画我猜游戏大厅',
  settingsEntry: '设置',
  roomsLabel: 'ROOMS',
  roomsTitle: '全部公开画室',
  roomCount: (count: number) => `${count} 个房间`,
  createRoomTitle: '创建公开房间',
  createRoomHint: '创建公开或私密画室',
  joinPrivateTitle: '加入私密房间',
  joinPrivateHint: '使用房主分享的房间码加入',
  roomMeta: (host: string, rounds: number, seconds: number) =>
    `房主 ${host} · ${rounds} 轮 · ${seconds} 秒`,
  /**
   * 接龙房卡片：棒数固定 4 棒（S9），轮数与单回合时长是经典专属字段、接龙下不生效，
   * 故不与经典共用同一行（S39 / S52）。
   */
  roomMetaRelay: (host: string, steps: number) => `房主 ${host} · ${steps} 棒`,
  joinButton: '加入',
  /** 开局后加入入口置灰时的按钮文案（容量固定、开局后不可加入）。 */
  joinInProgress: '游戏中',
  emptyRoomsTitle: '还没有公开房间',
  emptyRoomsHint: '成为第一个房主，新房间会实时广播给所有在线玩家。',
  playersLabel: 'PLAYERS',
  playersTitle: '在线玩家',
  playerFilterPlaceholder: '按昵称筛选',
  discoveryEmpty: '其他玩家需先访问本主机地址并确认资料，之后会自动显示在这里。',
  lanTipTitle: '局域网发现说明',
  lanTipBody: '这里只展示已经连接到当前主机服务且允许被发现的玩家。',
  newRoomLabel: 'NEW ROOM',
  createDialogTitle: '创建画室',
  roomNameField: '房间名称',
  visibilityField: '房间类型',
  visibilityPublic: '公开房间',
  visibilityPublicHint: '出现在大厅列表，所有玩家均可自由加入',
  visibilityPrivate: '私密房间',
  visibilityPrivateHint: '不进入大厅列表，仅可凭房间码或邀请加入',
  publicNote: '公开房间会实时显示在大厅，其他玩家可以直接加入。',
  privateNote: '私密房间不会出现在大厅；创建后房主可在房间顶部查看房间码。',
  createAndEnter: '创建并进入',
  /** 建房弹窗顶部的玩法模式单选（S27 / S28）：模式建房时选定、房间内不可修改。 */
  gameModeField: '玩法模式',
  gameModeClassic: '经典模式',
  gameModeClassicHint: '轮流当画家，一轮一题',
  gameModeRelay: '接龙模式',
  gameModeRelayHint: '4 人起；四棒传话，全员同时开画',
  privateJoinLabel: 'PRIVATE ROOM',
  privateJoinTitle: '输入房间码',
  privateJoinBody: '请输入私密房房主分享的房间码。字母不区分大小写。',
  privateCodePlaceholder: '例如 A2B3C4',
  joinPrivateConfirm: '加入房间',
} as const
