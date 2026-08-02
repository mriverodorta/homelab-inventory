import express from 'express'
import { COMPLETE_BACKUP_SECTIONS, DEMO_BACKUP_SECTIONS } from '../shared/backup/contract.mjs'
import { BackupService, BackupServiceError } from './backup/backup-service.mjs'

const uploadParser = express.raw({ type: 'application/x-homelab-inventory-backup', limit: '512mb' })

function numberId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : null
}

function passphrase(request) {
  const value = request.get('x-backup-passphrase')
  return value && value.length > 0 ? value : null
}

function respondError(response, error) {
  if (error instanceof BackupServiceError) {
    response.status(error.status).json({ message: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) })
    return
  }
  console.error('[backup] Request failed.', error instanceof Error ? error.message : error)
  response.status(500).json({ message: 'Backup operation failed.', code: 'backup-error' })
}

function run(response, operation) {
  void operation().catch((error) => respondError(response, error))
}

export function registerBackupRoutes(app, { service, scheduler, withStore, demo = false, appVersion }) {
  if (demo) {
    app.get('/api/backups', (_request, response) => {
      response.json({ mode: 'demo', backups: [], restores: [], operation: null, maintenance: false, policy: 'export-only' })
    })
    app.post('/api/backups/demo-export', (request, response) => {
      run(response, async () => withStore(request, response, async (store) => {
        const demoService = new BackupService({ store, appVersion, mode: 'demo' })
        const result = await demoService.create({ sections: DEMO_BACKUP_SECTIONS, label: 'Demo sandbox', persist: false, demo: true })
        response.set({
          'Content-Type': 'application/x-homelab-inventory-backup',
          'Content-Disposition': `attachment; filename="homelab-inventory-demo-${appVersion}.hlibackup"`,
          'Content-Length': String(result.archive.length),
        }).send(result.archive)
      }))
    })
    for (const route of ['/api/backups', '/api/backups/:id/verify', '/api/backups/:id/download', '/api/backups/:id', '/api/backups/schedule', '/api/backups/inspect', '/api/backups/restore/preflight', '/api/backups/restore']) {
      app.all(route, (_request, response) => response.status(403).json({ message: 'Demo sessions only support safe sandbox export.', code: 'demo-backup-policy' }))
    }
    return
  }

  app.get('/api/backups', (_request, response) => {
    run(response, async () => response.json(await service.storageSummary()))
  })

  app.post('/api/backups', (request, response) => {
    run(response, async () => {
      if (demo) throw new BackupServiceError('Demo sessions cannot store backups.', { code: 'demo-backup-policy', status: 403 })
      const result = await service.create({
        sections: request.body?.sections ?? COMPLETE_BACKUP_SECTIONS,
        label: request.body?.label,
        passphrase: request.body?.encryptStoredCopy ? request.body?.passphrase ?? null : null,
      })
      response.status(201).json({ record: result.record })
    })
  })

  app.post('/api/backups/:id/verify', (request, response) => {
    run(response, async () => response.json(await service.verify(numberId(request.params.id), request.body?.passphrase ?? null)))
  })

  app.post('/api/backups/:id/download', (request, response) => {
    run(response, async () => {
      const result = await service.download(numberId(request.params.id), request.body?.passphrase ?? null)
      response.set({
        'Content-Type': 'application/x-homelab-inventory-backup',
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Content-Length': String(result.archive.length),
      }).send(result.archive)
    })
  })

  app.delete('/api/backups/:id', (request, response) => {
    run(response, async () => response.json(await service.remove(numberId(request.params.id))))
  })

  app.patch('/api/backups/schedule', (request, response) => {
    run(response, async () => {
      if (demo) throw new BackupServiceError('Demo sessions cannot schedule backups.', { code: 'demo-backup-policy', status: 403 })
      response.json(await scheduler.update(request.body ?? {}))
    })
  })

  app.post('/api/backups/inspect', uploadParser, (request, response) => {
    run(response, async () => {
      if (demo) throw new BackupServiceError('Demo sessions cannot inspect backup uploads.', { code: 'demo-backup-policy', status: 403 })
      response.json(await service.inspect(request.body, passphrase(request)))
    })
  })

  app.post('/api/backups/restore/preflight', (request, response) => {
    run(response, async () => response.json(await service.preflight(request.body?.token, request.body?.sections)))
  })

  app.post('/api/backups/restore', (request, response) => {
    run(response, async () => {
      if (request.body?.confirmed !== true) throw new BackupServiceError('Restore confirmation is required.', { code: 'restore-confirmation-required' })
      response.json(await service.restore(request.body?.token, request.body?.sections))
    })
  })

  app.use('/api', (request, response, next) => {
    if (!service.isMaintenanceMode() || request.method === 'GET' || request.path.startsWith('/backups')) return next()
    response.status(503).json({ message: 'Restore is in progress. Changes are temporarily disabled.', code: 'restore-maintenance' })
  })
}
