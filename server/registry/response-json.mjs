export const MAX_REGISTRY_RESPONSE_BYTES = 1 * 1024 * 1024

async function responseText(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('Registry response exceeded the maximum allowed size.')
  }

  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) throw new Error('Registry response exceeded the maximum allowed size.')
    return text
  }

  const reader = response.body.getReader()
  const chunks = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel()
      throw new Error('Registry response exceeded the maximum allowed size.')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), received).toString('utf8')
}

export async function readRegistryJson(response, { maxBytes = MAX_REGISTRY_RESPONSE_BYTES } = {}) {
  const text = await responseText(response, maxBytes)
  if (text.trim() === '') return null
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Registry returned an invalid JSON response.')
  }
}

export function registryErrorMessage(payload, fallback, status) {
  const remoteMessage = typeof payload?.message === 'string' && payload.message.length <= 240
    ? payload.message
    : null
  return remoteMessage ?? `${fallback} (HTTP ${status}).`
}

export async function expectRegistryJson(response, fallback, options) {
  const payload = await readRegistryJson(response, options)
  if (!response.ok) {
    throw new Error(registryErrorMessage(payload, fallback, response.status))
  }
  return payload
}
