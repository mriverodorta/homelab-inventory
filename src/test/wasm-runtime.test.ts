import { describe, expect, it } from 'vitest'
import { WasmEngineRuntime, type HomelabEngineExports } from '../../shared/engine/wasm-runtime.mjs'

class FakeExports {
  memory = new WebAssembly.Memory({ initial: 1 })
  nextPointer = 64
  resultLength = 0
  deallocations: Array<[number, number]> = []

  engine_alloc(length: number) {
    const pointer = this.nextPointer
    this.nextPointer += length + 16
    return pointer
  }

  engine_dealloc(pointer: number, length: number) {
    this.deallocations.push([pointer, length])
  }

  engine_create(pointer: number, length: number) {
    return new Uint8Array(this.memory.buffer, pointer, length)[0] === 7 ? 3 : 0
  }

  engine_dispatch(_handle: number, pointer: number, length: number) {
    const request = new Uint8Array(this.memory.buffer, pointer, length)
    const resultPointer = this.engine_alloc(length)
    new Uint8Array(this.memory.buffer, resultPointer, length).set([...request].reverse())
    this.resultLength = length
    return resultPointer
  }

  engine_result_len() {
    return this.resultLength
  }

  engine_destroy(handle: number) {
    return handle === 3 ? 1 : 0
  }
}

describe('WasmEngineRuntime', () => {
  it('copies request and response bytes and releases both allocations', () => {
    const exports = new FakeExports()
    const runtime = new WasmEngineRuntime(exports as unknown as HomelabEngineExports)
    const request = Uint8Array.from([1, 2, 3, 4])

    expect(runtime.dispatch(3, request)).toEqual(Uint8Array.from([4, 3, 2, 1]))
    expect(exports.deallocations).toHaveLength(2)
    expect(request).toEqual(Uint8Array.from([1, 2, 3, 4]))
  })

  it('creates and destroys independent engine handles', () => {
    const exports = new FakeExports()
    const runtime = new WasmEngineRuntime(exports as unknown as HomelabEngineExports)

    expect(runtime.create(Uint8Array.from([7]))).toBe(3)
    expect(runtime.destroy(3)).toBe(true)
    expect(runtime.destroy(4)).toBe(false)
  })
})
