import { useEffect, useMemo, useState } from 'react'
import { Archive, CheckCircle2, Clock3, Download, FileUp, HardDrive, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EnvironmentValue, SettingRow, SettingsSection } from '@/components/settings/settings-primitives'
import { useBackups } from '@/hooks/use-backups'
import { downloadDemoBackup, type BackupInspection, type BackupRecord, type BackupSchedule, type BackupSectionDefinition, type BackupSectionName, type BackupStatus, type RestorePreflight } from '@/lib/backup-api'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
type Definitions = Record<BackupSectionName, BackupSectionDefinition> | undefined

function bytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

function SectionChecklist({ definitions, available, selected, onChange }: { definitions: Definitions; available: BackupSectionName[]; selected: BackupSectionName[]; onChange: (sections: BackupSectionName[]) => void }) {
  if (!definitions) return null
  return <div className="grid gap-2 sm:grid-cols-2">{available.map((name) => {
    const definition = definitions[name]
    return <label key={name} className="flex min-w-0 cursor-pointer items-start gap-3 rounded-md border border-[#ded8ce] bg-white p-3">
      <Checkbox className="mt-0.5" checked={selected.includes(name)} onCheckedChange={(checked) => onChange(checked ? [...selected, name] : selected.filter((entry) => entry !== name))} />
      <span className="min-w-0"><span className="block text-sm font-black text-[#20242c]">{definition.label}</span><span className="mt-0.5 block text-xs leading-5 text-[#756d62]">{definition.description}</span>{definition.sensitive ? <span className="mt-1 block text-[11px] font-bold uppercase text-[#8b5b18]">Contains credentials</span> : null}</span>
    </label>
  })}</div>
}

function CreateBackupDialog({ open, onOpenChange, sections, definitions, onCreate, busy }: { open: boolean; onOpenChange: (open: boolean) => void; sections: BackupSectionName[]; definitions: Definitions; onCreate: (input: { label: string; sections: BackupSectionName[]; encryptStoredCopy: boolean; passphrase?: string }) => Promise<void>; busy: boolean }) {
  const [mode, setMode] = useState<'complete' | 'custom'>('complete')
  const [selected, setSelected] = useState(sections)
  const [label, setLabel] = useState('Complete backup')
  const [encrypted, setEncrypted] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const effective = mode === 'complete' ? sections : selected
  const authenticationSelected = effective.includes('authentication')
  const effectiveEncrypted = encrypted || authenticationSelected
  async function submit() {
    setError(null)
    try { await onCreate({ label, sections: effective, encryptStoredCopy: effectiveEncrypted, passphrase: effectiveEncrypted ? passphrase : undefined }); onOpenChange(false) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Backup could not be created.') }
  }
  return <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>Create backup</DialogTitle><DialogDescription>Store a verified portable snapshot in this installation.</DialogDescription></DialogHeader>
    <Tabs value={mode} onValueChange={(value) => setMode(value as 'complete' | 'custom')}><TabsList variant="line"><TabsTrigger value="complete">Complete</TabsTrigger><TabsTrigger value="custom">Custom</TabsTrigger></TabsList><TabsContent value="complete" className="pt-4 text-sm leading-6 text-[#665d52]">Includes every portable application section. Backup history itself is never archived recursively.</TabsContent><TabsContent value="custom" className="pt-4"><SectionChecklist definitions={definitions} available={sections} selected={selected} onChange={setSelected} /></TabsContent></Tabs>
    <label className="grid gap-1.5 text-sm font-bold">Label<Input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} /></label>
    <div className="flex items-center justify-between gap-4 rounded-md border border-[#ded8ce] bg-[#f8f4ed] p-3"><div><p className="text-sm font-black">Encrypt stored copy</p><p className="mt-1 text-xs leading-5 text-[#756d62]">{authenticationSelected ? 'Required because owner authentication is included.' : 'Use AES-256-GCM with a passphrase you must retain.'}</p></div><Switch checked={effectiveEncrypted} disabled={authenticationSelected} onCheckedChange={setEncrypted} /></div>
    {effectiveEncrypted ? <label className="grid gap-1.5 text-sm font-bold">Passphrase<Input type="password" autoComplete="new-password" minLength={12} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /><span className="text-xs font-normal text-[#756d62]">Use at least 12 characters. This passphrase cannot be recovered.</span></label> : null}
    {error ? <p role="alert" className="text-sm font-semibold text-[#9b3f32]">{error}</p> : null}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button><Button onClick={() => void submit()} disabled={busy || effective.length === 0 || !label.trim() || (effectiveEncrypted && passphrase.length < 12)}>{busy ? <LoaderCircle className="animate-spin" /> : <Archive />}Create backup</Button></DialogFooter>
  </DialogContent></Dialog>
}

