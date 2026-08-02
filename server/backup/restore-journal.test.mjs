import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RestoreJournal } from './restore-journal.mjs'

describe('restore journal', () => {
  it('persists and clears an active restore', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-restore-'))
    const journal = new RestoreJournal(directory)
    await journal.write({ restoreId: 1, preRestoreBackupId: 2 })
    expect(await journal.read()).toEqual({ restoreId: 1, preRestoreBackupId: 2 })
    await journal.clear()
    expect(await journal.read()).toBeNull()
  })
})
