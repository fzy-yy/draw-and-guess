import { describe, expect, it } from 'vitest'
import {
  BUNDLED_NODE_MAJOR,
  MIN_NODE_MAJOR,
  buildNodeDistUrl,
  buildNodeIndexUrl,
  buildNodeShasumsUrl,
  buildNodeZipName,
  parseNodeShasumsEntry,
  pickLatestBundledNode,
} from '../../apps/server/src/build/node-dist.ts'

/** 分发内置 Node 的版本解析、下载地址拼接与 SHASUMS 完整性条目提取（纯函数）。 */
describe('分发内置 Node 版本解析', () => {
  it('从索引中选最新的稳定 v24.x（排除预发布/其它主版本/非法项）', () => {
    const index = [
      { version: 'v25.1.0' },
      { version: 'v24.2.0' },
      { version: 'v24.10.3' },
      { version: 'v24.9.0' },
      { version: 'v24.11.0-rc.1' },
      { version: 'v22.20.0' },
      { version: 'v24.3.0' },
      null,
      'invalid',
    ]
    expect(pickLatestBundledNode(index)).toBe('24.10.3')
  })

  it('主版本线两位数时正则随常量联动（不会误配 v240 之类）', () => {
    expect(BUNDLED_NODE_MAJOR).toBe(24)
    expect(MIN_NODE_MAJOR).toBe(22)
    // 把 24 的候选混进带歧义前缀的假版本号：正则按段精确匹配，不会选中 240/24x 形式。
    const index = [{ version: 'v240.1.0' }, { version: 'v24.1.0' }, { version: 'v24x.1.0' }]
    expect(pickLatestBundledNode(index)).toBe('24.1.0')
  })

  it('索引里没有该主版本线稳定版时抛错', () => {
    expect(() => pickLatestBundledNode([{ version: 'v22.1.0' }])).toThrow()
  })

  it('索引格式非法时抛错', () => {
    expect(() => pickLatestBundledNode({ nope: true })).toThrow()
  })
})

describe('分发 Node 下载地址拼接', () => {
  it('zip 文件名是缓存与校验共用的单一口径', () => {
    expect(buildNodeZipName('24.10.3')).toBe('node-v24.10.3-win-x64.zip')
  })

  it('拼接 win-x64 下载地址并规范化末尾斜杠', () => {
    expect(buildNodeDistUrl('https://npmmirror.com/mirrors/node/', '24.10.3')).toBe(
      'https://npmmirror.com/mirrors/node/v24.10.3/node-v24.10.3-win-x64.zip',
    )
    expect(buildNodeDistUrl('https://nodejs.org/dist', '24.10.3')).toBe(
      'https://nodejs.org/dist/v24.10.3/node-v24.10.3-win-x64.zip',
    )
  })

  it('索引与 SHASUMS 地址同样规范化镜像尾斜杠', () => {
    expect(buildNodeIndexUrl('https://nodejs.org/dist')).toBe('https://nodejs.org/dist/index.json')
    expect(buildNodeShasumsUrl('https://nodejs.org/dist/', '24.10.3')).toBe(
      'https://nodejs.org/dist/v24.10.3/SHASUMS256.txt',
    )
  })
})

describe('SHASUMS256.txt 条目解析', () => {
  const hash = 'a'.repeat(64)
  const other = 'b'.repeat(64)

  it('从多条目文本中提取目标文件的哈希（含二进制 * 标记与 CRLF 行尾）', () => {
    const text = [
      `${hash}  node-v24.10.3-win-x64.zip`,
      `${other}  node-v24.10.3-win-x64.7z`,
      `${other}  *node-v24.10.3-x64.msi`,
      '',
    ].join('\r\n')
    expect(parseNodeShasumsEntry(text, 'node-v24.10.3-win-x64.zip')).toBe(hash)
  })

  it('大写哈希归一为小写', () => {
    const upper = 'A'.repeat(64)
    expect(parseNodeShasumsEntry(`${upper}  target.zip`, 'target.zip')).toBe(hash)
  })

  it('缺少目标条目时抛错（fail-fast，不允许放行未校验下载）', () => {
    expect(() => parseNodeShasumsEntry(`${hash}  other.zip`, 'target.zip')).toThrow(/target\.zip/)
    expect(() => parseNodeShasumsEntry('总 空 缺', 'target.zip')).toThrow()
  })

  it('哈希字段长度非法的行不视为有效条目', () => {
    expect(() => parseNodeShasumsEntry(`${'c'.repeat(63)}  target.zip`, 'target.zip')).toThrow()
  })
})
