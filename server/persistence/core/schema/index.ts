import * as inventoryBase from './inventory-base.ts'
import * as projectBase from './project-base.ts'
import * as projects from './projects.ts'
import * as system from './system.ts'
import * as vocabularies from './vocabularies.ts'

export * from './inventory-base.ts'
export * from './project-base.ts'
export * from './projects.ts'
export * from './system.ts'
export * from './vocabularies.ts'

export const coreSchema = {
  ...system,
  ...projectBase,
  ...projects,
  ...inventoryBase,
  ...vocabularies,
}
