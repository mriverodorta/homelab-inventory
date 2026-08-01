import fs from 'node:fs/promises'
import path from 'node:path'

// Keep Vite's test transformer from trying to bundle Bun's runtime-only module.
const sqliteModule = ['bun', 'sqlite'].join(':')
const { Database } = await import(sqliteModule)

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

  async rebuild(snapshot, targetPath = this.filePath) {
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
      transaction(snapshot.templates)
      database.exec('PRAGMA optimize;')
    } finally {
      database.close()
    }
  }

  search({ query = '', type, manufacturer, limit = 30, offset = 0 } = {}) {
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
}
