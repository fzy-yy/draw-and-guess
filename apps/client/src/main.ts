/** 客户端入口：安装 Pinia 后挂载唯一游戏舞台。 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'

createApp(App).use(createPinia()).mount('#app')
