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
    version: '0.1.22',
    date: '2026-07-18',
    channel: 'latest',
    title: 'Smoother canvas workspace controls',
    highlights: [
      'The desktop inventory sidebar now opens and closes with a smooth width transition while the canvas resizes alongside it.',
      'The floating canvas command bar now aligns with the bottom edge of the React Flow controls for a tighter, more consistent workspace layout.',
    ],
    fixes: [
      'Inventory visibility changes no longer make the sidebar and canvas blink abruptly between layouts.',
    ],
    notes: [
      'Reduced-motion preferences continue to disable nonessential interface animation.',
    ],
  },
  {
    version: '0.1.21',
    date: '2026-07-18',
    channel: 'release',
    title: 'Responsive canvas command bar',
    highlights: [
      'Canvas actions now live in a responsive, icon-only command bar centered along the bottom of the workspace on desktop and mobile.',
      'Desktop users can hide the inventory sidebar to expand the canvas, then restore it at its previously saved width.',
      'Every command-bar action includes an accessible label and hover tooltip while retaining quick access to history, updates, audits, centering, arrangement, and cable visibility.',
    ],
    fixes: [
      'Removed the crowded top-right canvas controls and the cable color legend while retaining the cable visibility toggle.',
      'The mobile command bar remains usable on narrow screens without wrapping over the canvas.',
    ],
    notes: [
      'Desktop inventory visibility and width persist across browser refreshes.',
    ],
  },
  {
    version: '0.1.20',
    date: '2026-07-15',
    channel: 'release',
    title: 'Accurate Docker update status',
    highlights: [
      'Docker update checks now distinguish newer channel images, exact matches, revision-only rebuilds, and installations ahead of their selected channel.',
      'The update dialog labels the published latest or stable image explicitly and only shows update instructions when an update is actually available.',
      'Stable releases now publish immutable X.Y.Z images, a moving X.Y series alias, a matching Git tag, and GitHub Release only after the Docker image is verified.',
    ],
    fixes: [
      'An older stable or latest image is no longer presented as an available update when the running installation has a higher version.',
      'Images rebuilt from a different commit at the same version can now be detected when both revisions are known.',
      'Up-to-date and ahead-of-channel states no longer show an empty release-details message or unnecessary Docker Compose commands.',
      'Release automation refuses to overwrite an existing numbered Docker image or reuse a Git tag that belongs to another commit.',
      'Historical release restoration now accepts only approved version-to-commit pairs and keeps registry credentials unavailable to historical build scripts.',
    ],
    notes: [
      'UPDATE_CHANNEL remains authoritative; recreate the container after changing Compose environment variables so Docker applies the new configuration.',
      'A guarded manual workflow can restore historical numbered images without changing latest or stable.',
    ],
  },
  {
    version: '0.1.19',
    date: '2026-07-14',
    channel: 'release',
    title: 'Editable inventory inspectors',
    highlights: [
      'Inventory items can now be corrected directly from their inspectors using the same validated fields and select options as the Add Item dialog.',
      'Servers, switches, NAS devices, patch panels, CPUs, RAM, storage, GPUs, and network cards now use focused tabbed editing workflows.',
      'Server and NAS slot, port, network, and agent views remain available alongside the editable hardware specifications.',
    ],
    fixes: [
      'Inspector saves preserve item IDs, assignments, placements, detailed port metadata, and existing cable connections.',
      'Switch port groups retain support for as many as 128 ports and prevent connected or annotated ports from being removed accidentally.',
      'NAS inspectors clearly identify agent setup as unavailable instead of invoking server-only enrollment APIs.',
      'Pending text edits are flushed when an inspector closes or switches items so the final keystrokes are not lost.',
      'Temporarily clearing a port count while typing a replacement no longer removes or multiplies existing ports.',
    ],
    notes: [
      'Text and numeric edits save after a 500 ms pause; select and toggle changes save immediately.',
    ],
  },
  {
    version: '0.1.18',
    date: '2026-07-14',
    channel: 'release',
    title: 'Request rate limiting and CI hardening',
    highlights: [
      'Homelab Inventory now applies a global request limit to API routes, static assets, and the application fallback.',
      'Rate-limit responses include standard headers and return structured JSON for API clients.',
    ],
    fixes: [
      'GitHub Actions CI now declares read-only repository permissions explicitly.',
      'Invalid rate-limit environment values fall back to safe defaults with a server warning.',
      'Production images now include the request-limiting middleware used by the runtime server.',
    ],
    notes: [
      'Deployments can tune RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX, and should set TRUST_PROXY to an explicit hop count or proxy range when running behind a reverse proxy.',
    ],
  },
  {
    version: '0.1.17',
    date: '2026-07-13',
    channel: 'release',
    title: 'Connection endpoint filtering',
    highlights: [
      'Manual connection editors now list only compatible, available ports on equipment placed on the canvas.',
      'Assigned NIC and GPU ports are grouped beneath their server or NAS instead of appearing as independent inventory devices.',
      'Patch-panel destinations now identify the port number and front or back side explicitly.',
    ],
    fixes: [
      'Unassigned expansion cards and hosts without an actionable destination no longer appear in connection dropdowns.',
      'Changing the source port now keeps valid selections and resets destinations that are no longer compatible.',
    ],
  },
  {
    version: '0.1.16',
    date: '2026-07-12',
    channel: 'release',
    title: 'Docker update notifications',
    highlights: [
      'Homelab Inventory now checks the configured stable or latest Docker Hub channel and shows when a newer image is available.',
      'The update dialog includes release highlights, a manual check, copyable Docker Compose commands, and an exact-version skip action.',
    ],
    fixes: [],
    notes: [
      'Automatic checks are anonymous, run at startup and every six hours, and can be disabled with UPDATE_CHECK_ENABLED=false.',
    ],
  },
  {
    version: '0.1.15',
    date: '2026-07-12',
    channel: 'release',
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
    channel: 'release',
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
    channel: 'release',
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
    channel: 'release',
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
    channel: 'release',
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
