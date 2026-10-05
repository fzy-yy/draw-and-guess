/** ESLint 扁平配置：统一检查 Vue、TypeScript 与 Node 代码，并忽略构建产物。 */
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import noOnlyTests from 'eslint-plugin-no-only-tests'
import tseslint from 'typescript-eslint'

const CJK_PATTERN = /\p{Script=Han}/u
// 非规范字重：只允许 font-normal / font-bold（及其它 family 类如 font-sans/font-mono）；
// 同时禁止临时 font-[...] 任意值，避免绕过标尺。
const FORBIDDEN_FONT_WEIGHT_PATTERN =
  /(?:^|\s)font-(?:thin|light|medium|semibold|extrabold|black)(?:\s|$)|(?:^|\s)font-\[[^\]]+\](?:\s|$)/u

function isTestFilename(filename) {
  const normalized = filename.replace(/\\/gu, '/')
  return (
    /(?:^|\/)(?:test|tests|__tests__)\//u.test(normalized) ||
    /\.(?:spec|test)\.vue$/u.test(normalized)
  )
}

function isDiagnosticLiteral(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type !== 'CallExpression' && current.type !== 'NewExpression') continue
    const { callee } = current
    if (callee.type === 'Identifier' && callee.name === 'Error') return true
    if (
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'console'
    )
      return true
  }
  return false
}

function isClassBindingLiteral(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type !== 'VAttribute') continue
    if (!current.directive) return current.key.name === 'class'
    return (
      current.key.name.name === 'bind' &&
      current.key.argument?.type === 'VIdentifier' &&
      current.key.argument.name === 'class'
    )
  }
  return false
}

function memberName(node) {
  if (node.type !== 'MemberExpression') return undefined
  if (!node.computed && node.property.type === 'Identifier') return node.property.name
  if (node.computed && node.property.type === 'Literal') return node.property.value
  return undefined
}

function objectName(node) {
  return node.type === 'MemberExpression' && node.object.type === 'Identifier'
    ? node.object.name
    : undefined
}

/**
 * 项目自有规则保持为纯 ESLint Rule，供配置与 RuleTester 复用。
 * Vue 规则依赖 vue-eslint-parser 暴露的 document fragment/template visitor，避免扫描注释或源码文本。
 */
