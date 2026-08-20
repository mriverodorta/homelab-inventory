import { describe, expect, test } from 'bun:test'
import { TRIVY_IMAGE, trivyCommand } from './trivy.mjs'

describe('Trivy release scanner', () => {
  test('pins the scanner image and mounts an ephemeral database cache volume', () => {
    const command = trivyCommand(['image', '--download-db-only'])
    expect(command).toContain(TRIVY_IMAGE)
    expect(command).toContain('homelab-inventory-trivy-cache:/root/.cache/')
    expect(command.slice(-2)).toEqual(['image', '--download-db-only'])
  })

  test('mounts Docker only for final-image scans', () => {
    const command = trivyCommand(['image', 'candidate'], { dockerSocket: true })
    expect(command).toContain('/var/run/docker.sock:/var/run/docker.sock')
    expect(command.indexOf('/var/run/docker.sock:/var/run/docker.sock')).toBeLessThan(command.indexOf(TRIVY_IMAGE))
  })
})
