/**
 * 客户端入口：安装 Pinia 状态管理后挂载唯一游戏舞台（App 根组件）。
 * 全局样式 style.css 在此引入；应用不配置路由，页面切换由 store.page 驱动。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'

// 创建应用实例并挂载到 index.html 中的 #app 容器
createApp(App).use(createPinia()).mount('#app')
