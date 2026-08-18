# Application Live Events

Homelab Inventory uses one authenticated Server-Sent Events connection for server-to-browser state changes. The browser opens `/api/events` with the topics currently mounted by the interface and keeps ordinary REST queries as the canonical source of data.

Events are compact invalidation signals. They do not carry inventory, telemetry, notification configuration, credentials, or other canonical records. Per-topic sequence cursors close the initial query/stream race and refetch only affected queries after relevant events, missed topic changes, or a server generation change.

Current topics cover project Systems state, Agent fleet status, individual host telemetry and hardware evidence, notification summaries and incidents, release status, and demo-session changes. Topic authorization uses the same application permissions as the corresponding REST endpoint, and project and demo streams remain scoped to their resolved store.

The connection closes while the browser document is hidden and reconnects when it becomes visible. SSE heartbeat comments keep proxies from considering an idle connection abandoned; they do not cause application requests or query updates.

Browser data hooks must not use `refetchInterval` or schedule network requests from `setInterval`. The source regression test in `src/live-events/no-browser-polling.test.ts` enforces that boundary. Server-side schedulers and local display timers remain valid when they do not create periodic browser traffic.
