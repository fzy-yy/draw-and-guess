/**
 * 可见文案（按用途分层）：界面直接可见。
 *
 * 分类口径见 .scratch/strings-layering-and-maintenance/spec.md。
 */

export const profile = {
  brandEyebrow: '实时派对游戏',
  brandCopy: '一人作画，大家来猜。连接同一主机服务即可实时加入。',
  sectionLabel: 'PLAYER PROFILE',
  sectionTitle: '准备好你的角色',
  randomize: '换一组',
  nicknameLabel: '昵称',
  nicknameHelp: (min: number, max: number) => `${min}～${max} 个可见字符，在线重名会自动添加数字。`,
  avatarLabel: '角色头像',
  changeAvatar: '点击更换头像',
  avatarPickerLabel: 'AVATARS',
  avatarPickerTitle: '选择你的头像',
  busy: '正在登记身份…',
  enterLobby: '进入在线大厅',
  offlineWarning: '无法进入：请确认主机服务已启动，地址和端口正确，并检查防火墙。',
} as const
