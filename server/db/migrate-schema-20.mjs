import { createBackupManagementStore } from '../backup/backup-model.mjs'

export function migrateSchema19To20(current) {
  return {
    backupManagement: current ?? createBackupManagementStore(),
    summary: {
      initializedBackupManagement: current == null,
    },
  }
}
