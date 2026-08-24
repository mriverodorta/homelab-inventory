import { createToken, hashToken } from './db/agent-auth.mjs'
import { isRelationalId } from './db/relational-ids.mjs'
import { agentCommandPlatform } from './agents/command-platform.mjs'

const ENROLLMENT_TTL_MS = 24 * 60 * 60 * 1000
const AGENT_VERSION = '0.2.0'
const HEARTBEAT_RATE_WINDOW_MS = 60_000
const HEARTBEAT_RATE_LIMIT = 120
const HEARTBEAT_COLLECTION_LIMITS = {
  containers: 256,
  disks: 64,
  listeningPorts: 1024,
  loadAverage: 3,
  network: 64,
  services: 512,
}
const MAX_HEARTBEAT_DEPTH = 5
const MAX_HEARTBEAT_ARRAY_LENGTH = 1024
const MAX_HEARTBEAT_OBJECT_KEYS = 64
const MAX_HEARTBEAT_STRING_LENGTH = 2048
function bearerToken(request) {
  const header = request.get('authorization') ?? ''
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header)

  return match?.[1] ?? null
}

function normalizeAgentVersion(value) {
  if (value === undefined || value === null || value === '') return AGENT_VERSION
  const hasControlCharacter = typeof value === 'string' && [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
  if (typeof value !== 'string' || value.length > 64 || hasControlCharacter) {
    throw new Error('Agent version must be a string of at most 64 characters.')
  }

  return value
}

function publicEndpoint(request) {
  return normalizeAgentEndpoint(`${request.protocol}://${request.get('host')}`)
}

export function normalizeAgentEndpoint(value) {
  const containsControlCharacter = typeof value === 'string'
    && [...value].some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint <= 0x1f || codePoint === 0x7f
    })

  if (typeof value !== 'string' || !value.trim() || containsControlCharacter) {
    throw new Error('Agent endpoint must be a valid HTTP or HTTPS origin.')
  }

  let endpoint
  try {
    endpoint = new URL(value.trim())
  } catch {
    throw new Error('Agent endpoint must be a valid HTTP or HTTPS origin.')
  }

  if (
    !['http:', 'https:'].includes(endpoint.protocol)
    || !endpoint.hostname
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
    || (endpoint.pathname && endpoint.pathname !== '/')
  ) {
    throw new Error('Agent endpoint must be an HTTP or HTTPS origin without credentials, path, query, or fragment.')
  }

  return endpoint.origin
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function installCommand({ endpoint, serverId, token }) {
  return [
    `curl -fsSL ${endpoint}/api/agent/install.sh | sudo bash -s --`,
    `--server-id ${shellEscape(serverId)}`,
    `--endpoint ${shellEscape(endpoint)}`,
    `--token ${shellEscape(token)}`,
  ].join(' \\\n  ')
}

function parseServerIdParam(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const serverId = Number(value)
  return isRelationalId(serverId) ? serverId : null
}

function hostExists(store, hostType, hostId) {
  const host = !['server', 'nas', 'pcBuild'].includes(hostType) || !isRelationalId(hostId)
    ? null
    : store.getProject().items[`${hostType}:${hostId}`]

  return host?.type === hostType
}

function recordMatchesHost(record, hostType, hostId) {
  return record.hostType === hostType && record.hostId === hostId
}

function findEnrollment(store, hostType, hostId, token) {
  return store.findAgentEnrollment({ hostType, hostId, tokenHash: hashToken(token) })
}

function findDevice(store, hostType, hostId, token) {
  return store.findAgentDevice({ hostType, hostId, tokenHash: hashToken(token) })
}

