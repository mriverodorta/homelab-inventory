import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerWorkspaceRoutes } from './workspace-routes.mjs'

const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function fixture() {
  const store = {
    createWorkspace: vi.fn((_projectId, input) => ({ project: { id: 1 }, created: input })),
    reorderWorkspaces: vi.fn((_projectId, ids) => ({ workspaceIds: ids })),
    setDefaultWorkspace: vi.fn((_projectId, workspaceId) => ({ defaultWorkspaceId: workspaceId })),
    updateWorkspaceMetadata: vi.fn((_projectId, workspaceId, changes) => {
      if (workspaceId === 1) throw new Error('The Systems workspace name, icon, and color are fixed.')
      return { workspaceId, changes }
    }),
    archiveWorkspace: vi.fn((_projectId, workspaceId) => ({ archivedWorkspaceId: workspaceId })),
    getWorkspace: vi.fn((projectId, workspaceId) => {
      if (projectId !== 1 || workspaceId !== 2) {
        throw new Error(`Active workspace ${workspaceId} was not found in project ${projectId}.`)
      }
      return { id: 'default', revision: 4, metadata: { projectId, workspaceId } }
    }),
    setWorkspace: vi.fn((projectId, workspaceId, project) => ({
      ...project,
      metadata: { ...project.metadata, projectId, workspaceId },
    })),
  }
  const app = express()
  app.use(express.json())
  registerWorkspaceRoutes(app, {
    withStore: async (_request, response, handler) => {
      try { await handler(store) } catch (error) { response.status(500).json({ message: error.message }) }
    },
  })
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener))
  })
  servers.push(server)
  return { store, url: `http://127.0.0.1:${server.address().port}` }
}

async function requestJson(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { response, body: await response.json() }
}

describe('workspace routes', () => {
  it('loads and saves a numeric project-scoped Canvas workspace', async () => {
    const { store, url } = await fixture()
    const loaded = await requestJson(`${url}/api/projects/1/workspaces/2`)
    expect(loaded.response.status).toBe(200)
    expect(loaded.body).toMatchObject({ metadata: { projectId: 1, workspaceId: 2 } })

    const saved = await requestJson(`${url}/api/projects/1/workspaces/2`, 'PUT', loaded.body)
    expect(saved.response.status).toBe(200)
    expect(store.setWorkspace).toHaveBeenCalledWith(1, 2, loaded.body)
  })

  it('rejects malformed and cross-project workspace identities', async () => {
    const { url } = await fixture()
    expect((await requestJson(`${url}/api/projects/no/workspaces/2`)).response.status).toBe(400)
    expect((await requestJson(`${url}/api/projects/2/workspaces/2`)).response.status).toBe(404)
  })

  it('keeps Systems metadata immutable and validates reorder identities', async () => {
    const { store, url } = await fixture()
    const systems = await requestJson(`${url}/api/projects/1/workspaces/1`, 'PATCH', { name: 'Hosts' })
    expect(systems.response.status).toBe(409)

    const reordered = await requestJson(`${url}/api/projects/1/workspaces/reorder`, 'PUT', { workspaceIds: [3, 2] })
    expect(reordered.response.status).toBe(200)
    expect(store.reorderWorkspaces).toHaveBeenCalledWith(1, [3, 2])
  })
})
