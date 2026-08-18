function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function positive(value) {
  return finiteNonNegative(value) && value > 0
}

function boundedPercent(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

function freeBSDPressure(memory) {
  const hasPageCounters = ['pageCount', 'inactivePages', 'cachePages', 'laundryPages', 'freePages']
    .some((key) => memory?.[key] !== undefined && memory?.[key] !== null)
  if (!hasPageCounters) return undefined

  const { totalBytes, pageCount, inactivePages, freePages } = memory
  const cachePages = memory.cachePages ?? 0
  const laundryPages = memory.laundryPages ?? 0
  const arcBytes = memory.zfsArcBytes ?? 0
  if (
    !positive(totalBytes) || !Number.isSafeInteger(pageCount) || pageCount <= 0
    || !Number.isSafeInteger(inactivePages) || inactivePages < 0
    || !Number.isSafeInteger(cachePages) || cachePages < 0
    || !Number.isSafeInteger(laundryPages) || laundryPages < 0
    || !Number.isSafeInteger(freePages) || freePages < 0
    || !finiteNonNegative(arcBytes)
  ) return null

  const reclaimablePages = inactivePages + cachePages + laundryPages + freePages
  if (!Number.isSafeInteger(reclaimablePages) || reclaimablePages > pageCount) return null
  const usedBeforeARC = ((pageCount - reclaimablePages) / pageCount) * totalBytes
  return boundedPercent((Math.max(0, usedBeforeARC - arcBytes) / totalBytes) * 100)
}

export function memoryPressurePercent(memory) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) return null

  const freeBSD = freeBSDPressure(memory)
  if (freeBSD !== undefined) return freeBSD

  if (memory.availableBytes !== undefined && memory.availableBytes !== null) {
    if (!positive(memory.totalBytes) || !finiteNonNegative(memory.availableBytes) || memory.availableBytes > memory.totalBytes) return null
    return boundedPercent(((memory.totalBytes - memory.availableBytes) / memory.totalBytes) * 100)
  }

  if (memory.usedPercent !== undefined && memory.usedPercent !== null) {
    return boundedPercent(memory.usedPercent)
  }

  if (memory.usedBytes !== undefined || memory.totalBytes !== undefined) {
    if (!positive(memory.totalBytes) || !finiteNonNegative(memory.usedBytes) || memory.usedBytes > memory.totalBytes) return null
    return boundedPercent((memory.usedBytes / memory.totalBytes) * 100)
  }

  return null
}
