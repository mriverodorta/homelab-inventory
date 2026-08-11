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
  {
    id: '0004_application_domains',
    file: '0003_application_domains.sql',
    sha256: '860fe36c0043559cf82ec566fcd112fd01984e93b51ab84769f889ae9885df5a',
  },
  {
    id: '0005_assignment_slots',
    file: '0004_assignment_slots.sql',
    sha256: '57f98fa68b42c97321af0fc0bde06c5a23d98eef024e59cb04033811f39da7ad',
  },
  {
    id: '0006_resource_group_aliases',
    file: '0005_resource_group_aliases.sql',
    sha256: '766ea0fb299967da140d2d3057031bc460fde7c07952a88669fb5012681967b4',
  },
  {
    id: '0007_archived_identity_deletion',
    file: '0006_archived_identity_deletion.sql',
    sha256: 'e55b41b960679e9e99d00fa48b429d19a98cb179731f826803a8723deaae8ce6',
  },
  {
    id: '0008_agent_identity_aliases',
    file: '0007_agent_identity_aliases.sql',
    sha256: 'a0e351e7d7351b4ca2bb7c14a52a675e14b7a7b56fbd885b96a6a040697bd693',
  },
  {
    id: '0009_mutable_unreferenced_identities',
    file: '0008_mutable_unreferenced_identities.sql',
    sha256: 'd9838996c54ccd55af74de4f68603c30d351d33046637235a6ca52910ee52cb5',
  },
  {
    id: '0010_registry_link_reconciliation',
    file: '0009_registry_link_reconciliation.sql',
    sha256: '4f73bd5407caf55b52c2f5c4ec1ef16bd9479f6e922cc888a5c3ec861ed27c49',
  },
]
