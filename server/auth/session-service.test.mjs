import { describe, expect, it } from 'vitest'
import { createAuthenticationStore, createOwnerAccount } from './model.mjs'
import { SessionService } from './session-service.mjs'

function fakeStore() {
  let state = createAuthenticationStore()
  state.accounts.push(createOwnerAccount(1, 'owner', 'Owner'))
  state.nextAccountId = 2
  return {
    getAuthenticationState: () => structuredClone(state),
    updateAuthentication: (mutator) => { mutator(state); return structuredClone(state) },
  }
}

describe('authentication sessions', () => {
  it('stores only a token hash and authenticates the opaque token', () => {
    const store = fakeStore()
    const service = new SessionService({ store, externalUrl: 'https://inventory.example' })
    const created = service.create(1)
    expect(store.getAuthenticationState().sessions[0].tokenHash).not.toBe(created.token)
    expect(service.authenticateToken(created.token)?.account.username).toBe('owner')
    expect(service.cookieOptions()).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true })
  })

  it('expires idle sessions and respects remembered idle duration', () => {
    let now = new Date('2026-08-02T00:00:00Z')
    const store = fakeStore()
    const service = new SessionService({ store, now: () => now })
    const regular = service.create(1)
    const remembered = service.create(1, { remember: true })
    now = new Date('2026-08-03T00:00:01Z')
    expect(service.authenticateToken(regular.token)).toBeNull()
    expect(service.authenticateToken(remembered.token)).not.toBeNull()
  })

  it('revokes one session without affecting another', () => {
    const store = fakeStore()
    const service = new SessionService({ store })
    const first = service.create(1)
    const second = service.create(1)
    expect(service.revoke(first.token)).toBe(true)
    expect(service.authenticateToken(first.token)).toBeNull()
    expect(service.authenticateToken(second.token)).not.toBeNull()
  })
})
