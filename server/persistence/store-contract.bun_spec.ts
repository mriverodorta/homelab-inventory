import { describe, expect, test } from 'bun:test'

const MUTABLE_STORE_ACCESS = /\bstore\.databases\??\./
describe('persistence store contract', () => {
  test('production routes never access mutable store databases', async () => {
    const routeSources = ['server/index.mjs']
    for await (const file of new Bun.Glob('server/**/*routes.mjs').scan('.')) routeSources.push(file)
    const offenders = []
    for (const file of routeSources.sort()) {
      const source = await Bun.file(file).text()
      if (MUTABLE_STORE_ACCESS.test(source)) offenders.push(file)
    }

    expect(offenders).toEqual([])
  })
})