function boundedHeartbeatValue(value, depth = 0) {
  if (depth > MAX_HEARTBEAT_DEPTH) {
    throw new Error('Heartbeat payload nesting is too deep.')
  }

  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Heartbeat payload numbers must be finite.')
    return value
  }
  if (typeof value === 'string') {
    if (value.length > MAX_HEARTBEAT_STRING_LENGTH) {
      throw new Error('Heartbeat payload contains an oversized string.')
    }
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_HEARTBEAT_ARRAY_LENGTH) {
      throw new Error(`Heartbeat payload arrays cannot exceed ${MAX_HEARTBEAT_ARRAY_LENGTH} items.`)
    }
    return value.map((item) => boundedHeartbeatValue(item, depth + 1))
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Heartbeat payload contains an unsupported value.')
  }

  const entries = Object.entries(value)
  if (entries.length > MAX_HEARTBEAT_OBJECT_KEYS) {
    throw new Error('Heartbeat payload object has too many fields.')
  }

  return Object.fromEntries(entries.map(([key, item]) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new Error('Heartbeat payload contains an unsafe field.')
    }
    return [key, boundedHeartbeatValue(item, depth + 1)]
  }))
}

function optionalHeartbeatObject(payload, key) {
  const value = payload[key]
  if (value === undefined || value === null) return null
  if (Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`Heartbeat ${key} must be an object.`)
  }
  return value
}

function boundedCollection(payload, key) {
  const value = payload[key]
  if (value === undefined || value === null) return key === 'loadAverage' ? null : []
  if (!Array.isArray(value)) throw new Error(`Heartbeat ${key} must be an array.`)
  if (value.length > HEARTBEAT_COLLECTION_LIMITS[key]) {
    throw new Error(`Heartbeat ${key} exceeds the ${HEARTBEAT_COLLECTION_LIMITS[key]} item limit.`)
  }
  return boundedHeartbeatValue(value)
}

export function normalizeHeartbeat(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Heartbeat payload must be an object.')
  }

  const normalized = boundedHeartbeatValue(payload)
  if (typeof normalized.agentVersion === 'string' && normalized.agentVersion.length > 64) {
    throw new Error('Heartbeat agent version is too long.')
  }
  if (typeof normalized.hostname === 'string' && normalized.hostname.length > 255) {
    throw new Error('Heartbeat hostname is too long.')
  }

  return {
    agentVersion: typeof normalized.agentVersion === 'string' ? normalized.agentVersion : AGENT_VERSION,
    collectedAt: typeof normalized.collectedAt === 'string' ? normalized.collectedAt : null,
    hostname: typeof normalized.hostname === 'string' ? normalized.hostname : null,
    os: optionalHeartbeatObject(normalized, 'os'),
    uptimeSeconds: typeof normalized.uptimeSeconds === 'number' ? normalized.uptimeSeconds : null,
    loadAverage: boundedCollection(normalized, 'loadAverage'),
    cpu: optionalHeartbeatObject(normalized, 'cpu'),
    memory: optionalHeartbeatObject(normalized, 'memory'),
    swap: optionalHeartbeatObject(normalized, 'swap'),
    disks: boundedCollection(normalized, 'disks'),
    network: boundedCollection(normalized, 'network'),
    motherboard: optionalHeartbeatObject(normalized, 'motherboard'),
    containers: boundedCollection(normalized, 'containers'),
    kubernetes: optionalHeartbeatObject(normalized, 'kubernetes'),
    services: boundedCollection(normalized, 'services'),
    listeningPorts: boundedCollection(normalized, 'listeningPorts'),
  }
}

function installScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

SERVER_ID=""
ENDPOINT=""
TOKEN=""
AGENT_VERSION="${AGENT_VERSION}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-id)
      SERVER_ID="$2"
      shift 2
      ;;
    --endpoint)
      ENDPOINT="$2"
      shift 2
      ;;
    --token)
      TOKEN="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$SERVER_ID" || -z "$ENDPOINT" || -z "$TOKEN" ]]; then
  echo "Missing --server-id, --endpoint, or --token." >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer with sudo/root." >&2
  exit 1
fi

command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required." >&2; exit 1; }

install -d -m 0755 /opt/homelab-inventory-agent
install -d -m 0700 /etc/homelab-inventory-agent

cat >/opt/homelab-inventory-agent/agent.sh <<'AGENT'
#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="/etc/homelab-inventory-agent/config.env"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Missing $CONFIG_FILE" >&2
  exit 1
fi

SERVER_ID=""
ENDPOINT=""
DEVICE_TOKEN=""
AGENT_VERSION=""

