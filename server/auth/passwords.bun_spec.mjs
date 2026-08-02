import { describe, expect, test } from 'bun:test'
import { hashPassword, verifyPassword } from './passwords.mjs'

describe('local authentication password hashing', () => {
  test('uses Bun argon2id hashes without storing plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toStartWith('$argon2id$')
    expect(hash).not.toContain('correct horse')
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(await verifyPassword('incorrect horse battery staple', hash)).toBe(false)
  })
})
