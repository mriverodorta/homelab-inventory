import { describe, expect, it } from 'vitest'
import {
  CPU_GENERATION_ALIAS_VERSION,
  canonicalCpuGenerationTokens,
} from '../../shared/compatibility/cpu-generation-aliases.mjs'

describe('CPU generation aliases', () => {
  it('canonicalizes arbitrary Intel ordinal product generations', () => {
    expect(CPU_GENERATION_ALIAS_VERSION).toBe(2)
    expect(canonicalCpuGenerationTokens('12th Gen')).toContain('product:intel:12th-gen')
    expect(canonicalCpuGenerationTokens('12th Generation')).toContain('product:intel:12th-gen')
    expect(canonicalCpuGenerationTokens('14th Gen')).toContain('product:intel:14th-gen')
    expect(canonicalCpuGenerationTokens('21st Generation')).toContain('product:intel:21st-gen')
  })

  it('keeps architecture and product-generation tokens distinct', () => {
    const architecture = canonicalCpuGenerationTokens('Zen 2')
    const product = canonicalCpuGenerationTokens('Ryzen PRO 4000')

    expect(architecture).toContain('architecture:amd:zen-2')
    expect(product).toContain('product:amd:ryzen-pro-4000')
    expect(architecture.some((token) => product.includes(token))).toBe(false)
  })
})