function BackupCredentialDialog({ backup, action, open, onOpenChange, onSubmit, busy }: { backup: BackupRecord | null; action: 'download' | 'verify'; open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (passphrase: string) => Promise<void>; busy: boolean }) {
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  if (!backup) return null
  const needsPassphrase = backup.encrypted || (action === 'download' && backup.sections.some((section) => ['registryEnrollment', 'authentication', 'agents', 'agentTelemetry'].includes(section)))
  const title = action === 'download' ? 'Download backup' : 'Verify encrypted backup'
  return <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{needsPassphrase ? 'Enter the backup passphrase. It is used only for this operation and is not stored.' : 'Continue with this verified portable backup.'}</DialogDescription></DialogHeader>{needsPassphrase ? <label className="grid gap-1.5 text-sm font-bold">Passphrase<Input type="password" autoComplete="current-password" minLength={12} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label> : null}{error ? <p role="alert" className="text-sm font-semibold text-[#9b3f32]">{error}</p> : null}<DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={busy || (needsPassphrase && passphrase.length < 12)} onClick={() => void onSubmit(passphrase).then(() => onOpenChange(false)).catch((caught) => setError(caught instanceof Error ? caught.message : `${title} failed.`))}>{action === 'download' ? <Download /> : <CheckCircle2 />}{action === 'download' ? 'Download' : 'Verify'}</Button></DialogFooter></DialogContent></Dialog>
}

function ScheduleTab({ schedule, environment, busy, onSave }: { schedule: BackupSchedule; environment: BackupStatus['environment']; busy: boolean; onSave: (schedule: Partial<BackupSchedule>) => Promise<void> }) {
  const [draft, setDraft] = useState(schedule)
  const [error, setError] = useState<string | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(schedule)
  async function save() {
    setError(null)
    try {
      await onSave({ enabled: draft.enabled, frequency: draft.frequency, weekday: draft.weekday, time: draft.time, timezone: draft.timezone, retention: draft.retention })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Schedule could not be saved.')
    }
  }
  return <TabsContent value="schedule" className="grid gap-0 pt-3">
    <SettingRow label="Automatic backups" description="Create complete portable backups on this installation."><Switch checked={draft.enabled} disabled={busy} onCheckedChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} /></SettingRow>
    <SettingRow label="Frequency" description="Run every day or on one weekday."><Select value={draft.frequency} onValueChange={(frequency) => setDraft((current) => ({ ...current, frequency: frequency as 'daily' | 'weekly' }))}><SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem></SelectContent></Select></SettingRow>
    {draft.frequency === 'weekly' ? <SettingRow label="Weekday"><Select value={String(draft.weekday)} onValueChange={(weekday) => setDraft((current) => ({ ...current, weekday: Number(weekday) }))}><SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger><SelectContent>{WEEKDAYS.map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent></Select></SettingRow> : null}
    <SettingRow label="Time of day" description="Uses the effective application timezone."><Input className="w-[220px]" type="time" value={draft.time} onChange={(event) => setDraft((current) => ({ ...current, time: event.target.value }))} /></SettingRow>
    <SettingRow label="Timezone" description="Docker Compose TZ takes precedence when configured.">{environment?.timezoneLocked ? <EnvironmentValue label="Backup timezone" value={environment.timezone} /> : <Input className="w-[220px]" value={draft.timezone ?? 'UTC'} onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))} />}</SettingRow>
    <SettingRow label="Retention" description="Keep this many successful scheduled backups."><Input className="w-[120px]" type="number" min={1} max={365} value={draft.retention} onChange={(event) => setDraft((current) => ({ ...current, retention: Number(event.target.value) }))} /></SettingRow>
    <div className="flex flex-wrap items-center gap-3 border-t border-[#e8e1d6] p-4"><Button onClick={() => void save()} disabled={!dirty || busy}>{busy ? <LoaderCircle className="animate-spin" /> : <HardDrive />}Save schedule</Button>{dirty ? <Button variant="ghost" onClick={() => setDraft(schedule)} disabled={busy}>Discard changes</Button> : null}{error ? <p role="alert" className="text-xs font-semibold text-[#9b3f32]">{error}</p> : null}</div>
    <div className="grid gap-1 border-t border-[#e8e1d6] bg-[#f7f2e9] p-4 text-xs text-[#665d52]"><p><Clock3 className="mr-1 inline size-3.5" />Next run: {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : 'not scheduled'}</p><p><HardDrive className="mr-1 inline size-3.5" />Last result: {schedule.lastResult ?? 'not run yet'}{environment?.encryptionConfigured ? ' · environment encryption enabled' : ''}</p></div>
  </TabsContent>
}

