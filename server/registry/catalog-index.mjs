import fs from 'node:fs/promises'
import path from 'node:path'
import { CATALOG_INDEX_SCHEMA_VERSION } from './catalog-index-contract.mjs'
import { projectCatalogTemplateForRuntime } from './catalog-runtime-projection.mjs'

// Keep Vite's test transformer from trying to bundle Bun's runtime-only module.
const sqliteModule = ['bun', 'sqlite'].join(':')
const { Database } = await import(sqliteModule)

export { CATALOG_INDEX_SCHEMA_VERSION } from './catalog-index-contract.mjs'

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&')
}

function searchableText(template) {
  const item = template.item
  return [
    item.name,
    item.manufacturer,
    item.family,
    item.model,
    item.number,
    ...(Array.isArray(item.aliases) ? item.aliases : []),
    item.specs?.chipset,
    item.specs?.boardRevision,
    ...(Array.isArray(item.compatibility?.host?.cpu?.sockets)
      ? item.compatibility.host.cpu.sockets
      : []),
    ...(Array.isArray(item.compatibility?.host?.cpu?.generations)
      ? item.compatibility.host.cpu.generations
      : []),
    template.productFamily?.physicalClass,
    template.variantEvidence?.label,
    template.variantEvidence?.motherboardPartNumber,
    template.variantEvidence?.motherboardRevision,
    template.variantEvidence?.variantKey,
    template.variantEvidence?.structuralSummary,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('en-US')
}

function parseOptionalJson(value) {
  return value == null ? undefined : JSON.parse(value)
}

function valuesAtPath(value, pathSegments) {
  if (pathSegments.length === 0) {
    if (Array.isArray(value)) return value.flatMap((entry) => valuesAtPath(entry, []))
    return value == null ? [] : [value]
  }
  if (Array.isArray(value)) return value.flatMap((entry) => valuesAtPath(entry, pathSegments))
  if (!value || typeof value !== 'object') return []
  const [head, ...tail] = pathSegments
  return valuesAtPath(value[head], tail)
}

function uniqueScalarValues(item, key) {
  const values = valuesAtPath(item, key.split('.'))
    .filter((value) => ['string', 'number', 'boolean'].includes(typeof value))
  return [...new Set(values.map((value) => String(value)))]
}

function catalogRow(row) {
  return {
    templateKey: row.template_key,
    revision: row.revision,
    fingerprintVersion: row.fingerprint_version,
    identityHash: row.identity_hash,
    identityAliases: parseOptionalJson(row.identity_aliases_json) ?? [],
    contentHash: row.content_hash,
    type: row.type,
    manufacturer: row.manufacturer,
    name: row.name,
    productFamily: parseOptionalJson(row.product_family_json),
    variantEvidence: parseOptionalJson(row.variant_evidence_json),
    item: JSON.parse(row.item_json),
  }
}

export class CatalogIndex {
  constructor(filePath) {
    this.filePath = filePath
  }

  async rebuild(snapshot, targetPath = this.filePath, facets = null) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.rm(targetPath, { force: true })
    const database = new Database(targetPath, { create: true })
    try {
      database.exec(`
        PRAGMA journal_mode = DELETE;
        CREATE TABLE templates (
          template_key TEXT PRIMARY KEY,
          revision INTEGER NOT NULL,
          fingerprint_version INTEGER NOT NULL,
          identity_hash TEXT NOT NULL UNIQUE,
          identity_aliases_json TEXT,
          content_hash TEXT NOT NULL,
          type TEXT NOT NULL,
          manufacturer TEXT,
          name TEXT NOT NULL,
          product_family_json TEXT,
          variant_evidence_json TEXT,
          searchable TEXT NOT NULL,
          item_json TEXT NOT NULL
        );
        CREATE INDEX templates_type_index ON templates(type);
        CREATE INDEX templates_manufacturer_index ON templates(manufacturer);
        CREATE TABLE facet_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload_json TEXT NOT NULL
        );
        CREATE TABLE facet_terms (
          template_key TEXT NOT NULL,
          type TEXT NOT NULL,
          facet_key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (template_key, facet_key, value),
          FOREIGN KEY (template_key) REFERENCES templates(template_key) ON DELETE CASCADE
        );
        CREATE INDEX facet_terms_lookup_index ON facet_terms(type, facet_key, value, template_key);
        CREATE TABLE facet_numbers (
          template_key TEXT NOT NULL,
          type TEXT NOT NULL,
          facet_key TEXT NOT NULL,
          value REAL NOT NULL,
          PRIMARY KEY (template_key, facet_key, value),
          FOREIGN KEY (template_key) REFERENCES templates(template_key) ON DELETE CASCADE
        );
        CREATE INDEX facet_numbers_lookup_index ON facet_numbers(type, facet_key, value, template_key);
        PRAGMA user_version = ${CATALOG_INDEX_SCHEMA_VERSION};
      `)
      const insert = database.prepare(`
        INSERT INTO templates (
          template_key, revision, fingerprint_version, identity_hash,
          identity_aliases_json, content_hash, type, manufacturer, name,
          product_family_json, variant_evidence_json, searchable, item_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const transaction = database.transaction((templates) => {
        for (const template of templates) {
          const item = template.item
          insert.run(
            template.templateKey,
            template.revision,
            template.fingerprintVersion,
            template.identityHash,
            template.identityAliases?.length ? JSON.stringify(template.identityAliases) : null,
            template.contentHash,
            item.type,
            item.manufacturer ?? null,
            item.name,
            template.productFamily ? JSON.stringify(template.productFamily) : null,
            template.variantEvidence ? JSON.stringify(template.variantEvidence) : null,
            searchableText(template),
            JSON.stringify(item),
          )
        }
      })
      const runtimeTemplates = snapshot.templates.map(projectCatalogTemplateForRuntime)
      transaction(runtimeTemplates)
      if (facets) {
        database.prepare('INSERT INTO facet_metadata (id, payload_json) VALUES (1, ?)').run(JSON.stringify(facets))
        const categories = new Map(facets.categories.map((category) => [category.type, category]))
        const insertTerm = database.prepare('INSERT OR IGNORE INTO facet_terms (template_key, type, facet_key, value) VALUES (?, ?, ?, ?)')
        const insertNumber = database.prepare('INSERT OR IGNORE INTO facet_numbers (template_key, type, facet_key, value) VALUES (?, ?, ?, ?)')
        const facetTransaction = database.transaction((templates) => {
          for (const template of templates) {
            const category = categories.get(template.item.type)
            if (!category) continue
            for (const facet of category.facets) {
              const values = uniqueScalarValues(template.item, facet.key)
              if (facet.kind === 'terms') {
                for (const value of values) insertTerm.run(template.templateKey, template.item.type, facet.key, value)
              } else {
                for (const value of values) {
                  const numeric = Number(value)
                  if (Number.isFinite(numeric)) insertNumber.run(template.templateKey, template.item.type, facet.key, numeric)
                }
              }
            }
          }
        })
        facetTransaction(runtimeTemplates)
      }
      database.exec('PRAGMA optimize;')
    } finally {
      database.close()
    }
  }

  isCurrent() {
    const database = new Database(this.filePath, { readonly: true })
    try {
      return Number(database.query('PRAGMA user_version').get().user_version) === CATALOG_INDEX_SCHEMA_VERSION
    } finally {
      database.close()
    }
  }

  verifyRuntime({ templateCount, facetCategoryCount = 0 } = {}) {
    const database = new Database(this.filePath, { readonly: true, strict: true })
    try {
      const integrity = database.query('PRAGMA quick_check').get().quick_check
      if (integrity !== 'ok') throw new Error(`Catalog index integrity check failed: ${String(integrity)}`)
      const schemaVersion = Number(database.query('PRAGMA user_version').get().user_version)
      if (schemaVersion !== CATALOG_INDEX_SCHEMA_VERSION) {
        throw new Error('Catalog index schema version is invalid.')
      }
      const foreignKeys = database.query('PRAGMA foreign_key_check').all()
      if (foreignKeys.length !== 0) throw new Error('Catalog index contains invalid foreign-key relationships.')
      const actualTemplateCount = Number(database.query('SELECT COUNT(*) AS count FROM templates').get().count)
      if (Number.isSafeInteger(templateCount) && actualTemplateCount !== templateCount) {
        throw new Error('Catalog index template count does not match its receipt.')
      }
      const facetRow = database.query('SELECT payload_json FROM facet_metadata WHERE id = 1').get()
      const actualFacetCategoryCount = facetRow
        ? JSON.parse(facetRow.payload_json).categories?.length ?? 0
        : 0
      if (actualFacetCategoryCount !== facetCategoryCount) {
        throw new Error('Catalog index facet count does not match its receipt.')
      }
      return {
        schemaVersion,
        templateCount: actualTemplateCount,
        facetCategoryCount: actualFacetCategoryCount,
      }
    } finally {
      database.close(false)
    }
  }

  verify(snapshot, facets = null) {
    const database = new Database(this.filePath, { readonly: true, strict: true })
    try {
      const integrity = database.query('PRAGMA quick_check').get().quick_check
      if (integrity !== 'ok') throw new Error(`Catalog index integrity check failed: ${String(integrity)}`)
      if (Number(database.query('PRAGMA user_version').get().user_version) !== CATALOG_INDEX_SCHEMA_VERSION) {
        throw new Error('Catalog index schema version is invalid.')
      }
      const foreignKeys = database.query('PRAGMA foreign_key_check').all()
      if (foreignKeys.length !== 0) throw new Error('Catalog index contains invalid foreign-key relationships.')
      const templates = database.query('SELECT template_key, content_hash, searchable FROM templates ORDER BY template_key').all()
      const expected = [...snapshot.templates]
        .sort((left, right) => left.templateKey.localeCompare(right.templateKey))
        .map((template) => ({ template_key: template.templateKey, content_hash: template.contentHash }))
      if (templates.length !== expected.length) throw new Error('Catalog index template count does not match its snapshot.')
      for (const [index, row] of templates.entries()) {
        if (row.template_key !== expected[index].template_key || row.content_hash !== expected[index].content_hash) {
          throw new Error(`Catalog index template ${String(row.template_key)} does not match its snapshot.`)
        }
        if (typeof row.searchable !== 'string' || !row.searchable.trim()) {
          throw new Error(`Catalog index template ${String(row.template_key)} is not searchable.`)
        }
      }
      const facetRow = database.query('SELECT payload_json FROM facet_metadata WHERE id = 1').get()
      if (facets) {
        if (!facetRow || facetRow.payload_json !== JSON.stringify(facets)) {
          throw new Error('Catalog index facet metadata does not match its signed artifact.')
        }
      } else if (facetRow) {
        throw new Error('Catalog index contains unexpected facet metadata.')
      }
      return {
        schemaVersion: CATALOG_INDEX_SCHEMA_VERSION,
        templateCount: templates.length,
        facetCategoryCount: facets?.categories?.length ?? 0,
      }
    } finally {
      database.close(false)
    }
  }

  facets() {
    const database = new Database(this.filePath, { readonly: true })
    try {
      const row = database.query('SELECT payload_json FROM facet_metadata WHERE id = 1').get()
      return row ? { available: true, ...JSON.parse(row.payload_json) } : { available: false, categories: [] }
    } finally {
      database.close()
    }
  }

  search({ query = '', type, manufacturer, terms = {}, ranges = {}, limit = 30, offset = 0 } = {}) {
    const database = new Database(this.filePath, { readonly: true })
    try {
      const clauses = []
      const parameters = []
      const cleanQuery = String(query).trim().toLocaleLowerCase('en-US')
      if (cleanQuery) {
        clauses.push("searchable LIKE ? ESCAPE '\\'")
        parameters.push(`%${escapeLike(cleanQuery)}%`)
      }
      if (type) {
        clauses.push('type = ?')
        parameters.push(type)
      }
      if (manufacturer) {
        clauses.push('manufacturer = ? COLLATE NOCASE')
        parameters.push(manufacturer)
      }
      for (const [facetKey, rawValues] of Object.entries(terms)) {
        const values = [...new Set((Array.isArray(rawValues) ? rawValues : [rawValues]).map(String).filter(Boolean))]
        if (values.length === 0) continue
        clauses.push(`EXISTS (
          SELECT 1 FROM facet_terms selected_terms
          WHERE selected_terms.template_key = templates.template_key
            AND selected_terms.facet_key = ?
            AND selected_terms.value IN (${values.map(() => '?').join(', ')})
        )`)
        parameters.push(facetKey, ...values)
      }
      for (const [facetKey, bounds] of Object.entries(ranges)) {
        const minimum = Number(bounds?.minimum)
        const maximum = Number(bounds?.maximum)
        if (!Number.isFinite(minimum) && !Number.isFinite(maximum)) continue
        const rangeClauses = ['selected_numbers.template_key = templates.template_key', 'selected_numbers.facet_key = ?']
        const rangeParameters = [facetKey]
        if (Number.isFinite(minimum)) {
          rangeClauses.push('selected_numbers.value >= ?')
          rangeParameters.push(minimum)
        }
        if (Number.isFinite(maximum)) {
          rangeClauses.push('selected_numbers.value <= ?')
          rangeParameters.push(maximum)
        }
        clauses.push(`EXISTS (SELECT 1 FROM facet_numbers selected_numbers WHERE ${rangeClauses.join(' AND ')})`)
        parameters.push(...rangeParameters)
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
      const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 30))
      const boundedOffset = Math.max(0, Number(offset) || 0)
      const total = database.query(`SELECT COUNT(*) AS count FROM templates ${where}`).get(...parameters).count
      const rows = database.query(`
        SELECT template_key, revision, fingerprint_version, identity_hash, identity_aliases_json,
          content_hash, type, manufacturer, name, product_family_json, variant_evidence_json, item_json
        FROM templates
        ${where}
        ORDER BY name COLLATE NOCASE, template_key
        LIMIT ? OFFSET ?
      `).all(...parameters, boundedLimit, boundedOffset)
      return {
        total,
        limit: boundedLimit,
        offset: boundedOffset,
        hasMore: boundedOffset + rows.length < total,
        nextOffset: boundedOffset + rows.length < total ? boundedOffset + rows.length : null,
        items: rows.map(catalogRow),
      }
    } finally {
      database.close()
    }
  }

  getByKey(templateKey) {
    const database = new Database(this.filePath, { readonly: true })
    try {
      const row = database.query(`
        SELECT template_key, revision, fingerprint_version, identity_hash, identity_aliases_json,
          content_hash, type, manufacturer, name, product_family_json, variant_evidence_json, item_json
        FROM templates
        WHERE template_key = ?
      `).get(templateKey)
      if (!row) return null
      return catalogRow(row)
    } finally {
      database.close()
    }
  }

  getByKeys(templateKeys) {
    const keys = [...new Set(templateKeys.map(String).filter(Boolean))]
    if (keys.length === 0) return []
    const database = new Database(this.filePath, { readonly: true })
    try {
      const rows = []
      for (let offset = 0; offset < keys.length; offset += 500) {
        const chunk = keys.slice(offset, offset + 500)
        rows.push(...database.query(`
          SELECT template_key, revision, fingerprint_version, identity_hash, identity_aliases_json,
            content_hash, type, manufacturer, name, product_family_json, variant_evidence_json, item_json
          FROM templates
          WHERE template_key IN (${chunk.map(() => '?').join(', ')})
        `).all(...chunk))
      }
      const byKey = new Map(rows.map((row) => [row.template_key, catalogRow(row)]))
      return keys.flatMap((key) => byKey.has(key) ? [byKey.get(key)] : [])
    } finally {
      database.close()
    }
  }
}
