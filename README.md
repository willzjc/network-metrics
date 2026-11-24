# Network metrics

Public dashboard for a boutique ISP's upstream (Vision) connection, rendered with
[D3](https://d3js.org) and [Observable Plot](https://observablehq.com/plot/).

The page is static. Data in [`data/`](data/) is published by
[vision-watch](https://github.com/willzjc/network-metrics#how-data-gets-here):
- a monitor that measures TCP, DNS and HTTPS (no ping)
- wired-first, with an allowed-Wi-Fi fallback
- collects and publishes only on the home network (recognised by the home router), so
  mobile, office or other networks never contaminate the data
- aggregates measurements into minute buckets before publishing

Grey bands in the heartbeat mean monitoring was paused (away from home, offline or router
not recognised): nothing was measured, which is not an outage. Outages measured while at
home show as failures in the charts.

## What is published, and what is not

Published, allowlisted fields only:
- target labels, scopes and thresholds
- per-minute worst status, mean/max latency, failed-attempt rate and flap counts
- the local access path (wired / Wi-Fi / none) and Wi-Fi RSSI
- a per-minute suspected fault domain
- incident start/duration, KPIs and generation time
- opt-in diagnostic counts by UTC minute: completed cycles, longest cycle,
  gaps marked at the next completed cycle, monitor starts/stops, route snapshot
  changes, diagnostic/probe errors, access path changes, Wi-Fi roams, monitoring
  pause/resume counts (never the reason or location), and observed
  interface-counter increases. No recorded increase does not mean the interface
  supports the counter.

Never published:
- IP addresses, MAC addresses or Wi-Fi network names
- access point IDs (BSSIDs), which can geolocate a router
- hostnames, route tables, command arguments/output, or raw event messages

The publisher blocks a publish if anything resembling an IP, a MAC or a configured
private string appears. The check runs again before every commit.

## Reading the fault domains

| Domain | Meaning |
|---|---|
| `provider-edge` | Provider and internet targets recorded problems in the same minute. Verify that local checks passed in the same cycles. |
| `upstream` | Internet targets recorded problems without a matching provider-target failure. The handoff might not have been tested. |
| `provider-only` | Only the handoff target failed. |
| `dns` | Only DNS failed. |
| `local` | The local gateway/CPE failed. |
| `access`, `access-degraded` | The monitor's own connection was missing or weak. Never blamed upstream. |

One vantage point cannot prove which operator caused a fault. A heartbeat gap
is missing evidence, not downtime. Correlate the UTC timeline with a second
monitor at the ISP edge and with the provider's WAN counters and session events.

## How data gets here

The monitor service writes the sanitized feed to a protected directory. A
user-level task runs `vision-watch publish-push`, which copies the feed into
`data/`, re-checks it, then commits and pushes. Commits use a GitHub no-reply
address.

Third-party code: `assets/vendor/` contains D3 7.9.2 and Observable Plot 0.6.19,
both ISC licensed (see the licence files there).
