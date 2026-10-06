import tsParser from '@typescript-eslint/parser'
import { ESLint, RuleTester } from 'eslint'
import { describe, expect, it } from 'vitest'
import vueParser from 'vue-eslint-parser'
// 配置文件是运行时 JavaScript 模块；规则由同一导出供生产配置与 RuleTester 复用。
// @ts-expect-error JavaScript 配置文件没有独立声明文件。
import { projectConventions } from '../../eslint.config.js'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const vueRuleTester = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
})

const typescriptRuleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
})

vueRuleTester.run('ban-style-block', projectConventions.rules['ban-style-block'], {
  valid: [
    {
      filename: 'apps/client/src/CommentOnly.vue',
      code: `
        <template><div class="style-guide">ok</div></template>
        <!-- <style> 只是一段维护注释 -->
        <script setup>const diagnostic = '<style>example</style>'</script>
      `,
    },
  ],
  invalid: [
    {
      filename: 'apps/client/src/LocalStyle.vue',
      code: '<template><div /></template><style scoped>.card { color: red; }</style>',
      errors: [{ messageId: 'forbidden' }],
    },
  ],
})

vueRuleTester.run('ban-cjk-literal', projectConventions.rules['ban-cjk-literal'], {
  valid: [
    {
      filename: 'apps/client/src/Localized.vue',
      code: `
        <template>
          <!-- 中文维护注释不会展示给玩家 -->
          <button
            class="中文类名"
            :class="\`中文类名-\${variant}\`"
            :aria-label="labels.close"
            :title="labels.tip"
          >
            {{ strings.save }}
          </button>
        </template>
        <script setup lang="ts">
        const code = 7
        console.warn('开发期诊断')
        const issue = new Error(\`技术诊断：\${code}\`)
        </script>
      `,
    },
    {
      filename: 'test/fixtures/HardcodedCopy.vue',
      code: '<template><button aria-label="关闭">保存</button></template>',
    },
  ],
  invalid: [
    {
      filename: 'apps/client/src/TemplateText.vue',
      code: '<template><button>保存</button></template>',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      filename: 'apps/client/src/StaticAttributes.vue',
      code: '<template><input aria-label="昵称" title="玩家昵称" placeholder="请输入" /></template>',
      errors: [{ messageId: 'forbidden' }, { messageId: 'forbidden' }, { messageId: 'forbidden' }],
    },
    {
      filename: 'apps/client/src/ScriptLiteral.vue',
      code: "<template><div /></template><script setup>const label = '保存'</script>",
      errors: [{ messageId: 'forbidden' }],
    },
    {
      filename: 'apps/client/src/TemplateLiteral.vue',
      code: '<template><div /></template><script setup>const label = `玩家${name}`</script>',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      filename: 'apps/client/src/DynamicLiteral.vue',
      code: '<template><button :title="`玩家${name}`" /></template>',
      errors: [{ messageId: 'forbidden' }],
    },
  ],
})

vueRuleTester.run('ban-forbidden-utility', projectConventions.rules['ban-forbidden-utility'], {
  valid: [
    {
      filename: 'apps/client/src/Weights.vue',
      code: `
          <template>
            <!-- font-medium 与 font-[900] 只是一段说明 -->
            <div class="font-bold font-mediumish font-sans" :class="dynamicClass" />
          </template>
        `,
    },
  ],
  invalid: [
    {
      filename: 'apps/client/src/StaticWeight.vue',
      code: '<template><div class="font-medium text-white" /></template>',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      filename: 'apps/client/src/LightWeight.vue',
      code: '<template><div class="font-light" /></template>',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      filename: 'apps/client/src/ArbitraryWeight.vue',
      code: '<template><div class="font-black" /></template>',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      filename: 'apps/client/src/DynamicWeight.vue',
      code: `<template><div :class="active ? 'font-semibold' : 'font-normal'" /></template>`,
      errors: [{ messageId: 'forbidden' }],
    },
  ],
})

typescriptRuleTester.run(
  'require-server-runtime',
  projectConventions.rules['require-server-runtime'],
  {
    valid: [
      `
        function schedule(clock, random, scheduler) {
          // Date.now()、Math.random() 与 setTimeout() 仅出现在说明中。
          const epoch = new Date(0)
          return [clock.now(), random.integer(4), scheduler.set(10, () => epoch)]
        }
      `,
    ],
    invalid: [
      {
        code: 'const now = Date.now()',
        errors: [{ messageId: 'clock' }],
      },
      {
        code: 'const now = new Date()',
        errors: [{ messageId: 'clock' }],
      },
      {
        code: 'const value = Math.random()',
        errors: [{ messageId: 'random' }],
      },
      {
        code: 'const timer = setTimeout(task, 10)',
        errors: [{ messageId: 'scheduler' }],
      },
      {
        code: 'const timer = globalThis.setInterval(task, 10)',
        errors: [{ messageId: 'scheduler' }],
      },
    ],
  },
)

