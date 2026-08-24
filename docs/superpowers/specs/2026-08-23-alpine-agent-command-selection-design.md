# Alpine Agent Command Selection Design

## Problem

Agent `0.3.4` supports Alpine Linux and OpenRC, but the Homelab Inventory Agent
setup UI still offers only generic Linux and FreeBSD/OPNsense targets. The
generic Linux command pipes the installer through `sudo sh`. A standard Alpine
installation may not include `sudo`, and operators commonly perform host setup
from an existing root shell. The generated command therefore fails before the
Alpine-capable installer starts.

The same platform distinction must apply to later update and elevated hardware
inventory commands. Fixing only the initial setup command would leave an
installed Alpine Agent with unusable maintenance instructions.

## Platform Model

The application will expose three command targets:

- `linux`: conventional Linux host where privileged commands use `sudo`.
- `alpine`: Alpine Linux host where commands assume an existing root shell and
  never reference `sudo`.
- `freebsd`: FreeBSD and OPNsense hosts using the existing FreeBSD installer.

Alpine reuses the Linux AMD64/ARM64 Agent artifacts and Linux installer. This
is command selection, not another Agent build target or protocol variant.

## Generated Commands

The release service will return all three typed commands.

Initial installation:

- Linux: `curl ... | sudo sh -s -- ...`
- Alpine: `curl ... | sh -s -- ...`
- FreeBSD/OPNsense: `fetch ... | sudo sh -s -- ...`

Native update:

- Linux: `sudo homelab-inventory-agent update`
- Alpine: `homelab-inventory-agent update`
- FreeBSD/OPNsense: `sudo homelab-inventory-agent update`

Legacy installer update follows the same privilege prefixes as initial
installation. Hardware inventory uses `homelab-inventory-agent inventory` on
Alpine and the existing `sudo` command elsewhere.

The Alpine installer continues to enforce that installation is actually
running as root. The UI does not install `sudo`, call `apk add`, or weaken file
and service ownership.

## UI And Runtime Selection

The Agent setup selector adds `Alpine Linux` as a first-class option and reads
the `alpine` command returned by the backend. It does not remove `sudo` with a
frontend string replacement.

After enrollment, command selection uses the Agent-reported operating system:

- An operating-system value containing `alpine` selects `alpine`.
- A value containing `freebsd` or `opnsense` selects `freebsd`.
- Other and unknown values select `linux` for backward compatibility.

This platform helper is shared by the Inspector update command, hardware scan
command, and Systems update action so those surfaces cannot diverge.

## Compatibility

Adding `alpine` is an additive response-field change. Existing clients continue
to read `linux` and `freebsd`. Existing Agents require no re-enrollment, local
configuration change, or protocol migration.

## Tests

Regression coverage will prove:

1. Enrollment responses contain Linux, Alpine, and FreeBSD commands.
2. Alpine installation and legacy-update commands use the Linux installer and
   contain no `sudo`.
3. Alpine native update and hardware inventory commands contain no `sudo`.
4. Linux and FreeBSD command output remains unchanged.
5. The setup selector renders all three targets and copies the selected exact
   backend command.
6. Alpine telemetry selects Alpine update and inventory commands.
7. FreeBSD/OPNsense and unknown-platform fallback behavior remains stable.
8. Demo mode still disables Agent enrollment for every target.

## Release

This user-visible correction ships with the expired LabGD credential recovery
in application patch `0.15.3`. Update the unreleased structured release notes
and `CHANGELOG.md`, then run lint, the full test suite, the production build,
and the mandatory dual-architecture container security gate before deployment.
