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
  {
    id: '0002_typed_inventory',
    file: '0001_typed_inventory.sql',
    sha256: '71874847ed1a75e45cc22f2534fd5743ee801fd75661c3148df311b376269b09',
  },
  {
    id: '0003_hardware_topology',
    file: '0002_hardware_topology.sql',
    sha256: '54fd554de003c606fca39b10b627c41796e7210b06814d2845e4982be6f1bc3a',
  },
]
