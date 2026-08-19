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
  {
    id: '0011_archived_project_deletion',
    file: '0010_archived_project_deletion.sql',
    sha256: '384f6463286ed5428c7d574d8294f7c3e7e97d1cfc0bdc51351deb805f7bfec3',
  },
  {
    id: '0012_project_compatibility_policies',
    file: '0011_project_compatibility_policies.sql',
    sha256: '65b2842e5be1e2a4987d9ae340392b9c10bac2440fea261ca9273fdf6d2ea26a',
  },
  {
    id: '0013_distinct_ddr3l_memory',
    file: '0012_distinct_ddr3l_memory.sql',
    sha256: 'bdb7f6c20b7f0b3227cc7789f9348907c102546cea8ddae1ba31117c6f65e364',
  },
  {
    id: '0014_automatic_registry_updates',
    file: '0013_automatic_registry_updates.sql',
    sha256: '51894551751fd3854be2cf5fac10081a408953d9c6f956eee60f0eb4a8e7f076',
  },
  {
    id: '0015_nas_contract_v10',
    file: '0014_nas_contract_v10.sql',
    sha256: 'a32dc9cbe731d7249b516ff24c6df9666c2ff66530375153f4d0672efb44735f',
  },
  {
    id: '0016_nonnegative_port_slots',
    file: '0015_nonnegative_port_slots.sql',
    sha256: 'b6db8f99c3e126ead69de48324d292a27540299087413d9d0bf2afe18fb2ce67',
  },
  {
    id: '0017_registry_update_reconciliation',
    file: '0016_registry_update_reconciliation.sql',
    sha256: '67399cdff32dcc6ebfa0bbdb929cd505254c7467c98fa54596b8b861c5afc1d1',
  },
  {
    id: '0018_network_adapter_v11',
    file: '0017_network_adapter_v11.sql',
    sha256: '816835c4442aa749cdcfe367ac33af9fe63b1c257e0eeec06a28c43e53e8eaaf',
  },
  {
    id: '0019_m2_metadata_repair',
    file: '0018_m2_metadata_repair.sql',
    sha256: '6942beaa6f35b7c1616f667c0950032a9acf63163c8b78a5e85262968e921100',
  },
  {
    id: '0020_systems_workspace_operations',
    file: '0019_systems_workspace_operations.sql',
    sha256: '0ba9da14a422a8dd66f9aa1e7603fc21dfe5b271cee42d0c4d17506a8af3360e',
  },
  {
    id: '0021_registry_update_evaluator_version',
    file: '0020_registry_update_evaluator_version.sql',
    sha256: 'a41df993402ae7197eb07b0623c80c86907e0bc6eb2bd825aee8b148a8cd734e',
  },
  {
    id: '0022_canonical_compatibility_audit',
    file: '0021_canonical_compatibility_audit.sql',
    sha256: '10daf8ce5063ea3204b7375837caadd8393f8e7c91739c568861915f9a513b11',
  },
  {
    id: '0023_m2_ae_contract_v12',
    file: '0022_m2_ae_contract_v12.sql',
    sha256: '72dabd37787c6ea711996993fbbfb076b4ff0ea4390f7d13f3074f1a5b21d446',
  },
  {
    id: '0024_m2_ae_projection_repair',
    file: '0023_m2_ae_projection_repair.sql',
    sha256: '666bcc9274f1e530f54900d8332d0465725042e460bbbc1d7261952d3f6c8af4',
  },
  {
    id: '0025_compatibility_evaluator_v2',
    file: '0024_compatibility_evaluator_v2.sql',
    sha256: 'f85a713d0db1046ea59584dd23197f5c8829d8a28ecbd63987b44a7b33f93601',
  },
  {
    id: '0026_inventory_metadata',
    file: '0025_inventory_metadata.sql',
    sha256: 'bf56e4220e56401df793d7ad0ae78056b7d89896924e947ef3becff7342398a5',
  },
]
