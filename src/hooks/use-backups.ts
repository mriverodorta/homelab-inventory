import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createBackup,
  deleteBackup,
  downloadBackup,
  inspectBackup,
  loadBackupStatus,
  preflightRestore,
  restoreBackup,
  updateBackupSchedule,
  verifyBackup,
} from '@/lib/backup-api'

export const BACKUPS_QUERY_KEY = ['backups'] as const

export function useBackups() {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: BACKUPS_QUERY_KEY })
  return {
    status: useQuery({ queryKey: BACKUPS_QUERY_KEY, queryFn: loadBackupStatus }),
    create: useMutation({ mutationFn: createBackup, onSuccess: refresh }),
    remove: useMutation({ mutationFn: deleteBackup, onSuccess: refresh }),
    verify: useMutation({ mutationFn: ({ id, passphrase }: { id: number; passphrase?: string }) => verifyBackup(id, passphrase), onSuccess: refresh }),
    download: useMutation({ mutationFn: ({ id, passphrase }: { id: number; passphrase?: string }) => downloadBackup(id, passphrase) }),
    inspect: useMutation({ mutationFn: ({ file, passphrase }: { file: File; passphrase?: string }) => inspectBackup(file, passphrase) }),
    preflight: useMutation({ mutationFn: ({ token, sections }: { token: string; sections: Parameters<typeof preflightRestore>[1] }) => preflightRestore(token, sections) }),
    restore: useMutation({ mutationFn: ({ token, sections }: { token: string; sections: Parameters<typeof restoreBackup>[1] }) => restoreBackup(token, sections), onSuccess: refresh }),
    schedule: useMutation({ mutationFn: updateBackupSchedule, onSuccess: refresh }),
  }
}
