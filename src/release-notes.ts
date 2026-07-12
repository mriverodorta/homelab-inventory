export type ReleaseNoteChannel = 'latest' | 'stable' | 'release'

export type ReleaseNoteEntry = {
  version: string
  date: string
  channel: ReleaseNoteChannel
  title: string
  highlights: string[]
  fixes: string[]
  notes?: string[]
}

export const RELEASE_NOTES: ReleaseNoteEntry[] = [
  {
    version: '0.1.15',
    date: '2026-07-12',
    channel: 'latest',
    title: "What's New ordering",
    highlights: [],
    fixes: [
      'The What\'s New dialog now lists included releases from newest to oldest.',
      'Only the highest displayed version receives the LATEST badge; historical release channels are no longer presented as recency labels.',
    ],
    notes: [
      'Release-channel metadata remains available internally and is not modified by this presentation fix.',
    ],
  },
  {
    version: '0.1.14',
    date: '2026-07-10',
    channel: 'latest',
    title: 'Negotiated network cable speeds',
    highlights: [
      'Network connections now persist their negotiated speed and use the lowest advertised speed across the full connected path.',
      'Patch panels now behave as passive links, so attaching a slower server or NAS updates every cable on both sides of the keystone.',
      'Added a light-purple 5G cable color alongside the existing 1G, 2.5G, and 10G palette.',
      'Switch RJ45, SFP, and SFP+ receptacles now require an advertised speed, with practical defaults for newly added port groups.',
    ],
    fixes: [
      'A 1G server connected to a 2.5G switch now renders the complete path as 1G instead of incorrectly using the faster endpoint.',
      'Legacy switch-to-switch uplinks are repaired as network connections so 10G SFP+ links render blue instead of neutral.',
    ],
    notes: [
      'Schema migrations 4 and 5 backfill negotiated speeds and switch port defaults without changing cable IDs, labels, or routes.',
    ],
  },
  {
    version: '0.1.13',
    date: '2026-07-10',
    channel: 'latest',
    title: 'Editable switch inspectors',
    highlights: [
      'Switch inspectors now use focused Specs, Ports, and Connections tabs that match the server inspector workflow.',
      'Switch names, manufacturers, models, management details, switching capacity, cooling, and grouped port definitions can now be edited directly.',
      'Port groups can be resized while preserving the IDs and cable assignments of retained ports.',
    ],
    fixes: [
      'Port reductions are blocked when they would remove a connected port or discard saved labels, notes, or IP details.',
    ],
    notes: [
      'Correcting an accidental port count now updates both the switch canvas card and its detailed port editor.',
    ],
  },
  {
    version: '0.1.12',
    date: '2026-07-10',
    channel: 'latest',
    title: 'Patch panel row controls',
    highlights: [
      'Patch panel inspectors can now swap the front and back row display order on the canvas.',
    ],
    fixes: [],
    notes: [
      'The row order is stored as a patch panel display preference, so existing labels, ports, and cable endpoints stay intact.',
    ],
  },
  {
    version: '0.1.11',
    date: '2026-07-09',
    channel: 'latest',
    title: 'Public demo sandboxes',
    highlights: [
      'A new APP_MODE=demo runtime creates isolated writable demo sessions from a read-only source data mount.',
      'Demo visitors get their own cookie-based sandbox with a countdown and an extension prompt before expiration.',
    ],
    fixes: [
      'Demo copies exclude backups, agent stores, private IPs, serial numbers, tokens, and secret-like notes.',
      'Agent enrollment and telemetry endpoints return 403 in public demo mode.',
      'The demo extension prompt waits for the active sandbox to actually expire before opening.',
      'Demo-mode runtime files are included in the Docker image and session cookies are handled defensively.',
      'Connection inspector cards now keep consistent drawer padding after the server inspector redesign.',
    ],
    notes: [
      'Adds a public demo mode with sanitized per-browser sandboxes, a visible session timer, and disabled agent enrollment.',
      'GitHub Actions now uses checkout v7 for CI and Docker publishing workflows.',
      'TypeScript dev tooling was updated to 7.0.2.',
      'Node type definitions were updated to 26.1.1.',
    ],
  },
  {
    version: '0.1.10',
    date: '2026-07-09',
    channel: 'stable',
    title: "What's New release notes",
    highlights: [
      'Added structured release notes that power an in-app update dialog.',
      'Added persisted release-note acknowledgement in the deployment data store.',
      'Added CI and Docker publishing checks so meaningful releases include app-readable notes.',
    ],
    fixes: [
      'Prevents GitHub Actions Docker publishing when the package version has no matching release-note entry.',
    ],
    notes: [
      'The dialog appears after upgrades until the deployment acknowledges it with Got it.',
    ],
  },
]

type Semver = {
  major: number
  minor: number
  patch: number
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/, '')
}

function parseSemver(version: string): Semver {
  const normalized = normalizeVersion(version)
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)$/)

  if (!match) {
    throw new Error(`Invalid semver version: ${version}`)
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function compareVersions(left: string, right: string): number {
  const a = parseSemver(left)
  const b = parseSemver(right)

  if (a.major !== b.major) {
    return a.major - b.major
  }

  if (a.minor !== b.minor) {
    return a.minor - b.minor
  }

  return a.patch - b.patch
}

export function hasReleaseNoteForVersion(
  entries: ReleaseNoteEntry[],
  version: string,
): boolean {
  const normalized = normalizeVersion(version)

  return entries.some((entry) => normalizeVersion(entry.version) === normalized)
}

export function getReleaseNotesBetween(
  entries: ReleaseNoteEntry[],
  lastSeenVersion: string,
  currentVersion: string,
): ReleaseNoteEntry[] {
  return entries
    .filter((entry) => compareVersions(entry.version, lastSeenVersion) > 0)
    .filter((entry) => compareVersions(entry.version, currentVersion) <= 0)
    .sort((left, right) => compareVersions(right.version, left.version))
}
