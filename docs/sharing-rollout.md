# lab.gd Coordinated Rollout

Homelab Inventory and lab.gd can be released independently, but publication
must stay fail-closed until their versioned contracts and capabilities agree.
This procedure verifies that boundary without using a real inventory share.

## Before Deployment

1. Verify the exact published versions and npm integrity values for
   `@homelab-inventory/share-contract`, `viewer-model`, and `viewer-react`.
2. Run Homelab Inventory lint, tests, build, migration checks, and the complete
   dual-architecture container security gate.
3. Run the lab.gd frozen install, tests, builds, migration review, package
   evidence check, four-image vulnerability gate, and container probes.
4. Preserve each environment's sharing UUID, Ed25519 key, credentials,
   recovery key, public-ID key, and SQLite projection. Never synchronize these
   files between installations.
5. Create and verify the standard matched SkyBolt deployment backups. Never
   connect directly to SkyArk.

The application conformance suite uses two independent temporary installation
directories and a protocol simulator. It proves separate UUIDs and Ed25519
keys, signed activation, nonce replay rejection, scoped requests, and share
ownership isolation without requiring the deployable lab.gd service.

## Deployment Order

1. Deploy lab.gd with publication disabled until package evidence, PostgreSQL
   migrations, API readiness, renderer readiness, and capability reporting all
   pass.
2. Deploy Homelab Inventory with automatic production enrollment enabled.
   Demo and staging must remain disabled and must not create identity files.
3. Wait for the production installation to report `connected`. A prior user
   opt-out remains authoritative and is not overridden by startup.
4. Run the read-only verifier:

   ```bash
   HLI_ORIGIN=https://inventory.example.com \
   LABGD_ORIGIN=https://lab.gd \
   HLI_SESSION_COOKIE='session-cookie-name=session-value' \
   bun run sharing:integration:check
   ```

5. Verify restart idempotency: the app retains the same UUID, key hash,
   credentials, public-ID key hash, remote installation ID, and connected
   projection after restart.
6. Use a disposable installation to publish one synthetic share, update it,
   unpublish it, and delete it. Do not use production inventory for protocol
   certification.
7. Confirm the second disposable installation cannot read, modify, claim, or
   reuse the first installation's public share ID.
8. Enable publication for normal users only after all checks pass.

## Failure And Rollback

- A capability, package, contract, readiness, or scope mismatch blocks the
  affected UI and operation. Do not weaken validation to continue deployment.
- Roll back the application image without restoring data when its ordered
  migration remains backward-compatible. Otherwise use the matched backup and
  documented migration rollback together.
- Roll back lab.gd code and database migrations as one reviewed unit. Keep the
  prior active share revision available while publication staging fails.
- Never replace a production installation UUID, private key, or public-ID key
  to recover connectivity. Restore the matching identity backup or use the
  authenticated recovery flow.
- Preserve the previous remote revision until a content-addressed update is
  fully staged and atomically activated.

## Required Evidence

Record the application and lab.gd commits, package versions and integrities,
database migration versions, image digests, vulnerability results, backup
paths, health responses, verifier output, installation identity hashes before
and after restart, and the disposable two-installation ownership result.
Never include tokens, cookies, private keys, passwords, or private inventory in
the deployment handoff.
