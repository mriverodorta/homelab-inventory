import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  finishOnboardingExample,
  loadOnboardingExample,
  loadOnboardingRemovalImpact,
  loadOnboardingStatus,
  restartOnboarding,
  saveOnboardingWalkthroughStep,
  startOnboardingEmpty,
} from '@/lib/onboarding-api'

afterEach(() => vi.restoreAllMocks())

describe('onboarding API client', () => {
  it('uses the lifecycle endpoints and payloads', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ enabled: true, status: 'available' }),
    } as Response)

    await loadOnboardingStatus()
    await loadOnboardingExample()
    await startOnboardingEmpty()
    await loadOnboardingRemovalImpact()
    await finishOnboardingExample('remove')
    await restartOnboarding()
    await saveOnboardingWalkthroughStep(2)

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/onboarding/status',
      '/api/onboarding/load-example',
      '/api/onboarding/start-empty',
      '/api/onboarding/removal-impact',
      '/api/onboarding/finish-example',
      '/api/onboarding/restart',
      '/api/onboarding/walkthrough-step',
    ])
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/onboarding/finish-example', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'remove' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(7, '/api/onboarding/walkthrough-step', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ step: 2 }),
    }))
  })
})
