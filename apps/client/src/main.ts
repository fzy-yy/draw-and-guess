/**
 * 客户端入口：安装 Pinia 状态管理后挂载唯一游戏舞台（App 根组件）。
 * 全局样式 style.css 在此引入；应用不配置路由，页面切换由 store.page 驱动。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style/index.css'

// 全局右键劫持：整个游戏页面不弹出浏览器右键菜单，避免误触打断游玩。
// 不做任何绕过防护（只拦截默认行为）；画板滚轮等功能不受影响。
window.addEventListener('contextmenu', (event) => event.preventDefault(), { passive: false })

// 创建应用实例并挂载到 index.html 中的 #app 容器
createApp(App).use(createPinia()).mount('#app')