while IFS='=' read -r key value; do
  case "$key" in
    SERVER_ID) SERVER_ID="$value" ;;
    ENDPOINT) ENDPOINT="$value" ;;
    DEVICE_TOKEN) DEVICE_TOKEN="$value" ;;
    AGENT_VERSION) AGENT_VERSION="$value" ;;
  esac
done < "$CONFIG_FILE"

if [[ -z "$SERVER_ID" || -z "$ENDPOINT" || -z "$DEVICE_TOKEN" || -z "$AGENT_VERSION" ]]; then
  echo "Invalid $CONFIG_FILE" >&2
  exit 1
fi

collect_payload() {
  SERVER_SPECS_AGENT_VERSION="$AGENT_VERSION" python3 <<'PY'
import json
import os
import platform
import shutil
import socket
import subprocess
import time
from pathlib import Path

VIRTUAL_PREFIXES = (
    "lo", "docker", "br-", "veth", "virbr", "vmnet", "cni", "flannel",
    "kube", "tailscale", "wg", "tun",
)

def run(command):
    try:
        return subprocess.check_output(command, stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        return ""

def command_exists(command):
    return shutil.which(command) is not None

def read(path):
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except Exception:
        return None

def meminfo():
    data = {}
    for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
        key, value = line.split(":", 1)
        parts = value.strip().split()
        if parts:
            data[key] = int(parts[0]) * 1024
    return data

def cpu_info():
    raw = run(["lscpu"])
    info = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        info[key.strip()] = value.strip()
    return {
        "model": info.get("Model name") or platform.processor(),
        "architecture": info.get("Architecture"),
        "cores": int(info["CPU(s)"]) if info.get("CPU(s)", "").isdigit() else None,
        "threadsPerCore": int(info["Thread(s) per core"]) if info.get("Thread(s) per core", "").isdigit() else None,
        "sockets": int(info["Socket(s)"]) if info.get("Socket(s)", "").isdigit() else None,
    }

def load_average():
    try:
        return list(os.getloadavg())
    except Exception:
        return None

def network_info():
    raw = run(["ip", "-j", "addr", "show", "scope", "global", "up"])
    if not raw:
        return []
    interfaces = []
    for iface in json.loads(raw):
        name = iface.get("ifname", "")
        if name.startswith(VIRTUAL_PREFIXES):
            continue
        addresses = [
            item.get("local")
            for item in iface.get("addr_info", [])
            if item.get("family") in {"inet", "inet6"} and item.get("local")
        ]
        if addresses:
            interfaces.append({
                "name": name,
                "mac": iface.get("address"),
                "addresses": addresses,
            })
    return interfaces

def split_host_port(local):
    value = local.strip()
    if value.startswith("[") and "]:" in value:
        host, _, port = value[1:].partition("]:")
    elif ":" in value:
        host, _, port = value.rpartition(":")
    else:
        host, port = value, ""
    host = host.strip("[]")
    if host in {"*", "0.0.0.0", "::", ""}:
        host = "0.0.0.0"
    return host, int(port) if port.isdigit() else port

def listening_ports():
    raw = run(["ss", "-tulpenH"]) if command_exists("ss") else ""
    if not raw and command_exists("ss"):
        raw = run(["ss", "-tulnH"])
    rows = []
    for line in raw.splitlines():
        parts = line.split(None, 5)
        if len(parts) < 5:
            continue
        protocol = parts[0].lower()
        state = parts[1]
        local = parts[4]
        process = parts[5] if len(parts) > 5 else ""
        address, port = split_host_port(local)
        if address in {"127.0.0.1", "::1", "localhost"}:
            continue
        rows.append({
            "protocol": protocol,
            "state": state,
            "address": address,
            "port": port,
            "process": process,
        })
    return rows[:100]

def container_info():
    rows = []
    if command_exists("docker"):
        raw = run(["docker", "ps", "--format", "{{json .}}"])
        for line in raw.splitlines():
            try:
                item = json.loads(line)
            except Exception:
                continue
            rows.append({
                "runtime": "docker",
                "id": item.get("ID"),
                "name": item.get("Names"),
                "image": item.get("Image"),
                "status": item.get("Status"),
                "ports": item.get("Ports"),
            })
    if command_exists("podman"):
        raw = run(["podman", "ps", "--format", "json"])
        try:
            for item in json.loads(raw or "[]"):
                rows.append({
                    "runtime": "podman",
                    "id": item.get("Id"),
                    "name": ", ".join(item.get("Names", [])) if isinstance(item.get("Names"), list) else item.get("Names"),
                    "image": item.get("Image"),
                    "status": item.get("Status"),
                    "ports": item.get("Ports"),
                })
        except Exception:
            pass
    return rows[:50]

def systemctl_is_active(unit):
    return run(["systemctl", "is-active", unit]) == "active" if command_exists("systemctl") else False

def kubernetes_info():
    server_active = systemctl_is_active("k3s") or systemctl_is_active("k3s.service")
    agent_active = systemctl_is_active("k3s-agent") or systemctl_is_active("k3s-agent.service")
    server_path = Path("/var/lib/rancher/k3s/server").exists()
    agent_path = Path("/var/lib/rancher/k3s/agent").exists()
    role = None
    if server_active or server_path:
        role = "control-plane"
    elif agent_active or agent_path:
        role = "worker"
    version = run(["k3s", "--version"]).splitlines()[0] if command_exists("k3s") else None
    return {
        "role": role,
        "active": bool(role),
        "serverServiceActive": server_active,
        "agentServiceActive": agent_active,
        "version": version,
    }

def running_services():
    if not command_exists("systemctl"):
        return []
    raw = run(["systemctl", "list-units", "--type=service", "--state=running", "--no-legend", "--no-pager"])
    rows = []
    for line in raw.splitlines():
        cleaned = line.lstrip("● ").strip()
        parts = cleaned.split(None, 4)
        if not parts:
            continue
        rows.append({
            "unit": parts[0],
            "load": parts[1] if len(parts) > 1 else None,
            "active": parts[2] if len(parts) > 2 else None,
            "sub": parts[3] if len(parts) > 3 else None,
            "description": parts[4] if len(parts) > 4 else "",
        })
    return rows[:100]

def disks():
    raw = run(["df", "-P", "-B1", "-x", "tmpfs", "-x", "devtmpfs"])
    rows = []
    for line in raw.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 6:
            continue
        rows.append({
            "filesystem": parts[0],
            "sizeBytes": int(parts[1]),
            "usedBytes": int(parts[2]),
            "availableBytes": int(parts[3]),
            "mountpoint": parts[5],
        })
    return rows

memory = meminfo()
payload = {
    "agentVersion": os.environ.get("SERVER_SPECS_AGENT_VERSION", "unknown"),
    "collectedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "hostname": socket.gethostname(),
    "os": {
        "platform": platform.platform(),
        "release": platform.release(),
        "machine": platform.machine(),
    },
    "uptimeSeconds": float(read("/proc/uptime").split()[0]) if read("/proc/uptime") else None,
    "loadAverage": load_average(),
    "cpu": cpu_info(),
    "memory": {
        "totalBytes": memory.get("MemTotal"),
        "availableBytes": memory.get("MemAvailable"),
        "usedBytes": memory.get("MemTotal") - memory.get("MemAvailable") if memory.get("MemTotal") and memory.get("MemAvailable") else None,
    },
    "swap": {
        "totalBytes": memory.get("SwapTotal"),
        "freeBytes": memory.get("SwapFree"),
        "usedBytes": memory.get("SwapTotal") - memory.get("SwapFree") if memory.get("SwapTotal") is not None and memory.get("SwapFree") is not None else None,
    },
    "network": network_info(),
    "disks": disks(),
    "motherboard": {
        "vendor": read("/sys/class/dmi/id/board_vendor") or read("/sys/class/dmi/id/sys_vendor"),
        "model": read("/sys/class/dmi/id/board_name") or read("/sys/class/dmi/id/product_name"),
        "version": read("/sys/class/dmi/id/board_version") or read("/sys/class/dmi/id/product_version"),
    },
    "containers": container_info(),
    "kubernetes": kubernetes_info(),
    "services": running_services(),
    "listeningPorts": listening_ports(),
}
print(json.dumps(payload, separators=(",", ":")))
PY
}

PAYLOAD="$(collect_payload)"

curl -fsS \\
  -X POST \\
  -H "Authorization: Bearer $DEVICE_TOKEN" \\
  -H "Content-Type: application/json" \\
  --data "$PAYLOAD" \\
  "$ENDPOINT/api/agent/servers/$SERVER_ID/heartbeat" >/dev/null
AGENT

chmod 0755 /opt/homelab-inventory-agent/agent.sh

REGISTER_RESPONSE="$(
  curl -fsS \\
    -X POST \\
    -H "Authorization: Bearer $TOKEN" \\
    -H "Content-Type: application/json" \\
    --data '{"agentVersion":"'"$AGENT_VERSION"'"}' \\
    "$ENDPOINT/api/agent/servers/$SERVER_ID/register"
)"

