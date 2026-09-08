/**
 * 资料确认页（ProfileView.vue）与内置 SVG 头像选择相关文案。
 */
export const profile = {
  brandAria: '游戏介绍',
  brandEyebrow: '局域网派对游戏',
  brandCopy: '一人作画，大家来猜。连接同一主机服务即可实时加入。',
  sectionLabel: 'PLAYER PROFILE',
  sectionTitle: '准备好你的角色',
  randomizeAria: '重新随机昵称与 SVG 头像',
  randomize: '换一组',
  nicknameLabel: '昵称',
  nicknameValidAria: '昵称有效',
  nicknameHelp: (min: number, max: number) => `${min}～${max} 个可见字符，在线重名会自动添加数字。`,
  avatarLabel: '角色头像',
  changeAvatar: '点击更换头像',
  changeAvatarAria: '打开 SVG 头像选择',
  avatarPickerLabel: 'AVATARS',
  avatarPickerTitle: '选择你的头像',
  avatarPickerCloseAria: '关闭头像选择',
  avatarOptionAria: (id: string) => `选择第 ${id} 号头像`,
  busy: '正在登记身份…',
  enterLobby: '进入在线大厅',
  offlineWarning: '无法进入：请确认主机服务已启动，地址和端口正确，并检查防火墙。',
} as const
