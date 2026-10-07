import { describe, expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const expressRequire = createRequire(require.resolve('express'))
const proxyaddr = expressRequire('proxy-addr')
const limiterRequire = createRequire(require.resolve('express-rate-limit'))
const casbinRequire = createRequire(require.resolve('casbin'))
const minimatchRequire = createRequire(casbinRequire.resolve('minimatch'))
const { Address4, Address6, AddressError } = limiterRequire('ip-address')
const { ipKeyGenerator } = require('express-rate-limit')

describe('Express proxy trust dependency security (CVE-2026-90711)', () => {
  test.each([
    ['::ffff:10.0.0.0/8'],
    ['::ffff:0.0.0.0/95'],
    ['::/1'],
    ['::ffff:10.0.0.0/8', '192.0.2.0/24'],
    ['::/1', '192.0.2.0/24'],
  ])('IPv6 trust %j cannot grant arbitrary IPv4 trust', (...subnets) => {
    const trust = proxyaddr.compile(subnets)
    expect(trust('203.0.113.9')).toBe(false)
    expect(trust('::ffff:203.0.113.9')).toBe(false)
  })

  test.each(['203.0.113.9', '::ffff:203.0.113.9'])('untrusted peer %s cannot forge forwarded client addresses', (remoteAddress) => {
    const app = require('express')()
    app.set('trust proxy', ['::ffff:10.0.0.0/8'])
    const request = Object.assign(Object.create(app.request), {
      app,
      socket: { remoteAddress },
      headers: { 'x-forwarded-for': '192.0.2.42' },
    })
    expect(request.ip).toBe(remoteAddress)
    expect(request.ips).toEqual([])
  })

  test('valid mapped, IPv4 and IPv6 subnets still trust only their intended clients', () => {
    for (const subnet of ['192.0.2.0/24', '::ffff:192.0.2.0/120']) {
      const trust = proxyaddr.compile(subnet)
      expect(trust('192.0.2.42')).toBe(true)
      expect(trust('::ffff:192.0.2.42')).toBe(true)
      expect(trust('203.0.113.9')).toBe(false)
      expect(trust('::1')).toBe(false)
      expect(proxyaddr({ socket: { remoteAddress: '192.0.2.42' }, headers: { 'x-forwarded-for': '203.0.113.9' } }, trust)).toBe('203.0.113.9')
    }
    const ipv6Trust = proxyaddr.compile('2001:db8::/32')
    expect(ipv6Trust('2001:db8::1')).toBe(true)
    expect(ipv6Trust('2001:db9::1')).toBe(false)
    expect(ipv6Trust('192.0.2.42')).toBe(false)
  })
})

describe('rate limiter IP dependency security', () => {
  test('mapped IPv4 representations share one rate-limit bucket', () => {
    expect(ipKeyGenerator('::ffff:c000:22a')).toBe(ipKeyGenerator('::ffff:192.0.2.42'))
    expect(ipKeyGenerator('::ffff:c000:22a')).toBe('192.0.2.42')
  })

  test('dotted IPv6 suffixes cannot escape the subnet or collide with IPv4 clients', () => {
    expect(ipKeyGenerator('2001:db8:1234:5678::192.0.2.42')).toBe('2001:db8:1234:5600::/56')
    expect(ipKeyGenerator('2001:db8:1234:5678::192.0.2.42'))
      .toBe(ipKeyGenerator('2001:db8:1234:5678::c000:22a'))
    expect(ipKeyGenerator('2001:db8::192.0.2.42')).not.toBe(ipKeyGenerator('192.0.2.42'))
    expect(ipKeyGenerator('64:ff9b::192.0.2.42')).toBe('64:ff9b::/56')
  })

  test('cross-family addresses cannot match a subnet (CVE-2026-101912)', () => {
    const v4 = new Address4('32.1.13.184')
    const v6 = new Address6('2001:db8::/32')
    for (const method of ['isInSubnet', 'isHostInSubnet']) {
      expect(v4[method](v6)).toBe(false)
      expect(new Address6('cb00:7100::1')[method](new Address4('203.0.113.0/24'))).toBe(false)
      expect(new Address6('2001:db8::1')[method](v6)).toBe(true)
    }
  })

  test('local-use NAT64 remains private (CVE-2026-101910)', () => {
    expect(new Address6('64:ff9b:1::7f00:1').isPrivate()).toBe(true)
    expect(new Address6('64:ff9b:1:7f00:0:100::').isPrivate()).toBe(true)
    expect(new Address6('2001:db8::1').isPrivate()).toBe(false)
  })

  test('the whole fe80::/10 range is link-local (CVE-2026-101913)', () => {
    for (const address of ['fe80::1', 'fe90::1', 'febf::1']) {
      expect(new Address6(address).isLinkLocal()).toBe(true)
    }
    expect(new Address6('fec0::1').isLinkLocal()).toBe(false)
  })

  test('oversized IPv6 input has no expanded diagnostic (CVE-2026-101911)', () => {
    const input = '!'.repeat(4096)
    expect(Address6.isValid(input)).toBe(false)
    let error
    try { new Address6(input) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(AddressError)
    expect(error.parseMessage).toBeUndefined()
    expect(error.message.length).toBeLessThan(256)
  })

  test('rate-limit keys retain IPv4 and IPv6 subnet behavior', () => {
    expect(ipKeyGenerator('192.0.2.42')).toBe('192.0.2.42')
    expect(ipKeyGenerator('2001:db8::1', 56)).toBe('2001:db8::/56')
    expect(ipKeyGenerator('2001:db8::abcd', 56)).toBe(ipKeyGenerator('2001:db8::1', 56))
    expect(ipKeyGenerator('2001:db8:100::1', 56)).not.toBe(ipKeyGenerator('2001:db8::1', 56))
  })
})

describe('authorization glob dependency security', () => {
  test('Casbin resolves patched brace expansion', () => {
    expect(Bun.semver.satisfies(minimatchRequire('brace-expansion/package.json').version, '>=5.0.12 <6')).toBe(true)
    const { minimatch } = casbinRequire('minimatch')
    expect(minimatch('/api/systems/42', '/api/{systems,canvas}/*')).toBe(true)
    expect(minimatch('/api/admin/42', '/api/{systems,canvas}/*')).toBe(false)
  })

  // Bound CPU time in a child so a vulnerable parser cannot hang the test runner.
  test.each([
    ['CVE-2026-102276', "'{' + '{a},'.repeat(8000) + 'b}'"],
    ['CVE-2026-102278', "'{'.repeat(4000) + 'a,b' + '}'.repeat(4000)"],
    ['CVE-2026-102277', "'{a}' + '}'.repeat(64000) + ',z}'"],
  ])('%s malformed braces remain bounded', (_cve, expression) => {
    const entry = minimatchRequire.resolve('brace-expansion')
    const result = spawnSync(process.execPath, ['-e', `
      const { expand } = require(${JSON.stringify(entry)});
      const result = expand(${expression}, { max: 10, maxLength: 100000 });
      if (!Array.isArray(result) || result.length > 10) process.exit(1);
      process.stdout.write('bounded');
    `], { timeout: 3000, maxBuffer: 4096, encoding: 'utf8' })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('bounded')
  })
})
