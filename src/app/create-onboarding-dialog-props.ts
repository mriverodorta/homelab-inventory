import type { AppDialogsProps } from '@/app/app-dialogs'
import type { useOnboardingController } from '@/app/use-onboarding-controller'

type OnboardingDialogProps = Pick<
  AppDialogsProps,
  'demoSession' | 'firstRun' | 'exampleCompletion'
>

interface CreateOnboardingDialogPropsOptions {
  onboarding: ReturnType<typeof useOnboardingController>
  demoSession: AppDialogsProps['demoSession']
}

export function createOnboardingDialogProps({
  onboarding,
  demoSession,
}: CreateOnboardingDialogPropsOptions): OnboardingDialogProps {
  return {
    demoSession,
    firstRun: {
      open: onboarding.showFirstRun,
      busy: onboarding.busy,
      error: onboarding.error,
      onExplore: () => onboarding.loadExample.mutate(),
      onStartEmpty: () => onboarding.startEmpty.mutate(),
    },
    exampleCompletion: {
      open: onboarding.showExampleCompletion,
      impact: onboarding.removalImpactQuery.data ?? null,
      loadingImpact: onboarding.removalImpactQuery.isLoading,
      busy: onboarding.finishExample.isPending,
      error: onboarding.error,
      onRemove: () => onboarding.finishExample.mutate('remove'),
      onKeep: () => onboarding.finishExample.mutate('keep'),
    },
  }
}
