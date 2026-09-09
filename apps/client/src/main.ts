/**
 * 客户端入口：安装 Pinia 状态管理后挂载唯一游戏舞台（App 根组件）。
 * 全局样式 index.css 在此引入；应用不配置路由，页面切换由 store.page 驱动。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { initAudio } from './audio'
import { createGameTransport, installGameTransport } from './application/game-transport'
import { notify } from './composables/useToasts'
// Toast 为项目自建组件（AppToaster.vue + useToasts.ts），样式统一走 index.css，无需第三方样式。
import './style/index.css'

// 启动时校验音效资源清单：开发/测试环境会在控制台醒目输出缺失/冲突项（可定位、不抛错），
// 生产环境静默降级，各键按可用性自动降级且绝不抛异常。
initAudio()

// 全局右键劫持：整个游戏页面不弹出浏览器右键菜单，避免误触打断游玩。
// 不做任何绕过防护（只拦截默认行为）；画板滚轮等功能不受影响。
window.addEventListener('contextmenu', (event) => event.preventDefault(), { passive: false })

// Socket、请求器和通知边界只在应用入口创建一次，再显式注入当前 Pinia。
const pinia = createPinia()
const transport = createGameTransport({ notify })
installGameTransport(pinia, transport)
const app = createApp(App).use(pinia)
app.mount('#app')

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.unmount()
    transport.destroy()
  })
}
