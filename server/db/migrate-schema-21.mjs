import { createAuthenticationStore } from '../auth/model.mjs'

export function migrateSchema20To21(current) {
  return {
    authentication: current ?? createAuthenticationStore({ setupRequired: false }),
    summary: {
      initializedAuthentication: current == null,
      authenticationEnabled: false,
    },
  }
}
