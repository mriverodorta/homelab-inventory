# Application Live Events

Homelab Inventory uses one authenticated Server-Sent Events connection for server-to-browser state changes. The browser opens `/api/events` with the topics currently mounted by the interface and keeps ordinary REST queries as the canonical source for initial load and recovery.

Small authorized projections and deltas travel directly in events. Systems receives one changed live row, and an open Agent Inspector receives one new minute sample plus changed latest-state telemetry entities. Events never carry inventory, credentials, notification configuration, or complete telemetry history. Per-topic sequence cursors close the initial query/stream race; REST refetches are limited to missed topic changes, a server generation change, or an explicitly oversized update.

Current topics cover project Systems state, Agent fleet status, individual host telemetry and hardware evidence, notification summaries and incidents, release status, and demo-session changes. Topic authorization uses the same application permissions as the corresponding REST endpoint, and project and demo streams remain scoped to their resolved store.

The connection closes while the browser document is hidden and reconnects when it becomes visible. SSE heartbeat comments keep proxies from considering an idle connection abandoned; they do not cause application requests or query updates.

A topic's first `stream-ready` frame trusts the consumer's concurrent initial REST snapshot and records the server cursor without issuing a second request. Later reconnects compare that cursor and resynchronize only when the topic advanced while the stream was unavailable or the server generation changed.

Browser data hooks must not use `refetchInterval` or schedule network requests from `setInterval`. The source regression test in `src/live-events/no-browser-polling.test.ts` enforces that boundary. Server-side schedulers and local display timers remain valid when they do not create periodic browser traffic.
