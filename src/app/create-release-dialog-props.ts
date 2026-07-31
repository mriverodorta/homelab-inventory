import type { AppDialogsProps } from '@/app/app-dialogs'
import type { useReleaseUpdateController } from '@/app/use-release-update-controller'

type ReleaseDialogProps = Pick<AppDialogsProps, 'whatsNew' | 'update'>

export function createReleaseDialogProps(
  releases: ReturnType<typeof useReleaseUpdateController>,
): ReleaseDialogProps {
  return {
    whatsNew: releases.releaseNotesQuery.data ? {
      open: releases.whatsNewVisible,
      currentVersion: releases.releaseNotesQuery.data.currentVersion,
      entries: releases.releaseNotesQuery.data.entries,
      acknowledging: releases.acknowledgeReleaseNotesMutation.isPending,
      onAcknowledge: () => releases.acknowledgeReleaseNotesMutation.mutate(),
      onOpenChange: (open) => {
        if (!open) releases.dismissWhatsNew()
      },
    } : undefined,
    update: releases.updateStatusQuery.data ? {
      open: releases.updateDialogOpen,
      status: releases.updateStatusQuery.data,
      checking: releases.checkForUpdatesMutation.isPending,
      skipping: releases.skipUpdateMutation.isPending,
      clearingSkip: releases.clearSkippedUpdateMutation.isPending,
      onOpenChange: releases.setUpdateDialogOpen,
      onCheck: () => releases.checkForUpdatesMutation.mutate(),
      onSkip: () => releases.skipUpdateMutation.mutate(),
      onClearSkip: () => releases.clearSkippedUpdateMutation.mutate(),
    } : undefined,
  }
}
