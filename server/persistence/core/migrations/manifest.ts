export type CoreMigration = Readonly<{
  id: string
  file: string
  sha256: string
}>

export const CORE_MIGRATIONS: readonly CoreMigration[] = [
  {
    id: '0001_sqlite_foundation',
    file: '0000_sqlite_foundation.sql',
    sha256: 'd0e2207a15d332da0102b55d2fbbe4d01531d60e182bf6bb1d3f416e051937f0',
  },
]
