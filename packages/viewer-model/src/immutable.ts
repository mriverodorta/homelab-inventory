export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
    : T extends readonly (infer Entry)[] ? readonly DeepReadonly<Entry>[]
      : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
        : T

export function deepFreeze<T>(value: T, active = new WeakSet<object>()): DeepReadonly<T> {
  if (value === null || typeof value !== 'object') return value as DeepReadonly<T>
  if (active.has(value)) throw new TypeError('Shared viewer models cannot contain cycles.')

  active.add(value)
  try {
    for (const entry of Object.values(value)) deepFreeze(entry, active)
    return Object.freeze(value) as DeepReadonly<T>
  } finally {
    active.delete(value)
  }
}
