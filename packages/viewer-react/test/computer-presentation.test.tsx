import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { createSharedSystemsModel } from '@homelab-inventory/viewer-model'
import { SharedSystemsViewer } from '../src/systems-viewer'
import { SharedInspector } from '../src/share-inspector'

it('shares the laptop label between systems, inspector and static social markup', async () => {
  const blob = JSON.parse(await readFile(resolve(process.cwd(), 'packages/share-contract/test/fixtures/systems-v1.json'), 'utf8'))
  blob.items[0].source = { type: 'custom', definition: { hardwareClass: 'laptop', usageRole: 'server' } }
  const model = createSharedSystemsModel(blob)
  const viewer = <SharedSystemsViewer model={model} onIntent={() => {}} />
  const inspector = <SharedInspector item={model.rows[0]!} onIntent={() => {}} />
  render(<>{viewer}{inspector}</>)
  expect(screen.getAllByText('Laptop')).toHaveLength(2)
  expect(renderToStaticMarkup(viewer)).toContain('Laptop')
  expect(renderToStaticMarkup(inspector)).toContain('Laptop')
  expect(model.rows[0]?.type).toBe('server')
})
