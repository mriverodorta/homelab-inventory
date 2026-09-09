import { expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { newEnforcer, newModel, StringAdapter } from 'casbin'

// Resolve the parser Casbin actually loads, including any nested installation.
const require = createRequire(import.meta.url)
const casbinRequire = createRequire(require.resolve('casbin'))
const { parse } = casbinRequire('csv-parse/sync')

test('duplicate prototype headers cannot replace CSV record prototypes (CVE-2026-85063)', () => {
  const [record] = parse('__proto__,__proto__,name\nfirst,second,example', {
    columns: true,
    group_columns_by_name: true,
  })
  expect(Object.getPrototypeOf(record)).toBe(Object.prototype)
  expect(Object.hasOwn(record, '__proto__')).toBe(true)
  expect(record.__proto__).toEqual(['first', 'second'])
  expect(record.name).toBe('example')
  expect(Object.hasOwn(record, '0')).toBe(false)
  expect(record[0]).toBeUndefined()
})

test('patched Casbin CSV loading preserves comments, quoted fields and enforcement', async () => {
  const model = newModel(`
[request_definition]
r = sub, obj, act
[policy_definition]
p = sub, obj, act
[role_definition]
g = _, _
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = g(r.sub, p.sub) && r.obj == p.obj && r.act == p.act
`)
  const enforcer = await newEnforcer(model, new StringAdapter([
    '# local synthetic policy',
    '',
    'p, reader, "inventory, lab", read',
    'g, alice, reader',
  ].join('\n')))
  expect(await enforcer.enforce('alice', 'inventory, lab', 'read')).toBe(true)
  expect(await enforcer.enforce('alice', 'inventory, lab', 'write')).toBe(false)
  expect(await enforcer.enforce('bob', 'inventory, lab', 'read')).toBe(false)
})
