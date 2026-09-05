/** ESLint 扁平配置：统一检查 Vue、TypeScript 与 Node 代码，并忽略构建产物。
 *
 * 除内置/推荐规则外，还定义了针对 .vue 的 SFC 惯例约束：
 *  - sfc-conventions/ban-style-block：禁止在 .vue 中新建 <style> 分片块（样式一律行内 Tailwind 或全局 index.css）。
 *  - sfc-conventions/ban-cjk-literal：禁止在组件/业务脚本里硬编码中文展示文案（应导入 config/strings.ts）。
 *    说明：仅拦截字符串字面量 Literal（含模板 {{ }} 表达式内的字面量），注释与纯模板文本不被波及；
 *    配置/词库等 .ts 文件不在 .vue 作用域，天然豁免。
 */
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

// 自有 SFC 惯例规则（针对 .vue 文件）。
const sfcConventions = {
  rules: {
    'ban-style-block': {
      meta: {
        type: 'problem',
        docs: { description: '禁止在 .vue 中新建 <style> 分片块' },
        schema: [],
      },
      create(context) {
        const text = context.sourceCode.text
        // 顶层或任何位置的 <style ...> 开标签都视为违规（本项目约定不使用样式块）。
        if (/<style(?:\s[^>]*)?>/i.test(text)) {
          return {
            Program(node) {
              context.report({
                node,
                message:
                  '禁止在 .vue 中新建 <style> 分片块：组件样式一律写成行内 Tailwind 类，全局层保留在 style/index.css。',
              })
            },
          }
        }
        return {}
      },
    },
    'ban-cjk-literal': {
      meta: {
        type: 'suggestion',
        docs: { description: '禁止在 .vue 组件/业务脚本中硬编码中文展示文案' },
        schema: [],
      },
      create(context) {
        return {
          Literal(node) {
            const value = node.value
            if (typeof value === 'string' && /[\u4e00-\u9fa5]/.test(value)) {
              context.report({
                node,
                message:
                  '禁止在 .vue 组件/业务代码中硬编码中文展示文案，请改用 config/strings.ts 的 strings 导入。',
              })
            }
          },
        }
      },
    },
  },
}

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
      globals: {
        document: 'readonly',
        window: 'readonly',
        location: 'readonly',
        history: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        crypto: 'readonly',
        AudioContext: 'readonly',
        ResizeObserver: 'readonly',
        HTMLCanvasElement: 'readonly',
        CanvasRenderingContext2D: 'readonly',
        PointerEvent: 'readonly',
        WheelEvent: 'readonly',
        KeyboardEvent: 'readonly',
        FocusEvent: 'readonly',
        Event: 'readonly',
        EventTarget: 'readonly',
        getComputedStyle: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'no-console': 'off',
      'no-constant-condition': 'off',
    },
  },
  {
    // 面向 .vue 文件的 SFC 惯例约束：启用自有规则（仅作用于 .vue，不触碰 config/strings.ts 等 .ts）。
    files: ['**/*.vue'],
    plugins: { 'sfc-conventions': sfcConventions },
    rules: {
      'sfc-conventions/ban-style-block': 'error',
      'sfc-conventions/ban-cjk-literal': 'error',
    },
  },
]
