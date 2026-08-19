export function dateTimeInputValue(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function canonicalDateFilterValue(value: string, dateTime: boolean) {
  if (!value) return null
  if (!dateTime) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}
