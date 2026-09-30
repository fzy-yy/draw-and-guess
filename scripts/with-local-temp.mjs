#!/usr/bin/env node
/**
 * 用「仓库内临时目录」运行一条命令的构建包装器。
 *
 * 为什么需要：esbuild 只在**单次 transform 输入超过 1 MiB** 时才把输入落盘成临时文件
 * （`node_modules/.pnpm/esbuild@<版本>/.../lib/main.js` 的 `input.length > 1024 * 1024` 分支），
 * 路径取 `os.tmpdir()`，随后由 **esbuild 的原生（Go）二进制**读取并删除它。部分 Windows 机器上，
 * 系统 `%TEMP%` 上的安全软件会拦下这次删除——实测是**按进程**拦（同一目录下 node.exe 自建自删
 * 0/40 失败，而 esbuild.exe 100% 报 `remove …: Access is denied.`），而 Vite 压缩主 chunk 时
 * 把压缩前源码（>1 MiB）整体交给 esbuild，于是 `vite build` 在这类机器上**必然**失败。
 * 把临时目录指到仓库内可写目录即可绕开。
 * 取舍（为什么改构建契约而不是只修机器）见 docs/adr/0038-repo-local-build-temp-dir.md。
 *
 * 用法：node scripts/with-local-temp.mjs <命令> [参数…]
 * 约定：命令经 shell 解析（Windows 下 pnpm/vite 实为 .cmd 垫片，不经 shell 找不到），
 * 调用点只传不含空格的固定串。
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
// 显式导入 process：本仓库 ESLint 未给 .mjs 声明 Node 全局（与 scripts/ 下既有脚本同一约定）。
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** 仓库根：本文件位于 <root>/scripts/ 下。 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 临时目录取 node_modules/.cache 下：既有 .gitignore 覆盖（node_modules 已忽略），
 * 不污染工作区，也不受系统 %TEMP% 策略与安全软件扫描的影响。
 */
const tempDir = path.join(repoRoot, 'node_modules', '.cache', 'draw-guess-tmp')
mkdirSync(tempDir, { recursive: true })

const command = process.argv.slice(2).join(' ')
if (command === '') {
  process.stderr.write('用法：node scripts/with-local-temp.mjs <命令> [参数…]\n')
  process.exit(2)
}

// TMPDIR 在 Windows 上同样优先于 TEMP/TMP（Node os.tmpdir 的取值顺序），三个都设以免漏改。
const child = spawn(command, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir },
})

child.on('error', (error) => {
  process.stderr.write(`[with-local-temp] 命令启动失败：${error.message}\n`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  // 被信号终止时没有退出码：统一回 1，避免把「未正常结束」伪装成成功。
  process.exit(signal ? 1 : (code ?? 1))
})
