/**
 * 原型自用文案（集中放在 .ts 文件里）。
 *
 * 为什么单独放一份：项目的「禁止硬编码中文展示文案」ESLint 规则覆盖所有 .vue 文件，
 * 而原型不想往 @draw-guess/strings（只承载产品文案）里塞一次性演示文案；
 * 把中文集中到本 .ts，SFC 里全部走绑定引用，两边都干净。
 * 对局领域文案（回合、秒、工具名等）仍复用 @draw-guess/strings，只有原型专属文案放这里。
 */
export const labels = {
  /** 原型控制条（原型工具，不属于被评估的设计本身）。 */
  controlBar: '原型控制条',
  switcherNote: '布局原型 · 纯 UI 演示（不连后端）',
  roleLabel: '视角',
  roleGuesser: '猜词者',
  roleDrawer: '画家',
  /** 顶栏面板开关与顶栏无障碍标签。 */
  topBarAria: '对局顶栏',
  togglePlayers: '玩家面板',
  toggleChat: '聊天面板',
  toggleTools: '绘图工具',
  /** 浮层面板标题与关闭按钮。 */
  players: '玩家',
  chat: '聊天',
  closePanel: '关闭面板',
  /** 底部横向工具条。 */
  toolsAria: '绘图工具栏',
  brushSize: '画笔大小',
  brushUnit: 'px',
  brushWheelHint: '滚动调整画笔大小',
} as const
