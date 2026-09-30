import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 构建临时目录守卫（取舍见 docs/adr/0038-repo-local-build-temp-dir.md）。
 *
 * 背景：esbuild 只在单次 transform 输入超过 1 MiB 时把输入落盘成临时文件到 `os.tmpdir()`，
 * 随后由它的原生二进制删除；系统 `%TEMP%` 上的安全软件会按进程拦下这次删除（实测 esbuild.exe
 * 100% 被拒、node.exe 同目录同操作 0/40 失败），而 Vite 压缩主 chunk 的输入稳定超过 1 MiB，
 * 于是 `vite build` 在这类机器上必然失败。修复是把构建的临时目录固定到仓库内——这两条断言
 * 正是该修复的契约与行为，缺一即回归。
 */
const root = process.cwd()
const WRAPPER = 'scripts/with-local-temp.mjs'

describe('构建临时目录固定在仓库内', () => {
  it('客户端构建脚本经 with-local-temp 包装', () => {
    const clientPackage = JSON.parse(
      readFileSync(resolve(root, 'apps/client/package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    // 三条根入口（build / test:e2e / package:dist）都汇入这条命令，包装它即全覆盖。
    expect(clientPackage.scripts?.build).toContain(WRAPPER)
  })

  it('包装器把 TEMP/TMP/TMPDIR 都指向仓库内目录', () => {
    // 命令刻意不含空格与引号：包装器经 shell 解析，含空格会被拆词（与真实调用点的约定一致）。
    const output = execFileSync(
      process.execPath,
      [
        resolve(root, WRAPPER),
        'node',
        '-p',
        '[process.env.TEMP,process.env.TMP,process.env.TMPDIR].join()',
      ],
      { cwd: root, encoding: 'utf8' },
    )
    const [temp = '', tmp = '', tmpdir = ''] = output.trim().split(',')

    expect(temp).not.toBe('')
    expect(tmp).toBe(temp)
    expect(tmpdir).toBe(temp)
    // 必须落在仓库内：这正是绕开系统 %TEMP% 拦截的关键，也是本包装存在的全部理由。
    expect(temp.startsWith(`${resolve(root)}${path.sep}`)).toBe(true)
  })
})
