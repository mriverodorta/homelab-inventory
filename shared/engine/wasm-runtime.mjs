function asBytes(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  throw new TypeError('WASM payload must be an ArrayBuffer or Uint8Array.')
}

function assertExports(exports) {
  const requiredFunctions = [
    'engine_alloc',
    'engine_dealloc',
    'engine_create',
    'engine_dispatch',
    'engine_result_len',
    'engine_destroy',
  ]

  if (!(exports.memory instanceof WebAssembly.Memory)) {
    throw new TypeError('Engine WASM module does not export memory.')
  }
  for (const name of requiredFunctions) {
    if (typeof exports[name] !== 'function') {
      throw new TypeError(`Engine WASM module does not export ${name}().`)
    }
  }
}

export class WasmEngineRuntime {
  constructor(exports) {
    assertExports(exports)
    this.exports = exports
  }

  static async instantiate(source) {
    let instantiated
    if (source instanceof Response) {
      instantiated = await WebAssembly.instantiateStreaming(source)
    } else {
      instantiated = await WebAssembly.instantiate(asBytes(source))
    }
    const instance = instantiated instanceof WebAssembly.Instance
      ? instantiated
      : instantiated.instance
    return new WasmEngineRuntime(instance.exports)
  }

  create(snapshotBytes) {
    return this.#withInput(snapshotBytes, (pointer, length) => {
      const handle = this.exports.engine_create(pointer, length)
      if (!Number.isInteger(handle) || handle < 1) {
        throw new Error('Unable to initialize the workspace engine snapshot.')
      }
      return handle
    })
  }

  dispatch(handle, requestBytes) {
    if (!Number.isInteger(handle) || handle < 1) {
      throw new TypeError('Engine handle must be a positive integer.')
    }

    return this.#withInput(requestBytes, (pointer, length) => {
      const resultPointer = this.exports.engine_dispatch(handle, pointer, length)
      const resultLength = this.exports.engine_result_len()
      if (!Number.isInteger(resultPointer) || resultPointer < 1 || !Number.isInteger(resultLength) || resultLength < 1) {
        throw new Error('Workspace engine returned an invalid response buffer.')
      }

      try {
        const view = new Uint8Array(this.exports.memory.buffer, resultPointer, resultLength)
        return Uint8Array.from(view)
      } finally {
        this.exports.engine_dealloc(resultPointer, resultLength)
      }
    })
  }

  destroy(handle) {
    if (!Number.isInteger(handle) || handle < 1) return false
    return this.exports.engine_destroy(handle) === 1
  }

  #withInput(value, callback) {
    const bytes = asBytes(value)
    if (bytes.byteLength < 1) throw new TypeError('Engine payload must not be empty.')
    const pointer = this.exports.engine_alloc(bytes.byteLength)
    if (!Number.isInteger(pointer) || pointer < 1) {
      throw new Error('Workspace engine could not allocate an input buffer.')
    }

    try {
      new Uint8Array(this.exports.memory.buffer, pointer, bytes.byteLength).set(bytes)
      return callback(pointer, bytes.byteLength)
    } finally {
      this.exports.engine_dealloc(pointer, bytes.byteLength)
    }
  }
}
