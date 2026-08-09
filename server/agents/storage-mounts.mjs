const PSEUDO_FILESYSTEMS = new Set([
  'autofs', 'binfmt_misc', 'bpf', 'cgroup', 'cgroup2', 'configfs', 'debugfs', 'devpts',
  'devtmpfs', 'efivarfs', 'fusectl', 'hugetlbfs', 'mqueue', 'nsfs', 'overlay', 'proc',
  'pstore', 'ramfs', 'securityfs', 'selinuxfs', 'sysfs', 'tmpfs', 'tracefs', 'squashfs',
])
const REMOTE_FILESYSTEMS = new Set([
  '9p', 'afs', 'ceph', 'cifs', 'davfs', 'fuse.sshfs', 'glusterfs', 'nfs', 'nfs4',
  'smb2', 'smb3', 'sshfs', 'virtiofs',
])
const LOCAL_VIRTUAL_PREFIXES = [
  '/var/lib/docker/overlay2/', '/var/lib/docker/containers/', '/var/lib/containers/storage/overlay/',
  '/snap/', '/run/containers/', '/run/docker/',
]

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function bytes(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function isRemoteSource(source) {
  return source.startsWith('//') || /^[^/]+:/.test(source)
}

export function isEligibleLocalMount(mount) {
  const fsType = text(mount?.fsType).toLowerCase()
  const source = text(mount?.source)
  const mountPoint = text(mount?.mountPoint)
  if (!fsType || !source || !mountPoint) return false
  if (PSEUDO_FILESYSTEMS.has(fsType) || REMOTE_FILESYSTEMS.has(fsType)) return false
  if (fsType.startsWith('fuse.') && fsType !== 'fuseblk') return false
  if (isRemoteSource(source)) return false
  if (source.startsWith('/dev/loop') || source.startsWith('/dev/zram')) return false
  if (LOCAL_VIRTUAL_PREFIXES.some((prefix) => mountPoint.startsWith(prefix))) return false
  return source.startsWith('/dev/') || fsType === 'zfs' || fsType === 'btrfs'
}

function displayKey(mount) {
  const fsType = text(mount.fsType).toLowerCase()
  const source = text(mount.source)
  if (fsType === 'zfs') return `zfs:${source}`
  if (fsType === 'btrfs') return `btrfs:${text(mount.majorMinor) || source}:${text(mount.root) || '/'}`
  return text(mount.majorMinor) || source
}

function accountingKey(mount) {
  const fsType = text(mount.fsType).toLowerCase()
  const source = text(mount.source)
  if (fsType === 'zfs') return `zfs:${source.split('/')[0]}`
  return `${fsType}:${text(mount.majorMinor) || source}`
}

function row(mount) {
  const totalBytes = bytes(mount.totalBytes)
  const usedBytes = Math.min(totalBytes, bytes(mount.usedBytes))
  return {
    mountId: Number(mount.mountId) || null,
    parentId: Number(mount.parentId) || null,
    majorMinor: text(mount.majorMinor) || null,
    source: text(mount.source),
    mountPoint: text(mount.mountPoint),
    root: text(mount.root) || '/',
    fsType: text(mount.fsType),
    readOnly: mount.readOnly === true,
    totalBytes,
    usedBytes,
    availableBytes: bytes(mount.availableBytes),
    usagePercent: totalBytes > 0 ? Math.min(100, usedBytes * 100 / totalBytes) : 0,
  }
}

export function summarizeLocalStorage(filesystems = []) {
  const candidates = filesystems.filter(isEligibleLocalMount).map(row)
  const displayMounts = new Map()
  for (const mount of candidates.sort((first, second) => first.mountPoint.length - second.mountPoint.length)) {
    const key = displayKey(mount)
    if (!displayMounts.has(key)) displayMounts.set(key, mount)
  }
  const mounts = [...displayMounts.values()].sort((first, second) => first.mountPoint.localeCompare(second.mountPoint))
  const accountingMounts = new Map()
  for (const mount of mounts) {
    const key = accountingKey(mount)
    if (!accountingMounts.has(key)) accountingMounts.set(key, mount)
  }
  const counted = [...accountingMounts.values()]
  const totalBytes = counted.reduce((total, mount) => total + mount.totalBytes, 0)
  const usedBytes = counted.reduce((total, mount) => total + mount.usedBytes, 0)
  return {
    totalBytes,
    usedBytes,
    availableBytes: counted.reduce((total, mount) => total + mount.availableBytes, 0),
    usagePercent: totalBytes > 0 ? Math.min(100, usedBytes * 100 / totalBytes) : 0,
    mounts,
  }
}
