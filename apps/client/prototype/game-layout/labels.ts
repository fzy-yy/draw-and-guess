/**
 * 原型自用文案（集中放在 .ts 文件里）。
 *
 * 为什么单独放一份：项目的「禁止硬编码中文展示文案」ESLint 规则覆盖所有 .vue 文件，
 * 而原型不想往 @draw-guess/strings（只承载产品文案）里塞一次性演示文案；
 * 把中文集中到本 .ts，SFC 里全部走绑定引用，两边都干净。
 */
export const labels = {
  /** 底部切换条（原型工具，不属于被评估的设计本身）。 */
  switcherNote: '布局原型 · 纯 UI 演示（不连后端）',
  prevVariant: '上一个变体',
  nextVariant: '下一个变体',
  roleLabel: '视角',
  roleGuesser: '猜词者',
  roleDrawer: '画家',
  variants: {
    A: '自由浮窗',
    B: '边缘抽屉',
    C: '紧凑窗口',
  },
  /** 面板与工具栏的收起/展开把手。 */
  collapsePlayers: '收起玩家面板',
  expandPlayers: '展开玩家面板',
  collapseChat: '收起聊天面板',
  expandChat: '展开聊天面板',
  collapseToolbar: '收起工具栏',
  expandToolbar: '展开工具栏',
  collapseDock: '收起侧坞',
  expandDock: '展开侧坞',
  closePanel: '关闭面板',
  brushSizeWheel: '滚动调整画笔大小',
  brushSizeUnit: 'px',
  panelControlsAria: '对局面板开关',
  panelStateOpen: '面板已打开',
  panelStateClosed: '面板已关闭',
  /** 面板标题与选项卡。 */
  players: '玩家',
  chat: '聊天',
  playersTab: '玩家',
  chatTab: '聊天',
  toolsTab: '绘图工具',
  unreadBadge: '未读消息',
} as const
