export type HomelabEngineExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory
  engine_alloc(length: number): number
  engine_dealloc(pointer: number, length: number): void
  engine_create(pointer: number, length: number): number
  engine_dispatch(handle: number, pointer: number, length: number): number
  engine_result_len(): number
  engine_destroy(handle: number): number
}

export class WasmEngineRuntime {
  constructor(exports: HomelabEngineExports)
  static instantiate(source: Response | ArrayBuffer | Uint8Array): Promise<WasmEngineRuntime>
  create(snapshotBytes: ArrayBuffer | Uint8Array): number
  dispatch(handle: number, requestBytes: ArrayBuffer | Uint8Array): Uint8Array
  destroy(handle: number): boolean
}
