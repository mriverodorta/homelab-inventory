export const SMOKE_DATA_TMPFS = '/data:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=0700'

export function smokeRunCommand({ containerName, platform, image }) {
  return [
    'docker', 'run', '--detach', '--name', containerName,
    '--platform', platform,
    '--tmpfs', SMOKE_DATA_TMPFS,
    '--publish', '127.0.0.1::8798',
    image,
  ]
}
