import { describe, expect, it } from 'vitest'
import { getDeploymentConfig } from '../../apps/server/src/config/index.ts'
import { serverPrivateConfig } from '../../apps/server/src/config/private.ts'

/**
 * 部署配置解析的严格口径（见 docs/adr/0035-startup-config-fail-fast.md）：
 * 显式写下的配置只要写法或取值不对，一律在启动期中止——静默取默认值会让「配置没生效」
 * 变成没有任何迹象的谜题（`PORT=1e3` 绑到 1000 端口、`LOG_ENABLED=ture` 关掉全部日志）。
 * 默认值一律从私有配置派生，不在用例里复抄常量。
 */
describe('部署配置解析', () => {
  it('未配置时取私有配置默认值', () => {
    const config = getDeploymentConfig({})
    expect(config.host).toBe(serverPrivateConfig.network.host)
    expect(config.port).toBe(serverPrivateConfig.network.port)
    expect(config.logEnabled).toBe(true)
    expect(config.healthMetricsEnabled).toBe(false)
  })

  it('PORT 只接受纯十进制正整数：Number() 会放过的写法一律拒绝并报实际取值', () => {
    // 十六进制、科学计数法、前导正号、小数、内部空格：写法必须唯一，否则「我明明写了 5174」还有别的解释。
    for (const invalid of ['1e3', '0x1502', '+5174', '5174.0', '5 174', '-1', 'abc']) {
      expect(() => getDeploymentConfig({ PORT: invalid }), invalid).toThrow(/PORT/u)
      expect(() => getDeploymentConfig({ PORT: invalid }), invalid).toThrow(invalid)
    }
    // 越界与写法不对是两种可读成因（前导零写法 `05174` 与 `0002` 同口径接受）。
    expect(() => getDeploymentConfig({ PORT: '65536' })).toThrow(/1～65535/u)
    expect(() => getDeploymentConfig({ PORT: '0' })).toThrow(/1～65535/u)
    expect(getDeploymentConfig({ PORT: '05174' }).port).toBe(5174)
  })

  it('PORT 纯空白走默认，不是「显式配置了 0 端口」', () => {
    expect(getDeploymentConfig({ PORT: '   ' }).port).toBe(serverPrivateConfig.network.port)
    expect(getDeploymentConfig({ PORT: ' 5174 ' }).port).toBe(5174)
  })

  it('LOG_MAX_FILES 与 PORT 共用同一写法闸：科学计数法与十六进制不再被静默接受', () => {
    // 此前用 Number() 解析：`1e1` 会被静默当成 10——与 ADR-0035「写法不对即中止」相悖。
    for (const invalid of ['1e1', '0x0a', '+10', '10.0']) {
      expect(() => getDeploymentConfig({ LOG_MAX_FILES: invalid }), invalid).toThrow(
        /LOG_MAX_FILES/u,
      )
    }
    // 越界与写法不对是两种可读成因（前导零写法 `005` 同口径接受）。
    expect(() => getDeploymentConfig({ LOG_MAX_FILES: '0' })).toThrow(/1～100/u)
    expect(() => getDeploymentConfig({ LOG_MAX_FILES: '101' })).toThrow(/1～100/u)
    expect(getDeploymentConfig({ LOG_MAX_FILES: '005' }).logMaxFiles).toBe(5)
  })

  it('HOST 非法形态在解析期中止，错误信息含实际取值', () => {
    const invalidHosts = [
      // 形态上明显在写 IP：越界、缺段、前导零、端口混入、缺方括号
      '256.1.1.1',
      '1.2.3',
      '010.1.1.1',
      ':::1',
      '10.0.0.1:80',
      '[::1',
      // 方括号只属于 IPv6、scope-id 绑定支持依赖平台：都比 isIP 更严地拒绝
      '[1.2.3.4]',
      'fe80::1%eth0',
      // RFC1123 之外的形态：下划线、首尾连字符、空标签、空白、路径分隔、根点、超长标签
      'a_b',
      '-abc',
      'abc-',
      'a..b',
      'a b',
      'a/b',
      'example.com.',
      `${'a'.repeat(64)}.com`,
    ]
    for (const invalid of invalidHosts) {
      expect(() => getDeploymentConfig({ HOST: invalid }), invalid).toThrow(invalid)
    }
    expect(() => getDeploymentConfig({ HOST: '256.1.1.1' })).toThrow(/IP 字面量/u)
    expect(() => getDeploymentConfig({ HOST: 'a_b' })).toThrow(/主机名/u)
  })

  it('HOST 合法形态原样保留（含大小写与方括号写法）', () => {
    for (const host of [
      '0.0.0.0',
      '127.0.0.1',
      '192.168.1.5',
      '::1',
      '[::1]',
      'localhost',
      'My-PC.local',
    ]) {
      expect(getDeploymentConfig({ HOST: host }).host, host).toBe(host)
    }
  })

  it('布尔变量：开/关两族等价写法均可，族外值中止并点名变量', () => {
    for (const on of ['1', 'true', 'YES', 'On', ' true ']) {
      expect(getDeploymentConfig({ LOG_ENABLED: on }).logEnabled, on).toBe(true)
    }
    for (const off of ['0', 'false', 'no', 'OFF', ' off ']) {
      expect(getDeploymentConfig({ LOG_ENABLED: off }).logEnabled, off).toBe(false)
    }
    for (const off of ['0', 'false']) {
      expect(getDeploymentConfig({ DRAW_GUESS_OPEN_BROWSER: off }).openBrowserEnabled, off).toBe(
        false,
      )
    }
    // 拼写错误不得静默按「关」处理：否则日志会无声消失，运维要到出事时才发现。
    expect(() => getDeploymentConfig({ LOG_ENABLED: 'ture' })).toThrow(/LOG_ENABLED/u)
    expect(() => getDeploymentConfig({ LOG_ENABLED: 'ture' })).toThrow('ture')
    expect(() => getDeploymentConfig({ HEALTH_METRICS_ENABLED: 'maybe' })).toThrow(
      /HEALTH_METRICS_ENABLED/u,
    )
    expect(() => getDeploymentConfig({ DRAW_GUESS_OPEN_BROWSER: '2' })).toThrow(
      /DRAW_GUESS_OPEN_BROWSER/u,
    )
    // 纯空白仍走默认（与其余配置项一致），只有拼错才中止。
    expect(getDeploymentConfig({ DRAW_GUESS_OPEN_BROWSER: '  ' }).openBrowserEnabled).toBe(true)
  })
})
