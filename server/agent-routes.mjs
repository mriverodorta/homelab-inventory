import { createNumericId, createToken, hashToken, timingSafeEqualString } from './db/agent-auth.mjs'
import { isRelationalId } from './db/relational-ids.mjs'

const ENROLLMENT_TTL_MS = 24 * 60 * 60 * 1000
const AGENT_VERSION = '0.2.0'

function bearerToken(request) {
  const header = request.get('authorization') ?? ''
  const [type, token] = header.split(/\s+/, 2)

  return type?.toLowerCase() === 'bearer' && token ? token : null
}

function publicEndpoint(request) {
  const forwardedProto = request.get('x-forwarded-proto')
  const forwardedHost = request.get('x-forwarded-host')
  const protocol = forwardedProto ?? request.protocol
  const host = forwardedHost ?? request.get('host')

  return `${protocol}://${host}`
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

function serverExists(store, serverId) {
  const server = !isRelationalId(serverId)
    ? null
    : store.getProject().items[`server:${serverId}`]

  return server?.type === 'server'
}

function findEnrollment(store, serverId, token) {
  const tokenHash = hashToken(token)

  return Object.values(store.databases.agents.data.enrollments ?? {}).find((enrollment) =>
    enrollment.serverId === serverId &&
    !enrollment.usedAt &&
    !enrollment.revokedAt &&
    Date.parse(enrollment.expiresAt) > Date.now() &&
    timingSafeEqualString(enrollment.tokenHash, tokenHash),
  )
}

function findDevice(store, serverId, token) {
  const tokenHash = hashToken(token)

  return Object.values(store.databases.agents.data.devices ?? {}).find((device) =>
    device.serverId === serverId &&
    !device.revokedAt &&
    timingSafeEqualString(device.tokenHash, tokenHash),
  )
}

function normalizeHeartbeat(payload) {
  return {
    agentVersion: typeof payload.agentVersion === 'string' ? payload.agentVersion : AGENT_VERSION,
    collectedAt: typeof payload.collectedAt === 'string' ? payload.collectedAt : null,
    hostname: typeof payload.hostname === 'string' ? payload.hostname : null,
    os: payload.os && typeof payload.os === 'object' ? payload.os : null,
    uptimeSeconds: typeof payload.uptimeSeconds === 'number' ? payload.uptimeSeconds : null,
    loadAverage: Array.isArray(payload.loadAverage) ? payload.loadAverage : null,
    cpu: payload.cpu && typeof payload.cpu === 'object' ? payload.cpu : null,
    memory: payload.memory && typeof payload.memory === 'object' ? payload.memory : null,
    swap: payload.swap && typeof payload.swap === 'object' ? payload.swap : null,
    disks: Array.isArray(payload.disks) ? payload.disks : [],
    network: Array.isArray(payload.network) ? payload.network : [],
    motherboard: payload.motherboard && typeof payload.motherboard === 'object' ? payload.motherboard : null,
    containers: Array.isArray(payload.containers) ? payload.containers : [],
    kubernetes: payload.kubernetes && typeof payload.kubernetes === 'object' ? payload.kubernetes : null,
    services: Array.isArray(payload.services) ? payload.services : [],
    listeningPorts: Array.isArray(payload.listeningPorts) ? payload.listeningPorts : [],
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

# shellcheck disable=SC1090
source "$CONFIG_FILE"

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

cat >/etc/homelab-inventory-agent/config.env <<CONFIG
SERVER_ID="$SERVER_ID"
ENDPOINT="$ENDPOINT"
DEVICE_TOKEN="$DEVICE_TOKEN"
AGENT_VERSION="$AGENT_VERSION"
CONFIG

chmod 0600 /etc/homelab-inventory-agent/config.env

cat >/etc/systemd/system/homelab-inventory-agent.service <<'SERVICE'
[Unit]
Description=Homelab Inventory Agent
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/homelab-inventory-agent/agent.sh
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

export function registerAgentRoutes(app, store, { disabled = false } = {}) {
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

  app.get('/api/agent/install.sh', (_request, response) => {
    response.type('text/x-shellscript').send(installScript())
  })

  app.get('/api/agent/status', (_request, response) => {
    response.json(store.getAgentStatusSummary())
  })

  app.delete('/api/agent/servers/:serverId/registration', (request, response) => {
    const serverId = parseServerIdParam(request.params.serverId)

    if (!serverExists(store, serverId)) {
      response.status(404).json({ message: 'Server not found.' })
      return
    }

    const revokedAt = new Date().toISOString()
    let revoked = 0

    for (const collection of [
      store.databases.agents.data.enrollments ?? {},
      store.databases.agents.data.devices ?? {},
    ]) {
      for (const record of Object.values(collection)) {
        if (record.serverId === serverId && !record.revokedAt) {
          record.revokedAt = revokedAt
          revoked += 1
        }
      }
    }

    if (revoked > 0) store.scheduleFlush('agents')
    response.json({ ok: true, serverId, revoked, revokedAt })
  })

  app.delete('/api/agent/servers/:serverId/status', (request, response) => {
    const serverId = parseServerIdParam(request.params.serverId)

    if (!serverExists(store, serverId)) {
      response.status(404).json({ message: 'Server not found.' })
      return
    }

    const activeEnrollment = Object.values(store.databases.agents.data.enrollments ?? {}).some((record) =>
      record.serverId === serverId
        && !record.revokedAt
        && !record.usedAt
        && (!record.expiresAt || Date.parse(record.expiresAt) > Date.now()),
    )
    const activeDevice = Object.values(store.databases.agents.data.devices ?? {}).some((record) =>
      record.serverId === serverId && !record.revokedAt,
    )

    if (activeEnrollment || activeDevice) {
      response.status(409).json({ message: 'Revoke the active agent registration before clearing runtime status.' })
      return
    }

    response.json(store.clearAgentRuntimeData(serverId))
  })

  app.post('/api/agent/enrollments', (request, response) => {
    const serverId = isRelationalId(request.body?.serverId) ? request.body.serverId : null

    if (!serverExists(store, serverId)) {
      response.status(404).json({ message: 'Server not found.' })
      return
    }

    const endpoint = typeof request.body?.endpoint === 'string' && request.body.endpoint.trim()
      ? request.body.endpoint.trim().replace(/\/$/, '')
      : publicEndpoint(request)
    const token = createToken()
    const enrollmentId = createNumericId(Object.keys(store.databases.agents.data.enrollments))
    const now = new Date()
    const expiresAt = new Date(now.getTime() + ENROLLMENT_TTL_MS).toISOString()

    store.databases.agents.data.enrollments[enrollmentId] = {
      id: enrollmentId,
      serverId,
      tokenHash: hashToken(token),
      createdAt: now.toISOString(),
      expiresAt,
      endpoint,
    }
    store.scheduleFlush('agents')

    response.json({
      enrollmentId,
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

    if (!serverExists(store, serverId)) {
      response.status(404).json({ message: 'Server not found.' })
      return
    }

    const enrollment = findEnrollment(store, serverId, token)

    if (!enrollment) {
      response.status(403).json({ message: 'Enrollment token is invalid or expired.' })
      return
    }

    const deviceToken = createToken()
    const deviceId = createNumericId(Object.keys(store.databases.agents.data.devices))
    const now = new Date().toISOString()

    enrollment.usedAt = now
    store.databases.agents.data.devices[deviceId] = {
      id: deviceId,
      serverId,
      tokenHash: hashToken(deviceToken),
      createdAt: now,
      lastSeenAt: null,
      agentVersion: typeof request.body?.agentVersion === 'string' ? request.body.agentVersion : AGENT_VERSION,
    }
    store.scheduleFlush('agents')

    response.json({
      deviceId,
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

    const device = findDevice(store, serverId, token)

    if (!device) {
      response.status(403).json({ message: 'Device token is invalid.' })
      return
    }

    const now = new Date().toISOString()
    const heartbeat = normalizeHeartbeat(request.body ?? {})

    device.lastSeenAt = now
    device.agentVersion = heartbeat.agentVersion
    store.databases.agentStatus.data.servers[serverId] = {
      serverId,
      lastSeenAt: now,
      ...heartbeat,
    }
    store.scheduleFlush('agents')
    store.scheduleFlush('agentStatus')

    response.json({ ok: true, receivedAt: now })
  })
}
