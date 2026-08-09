import { describe, expect, it } from 'vitest'
import { resolveJedecManufacturer } from './jep106-manufacturers.mjs'

describe('JEDEC manufacturer resolution', () => {
  it('resolves a dmidecode bank and parity-coded manufacturer ID', () => {
    expect(resolveJedecManufacturer('Bank 6, Hex 0xF7')).toBe('Avant Technology')
  })

  it('rejects malformed, invalid-parity, zero, and unsupported codes', () => {
    expect(resolveJedecManufacturer('Bank 6, Hex 0x77')).toBeNull()
    expect(resolveJedecManufacturer('Bank 0, Hex 0xF7')).toBeNull()
    expect(resolveJedecManufacturer('Bank 99, Hex 0xF7')).toBeNull()
    expect(resolveJedecManufacturer('Bank 6, Hex 0x00')).toBeNull()
    expect(resolveJedecManufacturer('not a JEDEC identifier')).toBeNull()
    expect(resolveJedecManufacturer(null)).toBeNull()
  })
})
