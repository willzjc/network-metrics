# Network metrics

Public dashboard for a boutique ISP's upstream (Vision) connection, rendered with
[D3](https://d3js.org) and [Observable Plot](https://observablehq.com/plot/).

The page is static. Data in [`data/`](data/) is published by
[vision-watch](https://github.com/willzjc/network-metrics#how-data-gets-here):
- a monitor that measures TCP, DNS and HTTPS (no ping)
- wired-first, with an allowed-Wi-Fi fallback
- aggregates measurements into minute buckets before publishing

## What is published, and what is not

Published, allowlisted fields only:
- target labels, scopes and thresholds
- per-minute worst status, mean/max latency, failed-attempt rate and flap counts
- the local access path (wired / Wi-Fi / none) and Wi-Fi RSSI
- a per-minute fault domain
- incident start/duration, KPIs and generation time

Never published:
- IP addresses, MAC addresses or Wi-Fi network names
- access point IDs (BSSIDs), which can geolocate a router
- hostnames, routes or raw diagnostics

The publisher blocks a publish if anything resembling an IP, a MAC or a configured
private string appears. The check runs again before every commit.

## Reading the fault domains

| Domain | Meaning |
|---|---|
| `provider-edge` | Provider handoff and independent internet targets failed together while the local link and gateway were fine. This is the strongest provider-side signal. |
| `upstream` | Internet targets failed while the handoff answered. The fault is beyond the handoff. |
| `provider-only` | Only the handoff target failed. |
| `dns` | Only DNS failed. |
| `local` | The local gateway/CPE failed. |
| `access`, `access-degraded` | The monitor's own connection was missing or weak. Never blamed upstream. |

One vantage point cannot prove which operator caused a fault. Correlate these
times with the provider's own counters and events.

## How data gets here

The monitor service writes the sanitized feed to a protected directory. A
user-level task runs `vision-watch publish-push`, which copies the feed into
`data/`, re-checks it, then commits and pushes. Commits use a GitHub no-reply
address.

Third-party code: `assets/vendor/` contains D3 7.9.2 and Observable Plot 0.6.19,
both ISC licensed (see the licence files there).