describe('eslint.config.js 规则作用域', () => {
  const eslint = new ESLint({ overrideConfigFile: 'eslint.config.js' })

  async function ruleIds(code: string, filePath: string): Promise<Array<string | null>> {
    const [result] = await eslint.lintText(code, { filePath })
    return result?.messages.map((message) => message.ruleId) ?? []
  }

  it('默认禁止 console，仅在明确的控制台适配层放行', async () => {
    const regular = await ruleIds(
      'export function run() { console.log("debug") }',
      'apps/client/src/stores/console-example.ts',
    )
    const adapters = await Promise.all([
      ruleIds('console.log("banner")', 'apps/server/src/index.ts'),
      ruleIds('console.warn("manifest")', 'apps/client/src/audio/runtime.ts'),
    ])

    expect(regular).toContain('no-console')
    expect(adapters.flat()).not.toContain('no-console')
  })

  it('domain/application/protocol 与权威纯函数目录启用运行时禁令，runtime 适配层放行', async () => {
    // 注意：type-checked lint 层启用 projectService 后，虚拟的不存在路径会因无法归属 tsconfig
    // 项目而致命报错，因此作用域断言必须借用**真实存在**的文件路径（内容仍是合成的）。
    const governedFiles = [
      'apps/server/src/domain/session/session-service.ts',
      'apps/server/src/application/room-publisher.ts',
      'apps/server/src/protocol/binder.ts',
      'apps/server/src/snapshot.ts',
      'apps/server/src/scoring.ts',
      'apps/server/src/hint-scheduler.ts',
    ]
    const governed = await Promise.all(
      governedFiles.map((filePath) => ruleIds('export const now = Date.now()', filePath)),
    )
    const runtime = await ruleIds('export const now = Date.now()', 'apps/server/src/runtime.ts')

    for (const messages of governed) {
      expect(messages).toContain('project-conventions/require-server-runtime')
    }
    expect(runtime).not.toContain('project-conventions/require-server-runtime')
  })

  it('业务模块（modules/）与 core 机制层同样受运行时禁令约束，只有真实适配层放行', async () => {
    // 缺陷回归：目录纵切重构后业务模块搬到 modules/，而禁令作用域仍停留在 domain/ 等旧路径，
    // 于是 modules/chat 里的 `Math.random()` 逃过 ESLint 直接进了生产代码（污染快照解码）。
    const governedFiles = [
      'apps/server/src/modules/chat/chat.service.ts',
      'apps/server/src/modules/gameplay/round-machine.ts',
      'apps/server/src/modules/relay/relay.service.ts',
      'apps/server/src/core/config.ts',
    ]
    const governedRandom = await Promise.all(
      governedFiles.map((filePath) => ruleIds('export const roll = Math.random()', filePath)),
    )
    const governedClock = await Promise.all(
      governedFiles.map((filePath) => ruleIds('export const now = Date.now()', filePath)),
    )

    for (const messages of [...governedRandom, ...governedClock]) {
      expect(messages).toContain('project-conventions/require-server-runtime')
    }

    // 唯一把抽象绑定到真实 Date/crypto/Node timer 的适配层（core/runtime.ts）与基础设施实现
    // （infra 的日志/迁移，属技术适配而非领域规则）保持放行。
    const adapters = await Promise.all([
      ruleIds('export const now = Date.now()', 'apps/server/src/core/runtime.ts'),
      ruleIds('export const now = Date.now()', 'apps/server/src/infra/logging/file-logger.ts'),
      ruleIds('export const at = Date.now()', 'apps/server/src/infra/sqlite/migrate.ts'),
    ])
    for (const messages of adapters) {
      expect(messages).not.toContain('project-conventions/require-server-runtime')
    }
  })

  it('客户端 stores/composables 的 .ts 同样禁止硬编码中文，audio 资源诊断不受影响', async () => {
    const storeCopy = await ruleIds(
      "export const label = '保存'",
      'apps/client/src/stores/copy-example.ts',
    )
    const composableCopy = await ruleIds(
      'export const label = `玩家${name}`',
      'apps/client/src/composables/copy-example.ts',
    )
    const resourceDiagnostic = await ruleIds(
      "export const detail = '资源缺失'",
      'apps/client/src/audio/diagnostic-example.ts',
    )

    expect(storeCopy).toContain('project-conventions/ban-cjk-literal')
    expect(composableCopy).toContain('project-conventions/ban-cjk-literal')
    expect(resourceDiagnostic).not.toContain('project-conventions/ban-cjk-literal')
  })
})
