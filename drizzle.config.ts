import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/persistence/core/schema/index.ts',
  out: './server/persistence/core/migrations/generated',
  strict: true,
  verbose: true,
})