export const projectConventions = {
  rules: {
    'ban-style-block': {
      meta: {
        type: 'problem',
        docs: { description: '禁止在 .vue 中新建 <style> 分片块' },
        schema: [],
        messages: {
          forbidden:
            '禁止在 .vue 中新建 <style> 分片块：组件样式一律写成行内 Tailwind 类，全局层保留在 style/index.css。',
        },
      },
      create(context) {
        return {
          Program() {
            const fragment = context.sourceCode.parserServices.getDocumentFragment?.()
            for (const child of fragment?.children ?? []) {
              if (child.type === 'VElement' && child.name === 'style') {
                context.report({ node: child, messageId: 'forbidden' })
              }
            }
          },
        }
      },
    },
    'ban-cjk-literal': {
      meta: {
        type: 'suggestion',
        docs: { description: '禁止在 .vue 模板与业务脚本中硬编码中文展示文案' },
        schema: [],
        messages: {
          forbidden: '禁止硬编码中文展示文案，请改用 strings 导入。',
        },
      },
      create(context) {
        // 测试夹具用于断言具体文案；技术诊断则不会展示给玩家，均不属于 UI 文案表职责。
        if (isTestFilename(context.filename)) return {}

        const reportLiteral = (node, value) => {
          if (
            CJK_PATTERN.test(value) &&
            !isDiagnosticLiteral(node) &&
            !isClassBindingLiteral(node)
          ) {
            context.report({ node, messageId: 'forbidden' })
          }
        }
        const scriptVisitor = {
          Literal(node) {
            if (typeof node.value === 'string') reportLiteral(node, node.value)
          },
          TemplateLiteral(node) {
            reportLiteral(
              node,
              node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(''),
            )
          },
        }

        const templateVisitor = {
          VText(node) {
            if (CJK_PATTERN.test(node.value)) {
              context.report({ node, messageId: 'forbidden' })
            }
          },
          VAttribute(node) {
            if (node.directive || typeof node.value?.value !== 'string') return
            const name = node.key.name
            if (name !== 'title' && name !== 'placeholder' && !name.startsWith('aria-')) return
            reportLiteral(node.value, node.value.value)
          },
          ...scriptVisitor,
        }

        const defineTemplateBodyVisitor =
          context.sourceCode.parserServices.defineTemplateBodyVisitor
        return defineTemplateBodyVisitor
          ? defineTemplateBodyVisitor(templateVisitor, scriptVisitor)
          : scriptVisitor
      },
    },
    'ban-forbidden-utility': {
      meta: {
        type: 'problem',
        docs: { description: '禁止违反全局字体字重规范的 Tailwind 工具类' },
        schema: [],
        messages: {
          forbidden: '禁止使用非规范字重，请使用 font-normal 或 font-bold。',
        },
      },
      create(context) {
        const reportLiteral = (node, value) => {
          if (FORBIDDEN_FONT_WEIGHT_PATTERN.test(value)) {
            context.report({ node, messageId: 'forbidden' })
          }
        }
        const scriptVisitor = {
          Literal(node) {
            if (typeof node.value === 'string') reportLiteral(node, node.value)
          },
          TemplateLiteral(node) {
            const text = node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(' ')
            reportLiteral(node, text)
          },
        }
        const templateVisitor = {
          VAttribute(node) {
            if (
              !node.directive &&
              node.key.name === 'class' &&
              typeof node.value?.value === 'string'
            ) {
              reportLiteral(node.value, node.value.value)
            }
          },
          ...scriptVisitor,
        }
        const defineTemplateBodyVisitor =
          context.sourceCode.parserServices.defineTemplateBodyVisitor
        return defineTemplateBodyVisitor
          ? defineTemplateBodyVisitor(templateVisitor, scriptVisitor)
          : scriptVisitor
      },
    },
    'require-server-runtime': {
      meta: {
        type: 'problem',
        docs: { description: '服务端领域代码必须使用注入的 Clock、RandomSource 与 Scheduler' },
        schema: [],
        messages: {
          clock: '服务端领域代码必须使用注入的 Clock。',
          random: '服务端领域代码必须使用注入的 RandomSource。',
          scheduler: '服务端领域代码必须使用注入的 Scheduler。',
        },
      },
      create(context) {
        const reportCall = (node) => {
          const { callee } = node
          const property = memberName(callee)
          const owner = objectName(callee)

          if (
            (owner === 'Date' && property === 'now') ||
            (owner === 'performance' && property === 'now') ||
            (callee.type === 'Identifier' && callee.name === 'Date')
          ) {
            context.report({ node, messageId: 'clock' })
            return
          }
          if (owner === 'Math' && property === 'random') {
            context.report({ node, messageId: 'random' })
            return
          }

          const timerName = callee.type === 'Identifier' ? callee.name : property
          if (
            ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'].includes(timerName) &&
            (callee.type === 'Identifier' || ['global', 'globalThis'].includes(owner))
          ) {
            context.report({ node, messageId: 'scheduler' })
          }
        }

        return {
          CallExpression: reportCall,
          NewExpression(node) {
            if (
              node.callee.type === 'Identifier' &&
              node.callee.name === 'Date' &&
              node.arguments.length === 0
            ) {
              context.report({ node, messageId: 'clock' })
            }
          },
        }
      },
    },
  },
}

