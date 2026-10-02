/**
 * 可见文案（按用途分层）：界面直接可见。
 *
 * 分类口径见 .scratch/strings-layering-and-maintenance/spec.md。
 */

export const app = {
  inviteHeading: '收到房间邀请',
  inviteReceived: (nickname: string, roomName: string) => `${nickname} 邀请你加入“${roomName}”`,
  kickedTitle: '已被移出房间',
  kickedBody: '你已被房主移出房间，现返回在线大厅。',
  kickedConfirm: '知道了',
  disconnectedTitle: '与主机连接已中断',
  disconnectedBody: '正在自动重连，请保持页面打开。连接恢复后会继续同步你的身份和未完成对局。',
  restoringTitle: '正在恢复游戏状态',
  restoringBody: '已连接到主机，正在核对本机恢复令牌并同步权威房间与画布状态。',
  protocolMismatchTitle: '客户端需要刷新或升级',
  protocolMismatchBody: '当前页面与主机服务的协议版本不兼容，必须刷新并加载最新客户端后才能继续。',
  protocolMismatchAction: '刷新页面',
  portraitTitle: '请横屏使用',
  portraitHint: '旋转设备后即可获得完整的游戏舞台。',
} as const
