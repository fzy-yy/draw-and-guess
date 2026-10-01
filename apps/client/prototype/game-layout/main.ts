/**
 * 对局布局原型入口（纯 UI 演示，不连后端）。
 *
 * 打开方式：
 *   pnpm --filter @draw-guess/client dev
 *   浏览器访问 http://localhost:5173/prototype/game-layout/index.html
 * 变体切换：URL ?variant=A|B|C（底部悬浮切换条或键盘 ←/→）。
 *
 * 装配要点：
 * - 复用真实对局组件渲染真实视觉（ChatPanel / GameCanvas），顶栏与玩家面板为原型自建；
 * - 用模拟数据填充 Pinia（见 prototype-store.ts），会走网络的 store 动作在本地模拟；
 * - 传输层替身的 socket 以 autoConnect:false 构造且从不 connect()，全程零网络流量。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@/style/index.css'
import { createGameTransport, installGameTransport } from '@/application/game-transport'
import { installPrototypeStore } from './prototype-store.ts'
import PrototypeApp from './PrototypeApp.vue'

const pinia = createPinia()
// notify 吞掉一切：演示中任何意外失败都不该弹真实错误提示
installGameTransport(pinia, createGameTransport({ notify: () => {} }))
installPrototypeStore(pinia)

createApp(PrototypeApp).use(pinia).mount('#prototype-app')
