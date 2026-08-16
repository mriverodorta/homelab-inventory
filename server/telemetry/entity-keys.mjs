function required(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new Error(`${label} identity is required.`)
  return normalized
}

export function serviceKey(value) {
  return `${required(value.manager ?? value.serviceManager ?? 'systemd', 'service manager')}\0${required(value.name ?? value.key, 'service')}`
}

export function containerKey(value) {
  return `${required(value.runtime, 'container runtime')}\0${required(value.runtimeId ?? value.id, 'container')}`
}

export function mountKey(value) {
  return required(value.mountPoint ?? value.mount ?? value.key, 'filesystem mount')
}

export function deviceKey(value) {
  return required(value.deviceId ?? value.device ?? value.key ?? value.name, 'storage device')
}

export function gpuKey(value) {
  return required(value.id ?? value.pciAddress ?? value.uuid ?? value.key ?? value.name, 'GPU')
}

export function sensorKey(value) {
  return required(value.key ?? value.id ?? value.name, 'sensor')
}
