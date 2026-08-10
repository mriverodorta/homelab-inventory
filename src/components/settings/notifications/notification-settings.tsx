import { BellRing } from 'lucide-react'
import { ContactPointsTab } from './contact-points-tab'
import { DeliveryTab } from './delivery-tab'
import { RulesTab } from './rules-tab'
import { ScheduleTab } from './schedule-tab'
import { SettingRow, SettingsSection } from '@/components/settings/settings-primitives'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useNotificationMutations, useNotificationSnapshot } from '@/hooks/use-notifications'
import { usePermission } from '@/hooks/use-permission'

export function NotificationSettings() {
  const canView = usePermission('notifications.view')
  const canManage = usePermission('notifications.manage')
  const query = useNotificationSnapshot(canView)
  const mutations = useNotificationMutations()

  if (!canView) return <SettingsSection title="Notifications" description="Incident and delivery access is restricted."><p className="p-4 text-sm text-[#756d62]">Your roles do not include notification access.</p></SettingsSection>
  if (query.isLoading) return <SettingsSection title="Notifications" description="Loading notification policy."><div className="grid min-h-40 place-items-center"><BellRing className="size-5 animate-pulse text-[#756d62]" /></div></SettingsSection>
  if (query.isError || !query.data) return <SettingsSection title="Notifications" description="Notification policy could not be loaded."><p role="alert" className="p-4 text-sm font-semibold text-[#7a2c1d]">{query.error instanceof Error ? query.error.message : 'Notification settings are unavailable.'}</p></SettingsSection>
  if (!query.data.available) return <SettingsSection title="Notifications" description="Public demo sessions do not create notification credentials or deliver alerts."><p className="p-4 text-sm text-[#756d62]">Notifications are unavailable in demo mode.</p></SettingsSection>
  const config = query.data.config
  return <SettingsSection title="Notifications" description="Detect persisted agent state changes, manage incidents, and deliver alerts through reusable destinations.">
    <SettingRow label="Enable notifications" description="Detection, incident creation, and delivery remain disabled until explicitly enabled."><Switch checked={config.enabled} disabled={!canManage || mutations.settings.isPending} onCheckedChange={(enabled) => mutations.settings.mutate({ expectedRevision: config.revision, enabled })} aria-label="Enable notifications" /></SettingRow>
    <Tabs defaultValue="contacts" className="gap-0 border-t border-[#e8e1d6]"><div className="overflow-x-auto border-b border-[#e8e1d6] px-4"><TabsList variant="line" className="h-10"><TabsTrigger value="contacts">Contact Points</TabsTrigger><TabsTrigger value="rules">Rules</TabsTrigger><TabsTrigger value="schedule">Schedule</TabsTrigger><TabsTrigger value="delivery">Delivery</TabsTrigger></TabsList></div>
      <TabsContent value="contacts"><ContactPointsTab config={config} canManage={canManage} mutations={mutations} /></TabsContent>
      <TabsContent value="rules"><RulesTab config={config} canManage={canManage} mutations={mutations} /></TabsContent>
      <TabsContent value="schedule"><ScheduleTab config={config} canManage={canManage} mutations={mutations} /></TabsContent>
      <TabsContent value="delivery"><DeliveryTab config={config} exhausted={query.data.summary.exhaustedDeliveries} canManage={canManage} mutations={mutations} /></TabsContent>
    </Tabs>
  </SettingsSection>
}