DEVICE_TOKEN="$(printf '%s' "$REGISTER_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["deviceToken"])')"

{
  printf 'SERVER_ID=%s\n' "$SERVER_ID"
  printf 'ENDPOINT=%s\n' "$ENDPOINT"
  printf 'DEVICE_TOKEN=%s\n' "$DEVICE_TOKEN"
  printf 'AGENT_VERSION=%s\n' "$AGENT_VERSION"
} >/etc/homelab-inventory-agent/config.env

chmod 0600 /etc/homelab-inventory-agent/config.env

cat >/etc/systemd/system/homelab-inventory-agent.service <<'SERVICE'
[Unit]
Description=Homelab Inventory Agent
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/homelab-inventory-agent/agent.sh
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
SERVICE

cat >/etc/systemd/system/homelab-inventory-agent.timer <<'TIMER'
[Unit]
Description=Run Homelab Inventory Agent every minute

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
Unit=homelab-inventory-agent.service

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now homelab-inventory-agent.timer
systemctl start homelab-inventory-agent.service || true

echo "Homelab Inventory agent installed for $SERVER_ID."
`
}

const AGENT_DISABLED_MESSAGE = 'Agent features are disabled in public demo mode.'

function disabledAgentRoute(_request, response) {
  response.status(403).json({ message: AGENT_DISABLED_MESSAGE })
}

function compactAgentHostStatus(status) {
  const metrics = status.metrics ?? {}
  return {
    hostType: status.hostType,
    hostId: status.hostId,
    ...(status.hostType === 'server' ? { serverId: status.hostId } : {}),
    state: status.state,
    connected: status.connected,
    ageMs: status.ageMs,
    lastSeenAt: status.lastSeenAt,
    collectedAt: status.collectedAt ?? null,
    agentVersion: status.agentVersion,
    commandPlatform: agentCommandPlatform(metrics.system?.operatingSystem ?? metrics.system?.os),
    hostname: status.hostname ?? null,
    droppedSamples: status.droppedSamples,
    monitoringRevision: status.monitoringRevision,
    details: {
      metrics: Boolean(status.metrics || status.cpu || status.memory || status.uptimeSeconds !== undefined),
      services: Array.isArray(status.services) && status.services.length > 0,
      containers: Array.isArray(status.containers) && status.containers.length > 0,
      storage: (Array.isArray(status.storageHealth) && status.storageHealth.length > 0)
        || (Array.isArray(status.disks) && status.disks.length > 0)
        || (Array.isArray(metrics.filesystems) && metrics.filesystems.length > 0),
      network: (Array.isArray(status.network) && status.network.length > 0)
        || (Array.isArray(metrics.network) && metrics.network.length > 0),
      hardware: Boolean(status.motherboard),
    },
  }
}

export function publicAgentStatus(store, releaseService = null) {
  const fullSummary = store.getAgentStatusSummary()
  const hosts = Object.fromEntries(Object.entries(fullSummary.hosts ?? {}).map(([hostKey, status]) => [
    hostKey,
    compactAgentHostStatus(status),
  ]))
  if (releaseService) {
    const enrollments = store.listAgentEnrollments()
      .filter((enrollment) => typeof enrollment.endpoint === 'string')
      .sort((first, second) => second.id - first.id)
    for (const [hostKey, status] of Object.entries(fullSummary.hosts ?? {})) {
      const enrollment = enrollments.find((candidate) => recordMatchesHost(candidate, status.hostType, status.hostId))
      if (!enrollment || !releaseService.updateAvailable(status.agentVersion)) continue
      const native = status.capabilities?.['agent.native-update']?.state === 'available'
      const upgradeCommands = releaseService.upgradeCommands(enrollment.endpoint, { native })
      hosts[hostKey] = { ...hosts[hostKey], upgradeCommands }
    }
  }
  return {
    hosts,
    registeredHosts: fullSummary.registeredHosts ?? [],
    release: releaseService ? {
      version: releaseService.current().version,
      sourceRevision: releaseService.current().sourceRevision,
    } : null,
  }
}

/** @param {import('./persistence/store-contract.ts').HomelabInventoryPersistence} store */
export function registerAgentRoutes(app, store, {
  disabled = false,
  heartbeatRateLimit = HEARTBEAT_RATE_LIMIT,
  heartbeatRateWindowMs = HEARTBEAT_RATE_WINDOW_MS,
  releaseService = null,
  onAgentChanged = null,
} = {}) {
  if (disabled) {
    app.get('/api/agent/install.sh', disabledAgentRoute)
    app.get('/api/agent/status', disabledAgentRoute)
    app.post('/api/agent/enrollments', disabledAgentRoute)
    app.post('/api/agent/servers/:serverId/register', disabledAgentRoute)
    app.post('/api/agent/servers/:serverId/heartbeat', disabledAgentRoute)
    app.delete('/api/agent/servers/:serverId/registration', disabledAgentRoute)
    app.delete('/api/agent/servers/:serverId/status', disabledAgentRoute)

    return
  }

  const heartbeatBuckets = new Map()
  let lastHeartbeatSweepAt = 0

  function sweepHeartbeatBuckets(now) {
    if (now - lastHeartbeatSweepAt < heartbeatRateWindowMs) return

    const cutoff = now - heartbeatRateWindowMs
    for (const [deviceId, timestamps] of heartbeatBuckets) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff)
      if (recent.length === 0) heartbeatBuckets.delete(deviceId)
      else heartbeatBuckets.set(deviceId, recent)
    }
    lastHeartbeatSweepAt = now
  }

  function heartbeatAllowed(deviceId) {
    const now = Date.now()
    sweepHeartbeatBuckets(now)
    const cutoff = now - heartbeatRateWindowMs
    const recent = (heartbeatBuckets.get(deviceId) ?? []).filter((timestamp) => timestamp > cutoff)
    if (recent.length >= heartbeatRateLimit) return false
    recent.push(now)
    heartbeatBuckets.set(deviceId, recent)
    return true
  }

  app.get('/api/agent/install.sh', (_request, response) => {
    response.set('Cache-Control', 'no-store').type('text/x-shellscript').send(installScript())
  })

  app.get('/api/agent/status', (_request, response) => {
    response.json(publicAgentStatus(store, releaseService))
  })

  app.delete('/api/agent/servers/:serverId/registration', (request, response) => {
    const serverId = parseServerIdParam(request.params.serverId)

    if (!hostExists(store, 'server', serverId)) {
      response.status(404).json({ message: 'Server not found.' })
      return
    }

    const { revoked, revokedAt, revokedDeviceIds } = store.revokeAgentRegistration('server', serverId)
    for (const deviceId of revokedDeviceIds) heartbeatBuckets.delete(deviceId)
    if (revoked) onAgentChanged?.({ store, host: { hostType: 'server', hostId: serverId }, kind: 'registration' })
    response.json({ ok: true, serverId, revoked, revokedAt })
  })

  app.delete('/api/agent/servers/:serverId/status', (request, response) => {
    const serverId = parseServerIdParam(request.params.serverId)

    if (!hostExists(store, 'server', serverId)) {
      response.status(404).json({ message: 'Server not found.' })
      return
    }

    if (store.hasActiveAgentRegistration('server', serverId, { pendingEnrollmentsOnly: true })) {
      response.status(409).json({ message: 'Revoke the active agent registration before clearing runtime status.' })
      return
    }

    const result = store.clearAgentRuntimeData('server', serverId)
    onAgentChanged?.({ store, host: { hostType: 'server', hostId: serverId }, kind: 'status' })
    response.json(result)
  })

  app.post('/api/agent/enrollments', (request, response) => {
    const serverId = isRelationalId(request.body?.serverId) ? request.body.serverId : null

    if (!hostExists(store, 'server', serverId)) {
      response.status(404).json({ message: 'Server not found.' })
      return
    }

    let endpoint
    try {
      endpoint = request.body?.endpoint === undefined || request.body.endpoint === ''
        ? publicEndpoint(request)
        : normalizeAgentEndpoint(request.body.endpoint)
    } catch (error) {
      response.status(400).json({ message: error instanceof Error ? error.message : 'Agent endpoint is invalid.' })
      return
    }
    const token = createToken()
    const now = new Date()
    const createdAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + ENROLLMENT_TTL_MS).toISOString()
    const enrollment = store.createAgentEnrollment({
      hostType: 'server',
      hostId: serverId,
      tokenHash: hashToken(token),
      createdAt,
      expiresAt,
      endpoint,
    })

    response.set('Cache-Control', 'no-store').json({
      enrollmentId: enrollment.id,
      expiresAt,
      endpoint,
      installCommand: installCommand({ endpoint, serverId, token }),
    })
  })

  app.post('/api/agent/servers/:serverId/register', (request, response) => {
    const serverId = parseServerIdParam(request.params.serverId)
    const token = bearerToken(request)

    if (!token) {
      response.status(401).json({ message: 'Missing bearer token.' })
      return
    }

    if (!hostExists(store, 'server', serverId)) {
      response.status(404).json({ message: 'Server not found.' })
      return
    }

    const enrollment = findEnrollment(store, 'server', serverId, token)

    if (!enrollment) {
      response.status(403).json({ message: 'Enrollment token is invalid or expired.' })
      return
    }

    let agentVersion
    try {
      agentVersion = normalizeAgentVersion(request.body?.agentVersion)
    } catch (error) {
      response.status(400).json({ message: error instanceof Error ? error.message : 'Agent version is invalid.' })
      return
    }

    const deviceToken = createToken()
    const now = new Date().toISOString()
    const activated = store.activateAgentEnrollment({
      enrollmentId: enrollment.id,
      device: {
        hostType: 'server',
        hostId: serverId,
        tokenHash: hashToken(deviceToken),
        createdAt: now,
        lastSeenAt: null,
        agentVersion,
      },
    })
    for (const deviceId of activated.revokedDeviceIds) heartbeatBuckets.delete(deviceId)
    onAgentChanged?.({ store, host: { hostType: 'server', hostId: serverId }, kind: 'activation' })

    response.set('Cache-Control', 'no-store').json({
      deviceId: activated.device.id,
      deviceToken,
      heartbeatUrl: `/api/agent/servers/${serverId}/heartbeat`,
    })
  })

  app.post('/api/agent/servers/:serverId/heartbeat', (request, response) => {
    const serverId = parseServerIdParam(request.params.serverId)
    const token = bearerToken(request)

    if (!token) {
      response.status(401).json({ message: 'Missing bearer token.' })
      return
    }

    const device = findDevice(store, 'server', serverId, token)

    if (!device) {
      response.status(403).json({ message: 'Device token is invalid.' })
      return
    }

    if (!heartbeatAllowed(device.id)) {
      response.status(429).json({ message: 'Too many heartbeat requests. Please try again shortly.' })
      return
    }

    const now = new Date().toISOString()
    let heartbeat
    try {
      heartbeat = normalizeHeartbeat(request.body ?? {})
    } catch (error) {
      response.status(400).json({ message: error instanceof Error ? error.message : 'Heartbeat payload is invalid.' })
      return
    }

    store.recordAgentHeartbeat({
      deviceId: device.id,
      host: { hostType: 'server', hostId: serverId },
      status: {
        lastSeenAt: now,
        ...heartbeat,
      },
    })
    onAgentChanged?.({ store, host: { hostType: 'server', hostId: serverId }, kind: 'heartbeat' })

    response.json({ ok: true, receivedAt: now })
  })
}
