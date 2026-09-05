/**
 * 根舞台（App.vue）相关文案：邀请横幅、断线阻断、被踢提示与横竖屏警告。
 */
export const app = {
  stageAriaLabel: (appName: string) => `${appName} 游戏舞台`,
  inviteDialogAria: '房间邀请',
  inviterAvatarAria: '邀请者 SVG 头像',
  inviteHeading: '收到房间邀请',
  inviteReceived: (nickname: string, roomName: string) => `${nickname} 邀请你加入“${roomName}”`,
  kickedTitle: '已被移出房间',
  kickedBody: '你已被房主移出房间，现返回在线大厅。',
  kickedConfirm: '知道了',
  disconnectDialogAria: '连接中断提示',
  disconnectedTitle: '与主机连接已中断',
  disconnectedBody: '正在自动重连，请保持页面打开。连接恢复后会继续同步你的身份和未完成对局。',
  restoringTitle: '正在恢复游戏状态',
  restoringBody: '已连接到主机，正在核对本机恢复令牌并同步权威房间与画布状态。',
  portraitTitle: '请横屏使用',
  portraitHint: '旋转设备后即可获得完整的游戏舞台。',
} as const
