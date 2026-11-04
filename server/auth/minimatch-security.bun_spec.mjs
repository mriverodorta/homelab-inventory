import { expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { newEnforcer, newModel, StringAdapter } from 'casbin'

const require = createRequire(import.meta.url)
const casbinRequire = createRequire(require.resolve('casbin'))
const { Minimatch } = casbinRequire('minimatch')

test('Casbin minimatch bounds globstar-parent expansion (CVE-2026-118764)', () => {
  // Eight segments reproduce the unbounded expansion without hanging an old build.
  const matcher = new Minimatch(Array(8).fill('**/../a/b').join('/'), {
    optimizationLevel: 2,
    braceExpandMax: 64,
  })
  expect(matcher.set.length).toBeLessThanOrEqual(64)
  expect(matcher.match(Array(8).fill('../a/b').join('/'))).toBe(true)
})

test('patched glob matching preserves Casbin authorization decisions', async () => {
  const model = newModel(`
[request_definition]
r = sub, obj, act
[policy_definition]
p = sub, obj, act
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = r.sub == p.sub && globMatch(r.obj, p.obj) && r.act == p.act
`)
  const enforcer = await newEnforcer(model, new StringAdapter('p, reader, /projects/*/inventory/**, read'))
  expect(await enforcer.enforce('reader', '/projects/1/inventory/servers/2', 'read')).toBe(true)
  expect(await enforcer.enforce('reader', '/projects/1/inventory/servers/2', 'write')).toBe(false)
  expect(await enforcer.enforce('reader', '/projects/1/secrets/2', 'read')).toBe(false)
  expect(await enforcer.enforce('other', '/projects/1/inventory/servers/2', 'read')).toBe(false)
})
