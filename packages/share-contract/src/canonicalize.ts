function canonicalize(value: unknown, active: WeakSet<object>, context: 'root' | 'object' | 'array'): string | undefined {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value)
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('Canonical JSON numbers must be finite.')
      return JSON.stringify(value)
    case 'undefined':
      if (context === 'object') return undefined
      throw new TypeError('Canonical JSON does not allow undefined array or root values.')
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new TypeError(`Canonical JSON does not support ${typeof value} values.`)
    case 'object':
      break
  }

  const object = value as object
  if (active.has(object)) throw new TypeError('Canonical JSON does not support cyclic values.')
  active.add(object)

  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalize(entry, active, 'array')).join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical JSON objects must be plain objects.')
    }

    const entries: string[] = []
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const serialized = canonicalize((value as Record<string, unknown>)[key], active, 'object')
      if (serialized !== undefined) entries.push(`${JSON.stringify(key)}:${serialized}`)
    }
    return `{${entries.join(',')}}`
  } finally {
    active.delete(object)
  }
}

export function canonicalShareJson(value: unknown): string {
  const serialized = canonicalize(value, new WeakSet(), 'root')
  if (serialized === undefined) throw new TypeError('Canonical JSON root value is undefined.')
  return serialized
}
