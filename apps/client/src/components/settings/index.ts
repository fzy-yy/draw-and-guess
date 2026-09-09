export { default as AccessibilityTab } from './AccessibilityTab.vue'
export { default as AudioTab } from './AudioTab.vue'
// 注意：DiagnosticsTab 为懒加载模块，**不要**在此静态 re-export——
// 静态 re-export 会被入口静态图捕获，导致代码分割失效（见 utils/lazy-component.ts）。
export { default as SettingsSectionHeader } from './SettingsSectionHeader.vue'
export { default as ShortcutsTab } from './ShortcutsTab.vue'