function RestoreDialog({ open, onOpenChange, definitions, inspect, preflight, restore }: { open: boolean; onOpenChange: (open: boolean) => void; definitions: Definitions; inspect: (file: File, passphrase?: string) => Promise<BackupInspection>; preflight: (token: string, sections: BackupSectionName[]) => Promise<RestorePreflight>; restore: (token: string, sections: BackupSectionName[]) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [inspection, setInspection] = useState<BackupInspection | null>(null)
  const [selected, setSelected] = useState<BackupSectionName[]>([])
  const [preview, setPreview] = useState<RestorePreflight | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function inspectFile() { if (!file) return; setBusy(true); setError(null); try { const result = await inspect(file, passphrase || undefined); setInspection(result); setSelected(result.manifest.sections); setPreview(null) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Backup could not be inspected.') } finally { setBusy(false) } }
  async function check() { if (!inspection) return; setBusy(true); setError(null); try { setPreview(await preflight(inspection.token, selected)) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Restore preflight failed.') } finally { setBusy(false) } }
  async function execute() { if (!inspection || !preview?.ok || !confirmed) return; setBusy(true); setError(null); try { await restore(inspection.token, selected); window.location.reload() } catch (caught) { setError(caught instanceof Error ? caught.message : 'Restore failed and was rolled back.'); setBusy(false) } }
  return <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Restore backup</DialogTitle><DialogDescription>Inspect first, choose replacement sections, then run a protected restore with automatic rollback.</DialogDescription></DialogHeader>
    {!inspection ? <div className="grid gap-3"><Input type="file" accept=".hlibackup,application/x-homelab-inventory-backup" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><Input type="password" placeholder="Backup or pre-restore encryption passphrase" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /><p className="text-xs leading-5 text-[#756d62]">Required for encrypted archives. When authentication is active, it also encrypts the protected pre-restore backup unless Docker Compose provides a backup passphrase.</p><Button onClick={() => void inspectFile()} disabled={!file || busy}>{busy ? <LoaderCircle className="animate-spin" /> : <FileUp />}Inspect backup</Button></div> : <div className="grid gap-4"><div className="rounded-md border border-[#ded8ce] bg-[#f8f4ed] p-3 text-sm"><strong>Version {inspection.manifest.appVersion}</strong><span className="ml-2 text-[#756d62]">Schema {inspection.manifest.schemaVersion} · {new Date(inspection.manifest.createdAt).toLocaleString()}</span></div><SectionChecklist definitions={definitions} available={inspection.manifest.sections} selected={selected} onChange={(next) => { setSelected(next); setPreview(null); setConfirmed(false) }} />{!preview ? <Button variant="outline" onClick={() => void check()} disabled={selected.length === 0 || busy}><ShieldCheck />Run restore preflight</Button> : <div className="grid gap-3 rounded-md border border-[#ded8ce] p-4"><p className="text-sm font-black">{preview.ok ? 'Ready to restore' : 'Restore blocked'}</p>{preview.changes.map((change) => <p key={change.section} className="text-xs text-[#665d52]">{definitions?.[change.section]?.label}: {change.action}</p>)}{preview.warnings.map((warning) => <p key={warning.code} className="text-xs text-[#8b5b18]">{warning.message}</p>)}{preview.blockers.map((blocker) => <p key={blocker.code} className="text-xs font-bold text-[#9b3f32]">{blocker.message}</p>)}{preview.ok ? <label className="flex items-start gap-3 text-sm font-bold"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />Replace the selected local sections. A complete encrypted pre-restore backup will be created first when authentication credentials exist.</label> : null}</div>}</div>}
    {error ? <p role="alert" className="text-sm font-semibold text-[#9b3f32]">{error}</p> : null}<DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>{preview?.ok ? <Button variant="destructive" onClick={() => void execute()} disabled={!confirmed || busy}>{busy ? <LoaderCircle className="animate-spin" /> : <FileUp />}Restore selected sections</Button> : null}</DialogFooter>
  </DialogContent></Dialog>
}

export function BackupRestoreSettings() {
  const backups = useBackups()
  const status = backups.status.data
  const [createOpen, setCreateOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [credentialAction, setCredentialAction] = useState<{ backup: BackupRecord; action: 'download' | 'verify' } | null>(null)
  const [deleteRecord, setDeleteRecord] = useState<BackupRecord | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const sections = useMemo(() => Object.keys(status?.sections ?? {}) as BackupSectionName[], [status?.sections])
  useEffect(() => { if (backups.status.error) setMessage(backups.status.error.message) }, [backups.status.error])
  if (backups.status.isPending) return <div className="flex items-center gap-2 text-sm text-[#756d62]"><LoaderCircle className="size-4 animate-spin" />Loading backup management</div>
  if (!status) return <p role="alert" className="text-sm font-semibold text-[#9b3f32]">Backup management is unavailable.</p>
  if (status.mode === 'demo') return <SettingsSection title="Backup & Restore" description="Public demo sessions can export only their disposable sandbox data."><SettingRow label="Export demo sandbox" description="Downloads inventory and project data without credentials, agents, or server-side backup storage."><Button onClick={() => void downloadDemoBackup()}><Download />Download sandbox</Button></SettingRow></SettingsSection>
  const schedule = status.schedule!
  const definitions = status.sections
  async function saveSchedule(input: Partial<typeof schedule>) { setMessage(null); await backups.schedule.mutateAsync(input); setMessage('Backup schedule saved.') }
  const ordinary = status.backups.filter((backup) => backup.kind !== 'pre-restore')
  const recovery = status.backups.filter((backup) => backup.kind === 'pre-restore')
  return <SettingsSection title="Backup & Restore" description="Create portable backups, restore selected sections, and manage automatic retention."><Tabs defaultValue="backups" className="gap-0"><TabsList variant="line" className="mx-4 mt-3"><TabsTrigger value="backups">Backups</TabsTrigger><TabsTrigger value="schedule">Schedule</TabsTrigger></TabsList>
    <TabsContent value="backups" className="grid gap-0 pt-3"><div className="flex flex-wrap gap-2 border-y border-[#e8e1d6] p-4"><Button onClick={() => setCreateOpen(true)}><Archive />Create backup</Button><Button variant="outline" onClick={() => setRestoreOpen(true)}><FileUp />Restore from file</Button><span className="ml-auto self-center text-xs font-semibold text-[#756d62]">{status.backups.length} stored · {bytes(status.storageBytes ?? 0)}</span></div>{status.operation ? <div className="flex items-center gap-2 border-b border-[#e8e1d6] bg-[#f7f2e9] p-4 text-sm font-bold"><LoaderCircle className="size-4 animate-spin" />{status.operation.kind} in progress</div> : null}<div className="grid gap-3 p-4">{ordinary.map((backup) => <div key={backup.id} className="grid gap-3 rounded-md border border-[#ded8ce] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><p className="truncate text-sm font-black">{backup.label}</p><p className="mt-1 text-xs text-[#756d62]">{new Date(backup.createdAt).toLocaleString()} · {bytes(backup.sizeBytes)} · {backup.sections.length} sections{backup.encrypted ? ' · encrypted' : ''}</p></div><div className="flex flex-wrap gap-1.5"><Button size="sm" variant="outline" onClick={() => backup.encrypted ? setCredentialAction({ backup, action: 'verify' }) : void backups.verify.mutateAsync({ id: backup.id }).then(() => setMessage('Backup verification passed.')).catch((error) => setMessage(error.message))}><CheckCircle2 />Verify</Button><Button size="sm" variant="outline" onClick={() => setCredentialAction({ backup, action: 'download' })}><Download />Download</Button><Button size="icon-sm" variant="ghost" title="Delete backup" onClick={() => setDeleteRecord(backup)}><Trash2 /></Button></div></div>)}{ordinary.length === 0 ? <div className="rounded-md border border-dashed border-[#cfc6b9] p-6 text-center text-sm text-[#756d62]">No portable backups have been stored yet.</div> : null}{recovery.length > 0 ? <details className="rounded-md border border-[#ded8ce] p-3"><summary className="cursor-pointer text-sm font-black">Recovery backups ({recovery.length})</summary><div className="mt-3 grid gap-2">{recovery.map((backup) => <div key={backup.id} className="flex items-center justify-between gap-3 text-xs"><span>{backup.label} · {new Date(backup.createdAt).toLocaleString()}</span><Button size="sm" variant="outline" onClick={() => setCredentialAction({ backup, action: 'download' })}>Download</Button></div>)}</div></details> : null}{status.restores.length > 0 ? <details className="rounded-md border border-[#ded8ce] p-3"><summary className="cursor-pointer text-sm font-black">Restore history ({status.restores.length})</summary><div className="mt-3 grid gap-2">{status.restores.map((restore) => <p key={restore.id} className="text-xs text-[#665d52]">#{restore.id} {restore.status} · {new Date(restore.startedAt).toLocaleString()} · {restore.sections.length} sections</p>)}</div></details> : null}</div></TabsContent>
    <ScheduleTab key={schedule.updatedAt ?? 'initial'} schedule={schedule} environment={status.environment} busy={backups.schedule.isPending} onSave={saveSchedule} />
  </Tabs>{message ? <p role="status" className="border-t border-[#e8e1d6] px-4 py-3 text-xs font-semibold text-[#665d52]">{message}</p> : null}
    <CreateBackupDialog key={String(createOpen)} open={createOpen} onOpenChange={setCreateOpen} sections={sections} definitions={definitions} busy={backups.create.isPending} onCreate={async (input) => { await backups.create.mutateAsync(input); setMessage('Backup created and verified.') }} />
    <BackupCredentialDialog key={`${credentialAction?.action ?? 'none'}-${credentialAction?.backup.id ?? 0}`} backup={credentialAction?.backup ?? null} action={credentialAction?.action ?? 'download'} open={credentialAction !== null} onOpenChange={(open) => { if (!open) setCredentialAction(null) }} busy={backups.download.isPending || backups.verify.isPending} onSubmit={async (passphrase) => { if (!credentialAction) return; if (credentialAction.action === 'download') await backups.download.mutateAsync({ id: credentialAction.backup.id, passphrase: passphrase || undefined }); else { await backups.verify.mutateAsync({ id: credentialAction.backup.id, passphrase }); setMessage('Backup verification passed.') } }} />
    <RestoreDialog key={String(restoreOpen)} open={restoreOpen} onOpenChange={setRestoreOpen} definitions={definitions} inspect={(file, passphrase) => backups.inspect.mutateAsync({ file, passphrase })} preflight={(token, selected) => backups.preflight.mutateAsync({ token, sections: selected })} restore={async (token, selected) => { await backups.restore.mutateAsync({ token, sections: selected }) }} />
    <AlertDialog open={deleteRecord !== null} onOpenChange={(open) => { if (!open) setDeleteRecord(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete stored backup?</AlertDialogTitle><AlertDialogDescription>{deleteRecord?.label} will be removed permanently. This does not change inventory or project data.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (deleteRecord) void backups.remove.mutateAsync(deleteRecord.id).then(() => setDeleteRecord(null)) }}>Delete backup</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </SettingsSection>
}
