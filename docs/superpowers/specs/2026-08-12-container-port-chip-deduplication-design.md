# Container Port Chip Deduplication

## Goal

Display each unique container port mapping once and make the host-to-container direction readable without separate protocol-only chips.

## Design

Normalize reported container ports in the presentation formatter. A mapping is uniquely identified by its host port, container port, and lowercase protocol. Repeated entries with the same tuple, including equivalent IPv4 and IPv6 Docker bindings, collapse into one display chip.

Each mapping renders as one chip:

```text
H 6881 → C 6881 · TCP
```

TCP and UDP mappings using the same port numbers remain separate because they represent distinct transport bindings. Service and network chips retain their current behavior.

This is intentionally a presentation-layer correction. It immediately fixes existing persisted telemetry and avoids an agent release, backend migration, or telemetry rewrite.

## Testing

- Verify one raw mapping produces one combined chip.
- Verify duplicate mappings produce one chip.
- Verify TCP and UDP mappings with the same ports remain distinct.
- Verify separate host-to-container mappings remain distinct.
- Verify the old standalone host, container, and protocol chips are absent.

## Release Notes

The fix is user-visible and belongs in the unreleased changelog and structured release-note draft. It does not create a version or tag until the next requested deployment.