export default tseslint.config([
  {
    // 忽略产物与依赖（与 .gitignore / .prettierignore 同口径）：
    // Playwright 的报告与 trace 里是压缩过的第三方 JS bundle，纳入 lint 会让本地跑完 e2e 后 pnpm lint 恒失败。
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/release/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/blob-report/**',
      '.pi/**',
    ],
  },
  {
    // 过期豁免守护：被禁用却不再命中任何问题的 eslint-disable 直接报错（AGENTS 要求生产源码零 eslint-disable 记录）。
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Vue 预设默认未限定 files，会把 100+ 条 vue/* 规则施加到 .ts/.js；这里统一收敛到 SFC。
  ...pluginVue.configs['flat/recommended'].map((config) => ({ ...config, files: ['**/*.vue'] })),
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue}'],
    rules: {
      'no-console': 'error',
      // 强制严格相等（smart 放行 == null 这类惯用写法，仍拦截其它隐式转换）。
      eqeqeq: ['error', 'smart'],
    },
  },
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
        Audio: 'readonly',
        HTMLAudioElement: 'readonly',
        ResizeObserver: 'readonly',
        HTMLCanvasElement: 'readonly',
        CanvasRenderingContext2D: 'readonly',
        PointerEvent: 'readonly',
        WheelEvent: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        FocusEvent: 'readonly',
        Event: 'readonly',
        EventTarget: 'readonly',
        Node: 'readonly',
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
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-constant-condition': 'off',
    },
  },
  {
    // 面向 .vue 文件的 SFC 约束：关闭与 Prettier 冲突的排版规则，开启模板正确性、响应式丢失防护与自有规则。
    files: ['**/*.vue'],
    plugins: { 'project-conventions': projectConventions },
    rules: {
      // 排版交给 Prettier：关闭 pluginVue 预设里的格式规则。
      'vue/multi-word-component-names': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      // 模板正确性与响应式丢失防护（不在 flat/recommended 预设内）。
      'vue/no-undef-components': 'error',
      'vue/no-ref-object-reactivity-loss': 'error',
      'vue/no-setup-props-reactivity-loss': 'error',
      // 项目自有 SFC 惯例。
      'project-conventions/ban-style-block': 'error',
      'project-conventions/ban-cjk-literal': 'error',
      'project-conventions/ban-forbidden-utility': 'error',
    },
  },
  {
    // 客户端业务 .ts 同样禁止硬编码展示文案：stores/composables/views 的字符串与模板串由规则检查，
    // 测试文件与 Error/console 诊断仍在规则内部豁免（audio/utils 的资源诊断不在本范围）。
    files: ['apps/client/src/{stores,composables,views}/**/*.ts'],
    plugins: { 'project-conventions': projectConventions },
    rules: {
      'project-conventions/ban-cjk-literal': 'error',
    },
  },
  {
    files: [
      'apps/server/src/game-service.ts',
      'apps/server/src/round-machine.ts',
      'apps/server/src/rate-limit.ts',
      'apps/server/src/snapshot.ts',
      'apps/server/src/scoring.ts',
      'apps/server/src/hint-scheduler.ts',
      'apps/server/src/domain/**/*.ts',
      'apps/server/src/application/**/*.ts',
      'apps/server/src/protocol/**/*.ts',
    ],
    plugins: { 'project-conventions': projectConventions },
    rules: {
      'project-conventions/require-server-runtime': 'error',
    },
  },
  {
    // 系统运行时是唯一把抽象绑定到 Date/crypto/Node timer 的生产适配层。
    files: ['apps/server/src/runtime.ts'],
    plugins: { 'project-conventions': projectConventions },
    rules: {
      'project-conventions/require-server-runtime': 'off',
    },
  },
  {
    // 控制台只在进程入口、启动提示、开发期资源诊断与测试运行器中使用。
    files: [
      'apps/server/src/index.ts',
      'apps/server/src/startup/lan-addresses.ts',
      'apps/client/src/audio/manifest.ts',
      'apps/client/src/audio/runtime.ts',
      'apps/client/src/utils/avatar.ts',
      'test/e2e/launcher.mts',
      'test/e2e/specs/09-drawing-history-limit.spec.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // ===== 类型感知（type-checked）lint 层：防类型逃逸回潮的护栏 =====
    // 范围刻意限定为 server 与 packages（此前 30+ 处手工断言、socket.data any 袋的所在地）：
    // typescript-eslint 的普通 TS program 无法解析跨文件 .vue 组件类型（那是 vue-tsc 的职责），
    // 对客户端 .vue/.ts 启用会批量误报 no-unsafe-*；客户端的类型严格性由
    // `pnpm typecheck`（vue-tsc strict + strictTemplates + vue-augmentations）把关，
    // 覆盖面与精度均高于 type-aware lint。test/** 亦不启用（测试替身 as unknown as 属惯例，
    // 配置块级豁免而非 inline disable，保持生产源码零 eslint-disable 的记录）。
    files: ['apps/server/src/**/*.ts', 'packages/*/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // projectService：按文件就近解析 tsconfig 获得类型信息
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    extends: [tseslint.configs.recommendedTypeChecked],
    rules: {
      // 非空断言：生产源码必须显式守卫或可选链（保留项须带中文理由的定点豁免注释）。
      '@typescript-eslint/no-non-null-assertion': 'error',
      // switch 对联合类型必须穷尽，防漏分支（server/packages 当前无 switch，属前瞻护栏）。
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // 异步事件回调（scheduler 回调返回 Promise 被丢弃）属设计内语义，no-misused-promises 误报源。
      '@typescript-eslint/no-misused-promises': 'off',
      // 模板字符串宽松化：日志/错误文案大量 `${number}`/`${boolean}` 拼接属预期用法。
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: false },
      ],
    },
  },
  {
    // 客户端与共享包统一生效的「无需类型信息」断言护栏（不依赖 program）。
    files: ['apps/client/src/**/*.{ts,vue}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    // 防误提交聚焦用例（it.only / describe.only / fdescribe 等）导致 CI 只跑一个用例。
    files: ['test/**/*.{js,mjs,cjs,ts,mts,cts,tsx,vue}'],
    plugins: { 'no-only-tests': noOnlyTests },
    rules: {
      'no-only-tests/no-only-tests': 'error',
    },
  },
  {
    // 该文件用 RuleTester.itOnly = it.only 为 RuleTester 提供聚焦能力，属测试工具配置而非聚焦用例。
    files: ['test/unit/eslint-custom-rules.spec.ts'],
    rules: {
      'no-only-tests/no-only-tests': 'off',
    },
  },
])
