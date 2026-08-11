export type CoreMigration = Readonly<{
  id: string
  file: string
  sha256: string
}>

export const CORE_MIGRATIONS: readonly CoreMigration[] = []
