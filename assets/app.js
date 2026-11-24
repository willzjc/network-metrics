"use strict";

(async function main() {
  const STATUS = { 0: "No data", 1: "OK", 2: "Unknown / not tested", 3: "Degraded", 4: "Down" };
  const STATUS_COLOR = { 0: "#1a2340", 1: "#2fd08a", 2: "#5c6782", 3: "#ffcc4d", 4: "#ff5d6c" };
  const PATH = { 0: "No data", 1: "Wired", 2: "Wi-Fi", 3: "No connection" };
  const PATH_COLOR = { 0: "#1a2340", 1: "#3d8bfd", 2: "#a855f7", 3: "#ff5d6c" };
  const DOMAIN_COLOR = {
    healthy: "#1f9e6b", access: "#9b59b6", local: "#ff9f43", "provider-edge": "#ff4757",
    upstream: "#ff6b81", dns: "#48a9ff", "provider-only": "#00cec9", "access-degraded": "#b39ddb",
  };
  const DOMAIN_SEVERITY = {
    "provider-edge": 8, access: 7, upstream: 6, local: 5, "provider-only": 4, dns: 3, "access-degraded": 2, healthy: 1,
  };
  const DOMAIN_HELP = {
    healthy: "Every tested target answered within its thresholds.",
    "provider-edge": "Provider and internet targets showed problems in the same minute. " +
      "Check whether the local gateway also passed in the same cycles before attributing this to Vision.",
    upstream: "Internet targets showed problems without a matching provider failure in that minute. " +
      "The handoff may not have been tested; check the individual results.",
    "provider-only": "Only the provider handoff target failed; internet targets still worked. Possibly filtering " +
      "or control-plane load on the handoff device rather than a forwarding outage.",
    dns: "Only DNS failed while TCP/HTTP to IP addresses worked: a resolver problem, not a link flap.",
    local: "A local target (LAN gateway/CPE) failed: a problem on your side of the handoff.",
    access: "The monitor had no usable connection (cable out and no allowed Wi-Fi). Local; not evidence against the provider.",
    "access-degraded": "The monitor's own link was degraded (interface errors, weak Wi-Fi or roaming). Not blamed upstream.",
  };
  const PROVIDER_DOMAINS = ["provider-edge", "upstream", "provider-only"];

  const tooltip = document.getElementById("tooltip");
  const fmtTime = d3.timeFormat("%a %d %b %H:%M");
  const fmtShort = d3.timeFormat("%H:%M");

  function duration(seconds) {
    if (seconds == null || !isFinite(seconds)) return "–";
    if (seconds < 90) return `${Math.round(seconds)} s`;
    if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
    if (seconds < 172800) return `${(seconds / 3600).toFixed(1)} h`;
    return `${(seconds / 86400).toFixed(1)} d`;
  }

  function ago(ms) {
    return duration(Math.max(0, (Date.now() - ms) / 1000)) + " ago";
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function showTooltip(event, title, rows) {
    tooltip.replaceChildren(element("b", null, title));
    for (const [label, value, color] of rows) {
      const row = element("div", "row");
      const name = element("span", null, label);
      if (color) name.style.color = color;
      row.append(name, element("span", null, value));
      tooltip.append(row);
    }
    tooltip.hidden = false;
    const x = Math.min(event.clientX + 16, window.innerWidth - tooltip.offsetWidth - 8);
    const y = Math.min(event.clientY + 16, window.innerHeight - tooltip.offsetHeight - 8);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function empty(container, message) {
    container.replaceChildren(element("div", "empty", message));
  }

  async function getJSON(path) {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }

  let index;
  try {
    index = await getJSON("data/index.json");
  } catch (error) {
    document.getElementById("subtitle").textContent = "No published data yet. Run vision-watch publish-push.";
    document.getElementById("live-text").textContent = "No data";
    empty(document.getElementById("heartbeat"), "Diagnostic feed unavailable.");
    return;
  }

  const targets = index.targets || [];
  const domainName = (code) => (code == null ? null : index.domains[String(code)] || "healthy");
  const targetColor = d3.scaleOrdinal(targets.map((t) => t.id), d3.schemeTableau10);
  const labelOf = Object.fromEntries(targets.map((t) => [t.id, t.label]));

  const documents = await Promise.all((index.days || []).map((day) =>
    getJSON(`data/days/${day}.json`).catch(() => null)));
  const rows = [], diagnostics = [];
  for (const doc of documents) {
    if (!doc) continue;
    for (const [minute, health] of Object.entries(doc.diagnostics || {})) {
      diagnostics.push({ ...health, t: (doc.t0 + Number(minute) * doc.step) * 1000 });
    }
    for (let i = 0; i < 1440; i += 1) {
      const access = doc.access || {};
      const hasTarget = targets.some((t) => (doc.targets?.[t.id]?.s[i] || 0) > 0);
      if (!hasTarget && !(access.s?.[i] > 0) && doc.domain?.[i] == null) continue;
      const row = {
        t: (doc.t0 + i * doc.step) * 1000, a: access.s?.[i] || 0, p: access.p?.[i] || 0,
        r: access.r?.[i] ?? null, d: domainName(doc.domain?.[i]), s: {}, l: {}, x: {}, c: {},
      };
      for (const target of targets) {
        const series = doc.targets?.[target.id];
        if (!series) continue;
        row.s[target.id] = series.s[i] || 0;
        row.l[target.id] = series.l[i] ?? null;
        row.x[target.id] = series.x[i] ?? null;
        row.c[target.id] = series.c[i] || 0;
      }
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.t - b.t);
  diagnostics.sort((a, b) => a.t - b.t);

  const generated = index.generated_at * 1000;
  document.getElementById("title").textContent = index.label || "Network metrics";
  document.getElementById("subtitle").textContent =
    `Provider: ${index.provider} · ${targets.length} targets · feed updated ${ago(generated)} ` +
    `(${fmtTime(new Date(generated))})`;
  document.getElementById("footer").textContent =
    `${index.generator} · schema ${index.schema} · ${rows.length} published minutes · Charts: D3 and Observable Plot`;

  const live = document.getElementById("live");
  const liveText = document.getElementById("live-text");
  const latest = rows[rows.length - 1];
  if (!latest) {
    liveText.textContent = "No data";
  } else if (Date.now() - generated > 30 * 60 * 1000) {
    live.className = "status-pill warn";
    liveText.textContent = `Feed stale · ${ago(generated)}`;
  } else {
    const domain = latest.d;
    live.className = `status-pill ${domain === "healthy" ? "ok" : PROVIDER_DOMAINS.includes(domain) || domain === "access" ? "bad" : "warn"}`;
    liveText.textContent = !domain ? "No fault-domain observation" : domain === "healthy" ? "Latest probes OK" : `Latest lead: ${domain}`;
  }

  const legend = document.getElementById("legend");
  for (const [name, color] of Object.entries(DOMAIN_COLOR)) {
    const item = element("span");
    const swatch = element("i");
    swatch.style.background = color;
    item.append(swatch, document.createTextNode(name));
    legend.append(item);
  }
  const help = document.getElementById("domain-help");
  for (const [name, text] of Object.entries(DOMAIN_HELP)) {
    const term = element("dt", null, name);
    term.style.color = DOMAIN_COLOR[name];
    help.append(term, element("dd", null, text));
  }

  if (!rows.length) {
    for (const id of ["timeline", "latency", "flaps", "domains", "heatmap", "access", "incident-durations"]) {
      empty(document.getElementById(id), "No data published yet.");
    }
    const bounds = diagnostics.length ? [diagnostics[0].t, diagnostics.at(-1).t + 60000] : null;
    monitorHealth(bounds);
    return;
  }

  const dataStart = Math.min(rows[0].t, diagnostics[0]?.t ?? Infinity);
  const dataEnd = Math.max(rows.at(-1).t, diagnostics.at(-1)?.t ?? -Infinity) + 60000;
  let view = [Math.max(dataStart, dataEnd - 24 * 3600 * 1000), dataEnd];

  function rowsIn([start, end]) {
    const lo = d3.bisector((r) => r.t).left(rows, start);
    const hi = d3.bisector((r) => r.t).left(rows, end);
    return rows.slice(lo, hi);
  }

  function buckets([start, end], count) {
    const size = (end - start) / count;
    const result = Array.from({ length: count }, (_, i) => ({ t0: start + i * size, t1: start + (i + 1) * size, rows: [] }));
    for (const row of rowsIn([start, end])) {
      result[Math.min(count - 1, Math.floor((row.t - start) / size))].rows.push(row);
    }
    return result;
  }

  const worst = (values) => values.reduce((a, b) => Math.max(a, b || 0), 0);
  function worstDomain(list) {
    let best = null;
    for (const row of list) {
      if (row.d && (!best || DOMAIN_SEVERITY[row.d] > DOMAIN_SEVERITY[best])) best = row.d;
    }
    return best;
  }
  const pathOf = (list) => (list.some((r) => r.p === 3) ? 3 : list.some((r) => r.p === 2) ? 2 : list.some((r) => r.p === 1) ? 1 : 0);
  const mean = (values) => {
    const usable = values.filter((v) => v != null);
    return usable.length ? d3.mean(usable) : null;
  };

  function kpis() {
    const selected = rowsIn(view);
    const container = document.getElementById("kpis");
    container.replaceChildren();
    const card = (label, value, detail, tone) => {
      const node = element("div", `kpi ${tone || ""}`);
      node.append(element("div", "label", label), element("div", "value", value), element("div", "detail", detail));
      container.append(node);
    };
    let tested = 0;
    let good = 0;
    for (const row of selected) {
      for (const target of targets) {
        const code = row.s[target.id];
        if (code === 1 || code === 3 || code === 4) {
          tested += 1;
          if (code !== 4) good += 1;
        }
      }
    }
    const availability = tested ? (100 * good) / tested : null;
    card("Minute availability", availability == null ? "–" : `${availability.toFixed(availability > 99.9 ? 3 : 2)}%`,
      "tested target-minutes that answered", availability == null ? "" : availability >= 99.9 ? "good" : availability >= 99 ? "warn" : "bad");
    const observed = selected.filter((r) => r.d).length;
    const problem = selected.filter((r) => r.d && r.d !== "healthy").length;
    const provider = selected.filter((r) => PROVIDER_DOMAINS.includes(r.d)).length;
    card("Problem minutes", String(problem), `${observed ? ((100 * problem) / observed).toFixed(1) : 0}% of ${observed} observed`, problem ? "warn" : "good");
    card("Provider/upstream minutes", String(provider), "provider-edge + upstream + provider-only", provider ? "bad" : "good");
    const flaps = d3.sum(selected, (r) => d3.sum(targets, (t) => r.c[t.id] || 0));
    const hours = Math.max((view[1] - view[0]) / 3600000, 1 / 60);
    card("Flaps", String(flaps), `${(flaps / hours).toFixed(2)} per hour`, flaps ? "warn" : "good");
    const incidents = incidentsIn(view);
    const closed = incidents.filter((i) => !i.open);
    card("Incidents", String(incidents.length), `MTTR ${duration(d3.mean(closed, (i) => i.duration_s))} · longest ${duration(d3.max(incidents, (i) => i.duration_s))}`,
      incidents.some((i) => i.open) ? "bad" : incidents.length ? "warn" : "good");
    const wired = selected.filter((r) => r.p === 1).length;
    const wifi = selected.filter((r) => r.p === 2).length;
    const rssi = d3.median(selected.filter((r) => r.r != null), (r) => r.r);
    card("Access path", wired + wifi ? `${Math.round((100 * wired) / (wired + wifi))}% wired` : "–",
      wifi ? `${wifi} Wi-Fi minutes · median RSSI ${rssi == null ? "–" : `${Math.round(rssi)} dBm`}` : "no Wi-Fi minutes");
  }

  function incidentsIn([start, end]) {
    return (index.incidents || []).filter((i) => {
      const s = i.start * 1000;
      const e = i.open ? Date.now() : i.end * 1000;
      return s < end && e >= start;
    });
  }

  function width(container) {
    return Math.max(320, container.clientWidth || 900);
  }

  function timeline() {
    const container = document.getElementById("timeline");
    const total = width(container);
    const margin = { top: 6, right: 12, bottom: 26, left: 170 };
    const lanes = [
      { name: "Fault domain", color: (b) => (worstDomain(b.rows) ? DOMAIN_COLOR[worstDomain(b.rows)] : STATUS_COLOR[0]) },
      { name: "Access path", color: (b) => PATH_COLOR[pathOf(b.rows)] },
      { name: "Access link", color: (b) => STATUS_COLOR[worst(b.rows.map((r) => r.a))] },
      ...targets.map((t) => ({ name: t.label, color: (b) => STATUS_COLOR[worst(b.rows.map((r) => r.s[t.id]))] })),
    ];
    const lane = 20;
    const gap = 6;
    const height = margin.top + lanes.length * (lane + gap) + margin.bottom;
    const plotWidth = total - margin.left - margin.right;
    const count = Math.max(1, Math.min(Math.floor(plotWidth / 3), Math.ceil((view[1] - view[0]) / 60000)));
    const data = buckets(view, count);
    const x = d3.scaleTime().domain(view).range([margin.left, total - margin.right]);
    const svg = d3.create("svg").attr("viewBox", [0, 0, total, height]).attr("width", total).attr("height", height);
    lanes.forEach((item, laneIndex) => {
      const y = margin.top + laneIndex * (lane + gap);
      svg.append("text").attr("class", "lane-label").attr("x", 0).attr("y", y + 14).text(item.name);
      svg.append("g").selectAll("rect").data(data).join("rect")
        .attr("x", (b) => x(b.t0)).attr("y", y).attr("height", lane)
        .attr("width", (b) => Math.max(1, x(b.t1) - x(b.t0) + 0.3))
        .attr("rx", 2).attr("fill", (b) => item.color(b));
    });
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom + 4})`)
      .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(plotWidth / 110))).tickSizeOuter(0));
    const marker = svg.append("line").attr("y1", margin.top).attr("y2", height - margin.bottom)
      .attr("stroke", "#fff").attr("stroke-opacity", 0.5).attr("visibility", "hidden");
    svg.append("rect").attr("x", margin.left).attr("y", 0).attr("width", plotWidth).attr("height", height - margin.bottom)
      .attr("fill", "transparent")
      .on("mousemove", (event) => {
        const [px] = d3.pointer(event);
        const bucket = data[Math.min(count - 1, Math.max(0, Math.floor(((px - margin.left) / plotWidth) * count)))];
        marker.attr("x1", px).attr("x2", px).attr("visibility", "visible");
        const rowsInBucket = bucket.rows;
        const details = [
          ["Fault domain", worstDomain(rowsInBucket) || "no data", DOMAIN_COLOR[worstDomain(rowsInBucket)]],
          ["Access path", PATH[pathOf(rowsInBucket)]],
        ];
        const rssi = mean(rowsInBucket.map((r) => r.r));
        if (rssi != null) details.push(["Wi-Fi RSSI", `${Math.round(rssi)} dBm`]);
        for (const target of targets) {
          const status = worst(rowsInBucket.map((r) => r.s[target.id]));
          const latency = mean(rowsInBucket.map((r) => r.l[target.id]));
          const flaps = d3.sum(rowsInBucket, (r) => r.c[target.id] || 0);
          details.push([target.label, `${STATUS[status]}${latency == null ? "" : ` · ${latency.toFixed(1)} ms`}${flaps ? ` · ${flaps} flap${flaps > 1 ? "s" : ""}` : ""}`, STATUS_COLOR[status]]);
        }
        showTooltip(event, `${fmtTime(new Date(bucket.t0))} – ${fmtShort(new Date(bucket.t1))}`, details);
      })
      .on("mouseleave", () => {
        marker.attr("visibility", "hidden");
        hideTooltip();
      });
    container.replaceChildren(svg.node());
  }

  function overview() {
    const container = document.getElementById("overview");
    const total = width(container);
    const margin = { left: 170, right: 12 };
    const height = 46;
    const plotWidth = total - margin.left - margin.right;
    const extent = [dataStart, dataEnd];
    const count = Math.max(1, Math.min(Math.floor(plotWidth / 2), Math.ceil((dataEnd - dataStart) / 60000)));
    const data = buckets(extent, count);
    const x = d3.scaleTime().domain(extent).range([margin.left, total - margin.right]);
    const svg = d3.create("svg").attr("viewBox", [0, 0, total, height]).attr("width", total).attr("height", height);
    svg.append("text").attr("class", "lane-label").attr("x", 0).attr("y", 16).text("Overview (drag to zoom)");
    svg.append("g").selectAll("rect").data(data).join("rect")
      .attr("x", (b) => x(b.t0)).attr("y", 4).attr("height", 18)
      .attr("width", (b) => Math.max(1, x(b.t1) - x(b.t0) + 0.3))
      .attr("fill", (b) => (worstDomain(b.rows) ? DOMAIN_COLOR[worstDomain(b.rows)] : STATUS_COLOR[0]));
    svg.append("g").attr("class", "axis").attr("transform", "translate(0,24)")
      .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(plotWidth / 140))).tickSizeOuter(0));
    const brush = d3.brushX().extent([[margin.left, 2], [total - margin.right, 24]])
      .on("end", (event) => {
        if (!event.sourceEvent) return;
        if (!event.selection) return;
        const [a, b] = event.selection.map((px) => x.invert(px).getTime());
        if (b - a < 5 * 60000) return;
        view = [a, b];
        document.querySelectorAll("#ranges button").forEach((button) => button.classList.remove("active"));
        renderDetail();
      });
    const group = svg.append("g").attr("class", "brush").call(brush);
    group.call(brush.move, [x(view[0]), x(view[1])]);
    container.replaceChildren(svg.node());
  }

  const hiddenTargets = new Set();
  function latency() {
    const container = document.getElementById("latency");
    const total = width(container);
    const margin = { top: 12, right: 16, bottom: 28, left: 54 };
    const height = 280;
    const plotWidth = total - margin.left - margin.right;
    const count = Math.max(1, Math.min(Math.floor(plotWidth / 4), Math.ceil((view[1] - view[0]) / 60000)));
    const data = buckets(view, count);
    const series = targets.map((target) => ({
      target,
      points: data.map((b) => ({ t: (b.t0 + b.t1) / 2, mean: mean(b.rows.map((r) => r.l[target.id])),
        max: d3.max(b.rows, (r) => r.x[target.id]) ?? null })),
    }));
    const visible = series.filter((s) => !hiddenTargets.has(s.target.id));
    const values = visible.flatMap((s) => s.points.flatMap((p) => [p.mean, p.max])).filter((v) => v != null && v > 0);
    if (!values.length) {
      empty(container, "No latency measurements in this range.");
      return;
    }
    const log = document.getElementById("log-scale").checked;
    const top = d3.max(values) * 1.1;
    const y = (log ? d3.scaleLog().domain([Math.max(0.5, d3.min(values) * 0.8), top]) : d3.scaleLinear().domain([0, top]))
      .range([height - margin.bottom, margin.top]).nice();
    const x = d3.scaleTime().domain(view).range([margin.left, total - margin.right]);
    const svg = d3.create("svg").attr("viewBox", [0, 0, total, height + 30]).attr("width", total).attr("height", height + 30);
    svg.append("g").attr("class", "grid-line").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-plotWidth).tickFormat(""))
      .call((g) => g.select(".domain").remove());
    svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5, "~s"));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(plotWidth / 110))).tickSizeOuter(0));
    svg.append("text").attr("class", "lane-label").attr("x", 4).attr("y", margin.top - 2).attr("font-size", 11).text("ms");
    const line = (key) => d3.line().defined((p) => p[key] != null && (!log || p[key] > 0)).x((p) => x(p.t)).y((p) => y(p[key])).curve(d3.curveMonotoneX);
    for (const item of visible) {
      const color = targetColor(item.target.id);
      svg.append("path").datum(item.points).attr("fill", "none").attr("stroke", color).attr("stroke-opacity", 0.45)
        .attr("stroke-dasharray", "2,3").attr("stroke-width", 1).attr("d", line("max"));
      svg.append("path").datum(item.points).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2).attr("d", line("mean"));
    }
    const legendGroup = svg.append("g").attr("transform", `translate(${margin.left},${height + 8})`);
    let offset = 0;
    for (const item of series) {
      const g = legendGroup.append("g").attr("transform", `translate(${offset},0)`).style("cursor", "pointer")
        .attr("opacity", hiddenTargets.has(item.target.id) ? 0.35 : 1)
        .on("click", () => {
          if (hiddenTargets.has(item.target.id)) hiddenTargets.delete(item.target.id); else hiddenTargets.add(item.target.id);
          latency();
        });
      g.append("rect").attr("width", 12).attr("height", 12).attr("rx", 3).attr("fill", targetColor(item.target.id));
      const label = `${item.target.label} (≤ ${item.target.threshold_ms} ms)`;
      g.append("text").attr("x", 18).attr("y", 10).attr("class", "lane-label").attr("font-size", 12).text(label);
      offset += 30 + label.length * 6.5;
    }
    const focus = svg.append("line").attr("y1", margin.top).attr("y2", height - margin.bottom).attr("stroke", "#fff")
      .attr("stroke-opacity", 0.4).attr("visibility", "hidden");
    svg.append("rect").attr("x", margin.left).attr("y", margin.top).attr("width", plotWidth)
      .attr("height", height - margin.top - margin.bottom).attr("fill", "transparent")
      .on("mousemove", (event) => {
        const [px] = d3.pointer(event);
        const indexAt = Math.min(count - 1, Math.max(0, Math.floor(((px - margin.left) / plotWidth) * count)));
        focus.attr("x1", px).attr("x2", px).attr("visibility", "visible");
        showTooltip(event, fmtTime(new Date(data[indexAt].t0)), visible.map((s) => {
          const p = s.points[indexAt];
          return [s.target.label, p.mean == null ? "–" : `${p.mean.toFixed(1)} ms (max ${p.max == null ? "–" : p.max.toFixed(1)})`,
            targetColor(s.target.id)];
        }));
      })
      .on("mouseleave", () => {
        focus.attr("visibility", "hidden");
        hideTooltip();
      });
    container.replaceChildren(svg.node());
  }

  function flaps() {
    const container = document.getElementById("flaps");
    const data = [];
    for (const row of rowsIn(view)) {
      for (const target of targets) {
        if (row.c[target.id]) data.push({ t: new Date(row.t), flaps: row.c[target.id], target: target.label });
      }
    }
    if (!data.length) {
      empty(container, "No flaps in this range.");
      return;
    }
    container.replaceChildren(Plot.plot({
      width: width(container), height: 240, marginLeft: 40,
      style: { background: "transparent", color: "#8f9bb8" },
      x: { type: "time", domain: view.map((v) => new Date(v)), label: null },
      y: { label: "flaps / hour", grid: true },
      color: { legend: true, domain: targets.map((t) => t.label), range: targets.map((t) => targetColor(t.id)) },
      marks: [Plot.rectY(data, Plot.binX({ y: "sum" }, { x: "t", y: "flaps", fill: "target", interval: d3.utcHour, tip: true }))],
    }));
  }

  function domains() {
    const container = document.getElementById("domains");
    const counts = d3.rollup(rowsIn(view).filter((r) => r.d && r.d !== "healthy"), (v) => v.length, (r) => r.d);
    const data = Array.from(counts, ([name, minutes]) => ({ name, minutes })).sort((a, b) => DOMAIN_SEVERITY[b.name] - DOMAIN_SEVERITY[a.name]);
    const size = 240;
    const total = width(container);
    const svg = d3.create("svg").attr("viewBox", [0, 0, total, size]).attr("width", total).attr("height", size);
    const radius = size / 2 - 10;
    const group = svg.append("g").attr("transform", `translate(${size / 2 + 10},${size / 2})`);
    const sum = d3.sum(data, (d) => d.minutes);
    if (!sum) {
      group.append("circle").attr("r", radius).attr("fill", "none").attr("stroke", DOMAIN_COLOR.healthy).attr("stroke-width", 18);
      group.append("text").attr("text-anchor", "middle").attr("class", "lane-label").attr("font-size", 15).attr("dy", 5).text("No problem minutes");
    } else {
      const arcs = d3.pie().value((d) => d.minutes).sort(null)(data);
      const arc = d3.arc().innerRadius(radius * 0.62).outerRadius(radius).cornerRadius(4).padAngle(0.015);
      group.selectAll("path").data(arcs).join("path").attr("d", arc).attr("fill", (d) => DOMAIN_COLOR[d.data.name])
        .on("mousemove", (event, d) => showTooltip(event, d.data.name, [["Minutes", String(d.data.minutes)],
          ["Share", `${((100 * d.data.minutes) / sum).toFixed(1)}%`]]))
        .on("mouseleave", hideTooltip);
      group.append("text").attr("text-anchor", "middle").attr("class", "lane-label").attr("font-size", 26).attr("dy", 4).text(sum);
      group.append("text").attr("text-anchor", "middle").attr("fill", "#8f9bb8").attr("font-size", 12).attr("dy", 24).text("problem minutes");
      const list = svg.append("g").attr("transform", `translate(${size + 30},24)`);
      data.forEach((d, i) => {
        const row = list.append("g").attr("transform", `translate(0,${i * 24})`);
        row.append("rect").attr("width", 12).attr("height", 12).attr("rx", 3).attr("fill", DOMAIN_COLOR[d.name]);
        row.append("text").attr("x", 20).attr("y", 11).attr("class", "lane-label").text(`${d.name} — ${d.minutes} min`);
      });
    }
    container.replaceChildren(svg.node());
  }

  function heatmap() {
    const container = document.getElementById("heatmap");
    const day = d3.timeFormat("%a %d %b");
    const cells = d3.rollups(rowsIn(view).filter((r) => r.d), (v) => ({
      problem: v.filter((r) => r.d !== "healthy").length, observed: v.length,
    }), (r) => day(new Date(r.t)), (r) => new Date(r.t).getHours())
      .flatMap(([date, hours]) => hours.map(([hour, value]) => ({ date, hour, ...value })));
    if (!cells.length) {
      empty(container, "No observed minutes in this range.");
      return;
    }
    const dates = [...new Set(cells.map((c) => c.date))];
    container.replaceChildren(Plot.plot({
      width: width(container), height: Math.max(140, 40 + 22 * dates.length), marginLeft: 110,
      style: { background: "transparent", color: "#8f9bb8" }, padding: 0.08,
      x: { label: "hour of day", domain: d3.range(24), tickFormat: (h) => String(h).padStart(2, "0") },
      y: { label: null, domain: dates },
      color: { type: "sqrt", scheme: "magma", domain: [0, Math.max(1, d3.max(cells, (c) => c.problem))], label: "problem minutes", legend: true },
      marks: [Plot.cell(cells, { x: "hour", y: "date", fill: "problem", inset: 0.5, rx: 3,
        title: (c) => `${c.date} ${String(c.hour).padStart(2, "0")}:00 — ${c.problem} problem / ${c.observed} observed minutes` })],
    }));
  }

  function access() {
    const container = document.getElementById("access");
    const selected = rowsIn(view);
    const strip = selected.map((r) => ({ t: new Date(r.t), t2: new Date(r.t + 60000), p: r.p }));
    const signal = selected.filter((r) => r.r != null).map((r) => ({ t: new Date(r.t), r: r.r }));
    if (!strip.length) {
      empty(container, "No access-path data in this range.");
      return;
    }
    container.replaceChildren(Plot.plot({
      width: width(container), height: 240, marginLeft: 48,
      style: { background: "transparent", color: "#8f9bb8" },
      x: { type: "time", domain: view.map((v) => new Date(v)), label: null },
      y: { label: "Wi-Fi RSSI (dBm)", domain: [-95, -30], grid: true },
      marks: [
        Plot.rect(strip, { x1: "t", x2: "t2", y1: -95, y2: -89, fill: (d) => PATH_COLOR[d.p], title: (d) => PATH[d.p] }),
        Plot.ruleY([-70], { stroke: "#ffcc4d", strokeDasharray: "4,4" }),
        Plot.text([{ y: -70 }], { y: "y", x: () => new Date(view[0]), text: () => "weak-signal threshold", textAnchor: "start", dy: -6, fill: "#ffcc4d" }),
        Plot.lineY(signal, { x: "t", y: "r", stroke: "#a855f7", strokeWidth: 2, curve: "monotone-x" }),
        Plot.dot(signal, { x: "t", y: "r", fill: "#a855f7", r: 1.5, tip: true }),
      ],
    }));
  }

  function incidents() {
    const list = incidentsIn(view).sort((a, b) => b.start - a.start);
    const table = document.getElementById("incidents");
    table.replaceChildren();
    const head = element("tr");
    for (const name of ["Start", "Duration", "Target", "Fault domain", "State"]) head.append(element("th", null, name));
    table.append(head);
    if (!list.length) {
      const row = element("tr");
      const cell = element("td", null, "No confirmed incidents in this range.");
      cell.colSpan = 5;
      row.append(cell);
      table.append(row);
    }
    for (const incident of list) {
      const row = element("tr");
      const tag = element("span", "tag", incident.domain);
      tag.style.background = DOMAIN_COLOR[incident.domain] || "#5c6782";
      const domainCell = element("td");
      domainCell.append(tag);
      row.append(element("td", null, fmtTime(new Date(incident.start * 1000))), element("td", null, duration(incident.duration_s)),
        element("td", null, incident.target === "access" ? "Access link" : labelOf[incident.target] || incident.target),
        domainCell, element("td", null, incident.open ? "open" : "recovered"));
      table.append(row);
    }
    const container = document.getElementById("incident-durations");
    if (!list.length) {
      empty(container, "No incidents to chart.");
      return;
    }
    // A Gantt view shows whether incidents on different targets overlap, the signature of a shared flap.
    const bars = list.map((incident) => ({
      start: new Date(incident.start * 1000),
      end: new Date(Math.max(incident.start * 1000 + 30000, incident.open ? Date.now() : incident.end * 1000)),
      target: incident.target === "access" ? "Access link" : labelOf[incident.target] || incident.target,
      domain: incident.domain, duration: duration(incident.duration_s), open: incident.open,
    }));
    const lanes = [...new Set(["Access link", ...targets.map((t) => t.label)].filter((name) => bars.some((b) => b.target === name)))];
    container.replaceChildren(Plot.plot({
      width: width(container), height: 70 + 30 * lanes.length, marginLeft: 120,
      style: { background: "transparent", color: "#8f9bb8" },
      x: { type: "time", domain: view.map((v) => new Date(v)), label: null },
      y: { domain: lanes, label: null },
      color: { legend: true, domain: Object.keys(DOMAIN_COLOR), range: Object.values(DOMAIN_COLOR) },
      marks: [
        Plot.ruleX([new Date(view[1])], { stroke: "#24304f" }),
        Plot.barX(bars, { x1: "start", x2: "end", y: "target", fill: "domain", rx: 3, insetTop: 4, insetBottom: 4,
          title: (b) => `${b.target}: ${b.domain}, ${b.duration}${b.open ? " (open)" : ""}` }),
      ],
    }));
  }

  function renderDetail() {
    kpis();
    timeline();
    latency();
    flaps();
    domains();
    heatmap();
    access();
    monitorHealth(view);
    incidents();
  }

  function monitorHealth(range) {
    const heartbeat = document.getElementById("heartbeat");
    const events = document.getElementById("diagnostic-events");
    if (index.diagnostics !== true || !range) {
      empty(heartbeat, index.diagnostics === true ? "No diagnostic records published." : "Diagnostic metrics not enabled in this feed.");
      events.replaceChildren();
      return;
    }
    const selected = diagnostics.filter((m) => m.t >= range[0] && m.t < range[1]);
    const time = d3.utcFormat("%Y-%m-%d %H:%M UTC");
    const style = { background: "transparent", color: "#8f9bb8" };
    const x = { type: "utc", domain: range.map((t) => new Date(t)), label: "UTC" };
    const cycles = selected.filter((m) => m.cycles > 0);
    if (!cycles.length) {
      empty(heartbeat, "No completed cycles recorded in this range.");
    } else {
      heartbeat.replaceChildren(Plot.plot({
        width: width(heartbeat), height: 155, style, x, marginLeft: 55,
        y: { label: "Cycles / min", grid: true, tickFormat: (n) => Number.isInteger(n) ? n : "" },
        marks: [Plot.rectY(cycles, {
          x1: (m) => Math.max(range[0], m.t), x2: (m) => Math.min(range[1], m.t + 60000),
          y: "cycles", fill: "#48a9ff",
          title: (m) => `${time(new Date(m.t))}\n${m.cycles} completed cycle(s) · slowest ${m.max_cycle_ms ?? 0} ms`,
        })],
      }));
    }

    const lanes = [
      ["Cycle resumed after gap", (m) => m.gap_minutes, " min since previous cycle start", "#ffcc4d"],
      ["Monitor started", (m) => m.starts, "", "#2fd08a"],
      ["Monitor stopped", (m) => m.stops, "", "#6a86ac"],
      ["Access path changed", (m) => m.path_changes, "", "#3d8bfd"],
      ["Wi-Fi roamed", (m) => m.roams, "", "#a855f7"],
      ["Route snapshot changed", (m) => m.route_changes, "", "#00cec9"],
      ["Diagnostic command failed", (m) => m.diagnostic_errors, "", "#ff9f43"],
      ["Probe error", (m) => m.probe_errors, "", "#ff5d6c"],
      ["Carrier changes", (m) => m.link?.carrier_changes, "", "#b39ddb"],
      ["Interface errors", (m) => m.link?.interface_errors, "", "#ff9f43"],
      ["CRC errors (subset)", (m) => m.link?.crc_errors, "", "#e5894a"],
      ["Interface discards", (m) => m.link?.discards, "", "#ffcc4d"],
    ];
    const marks = lanes.flatMap(([lane, count, unit, color]) => selected
      .filter((m) => count(m) > 0)
      .map((m) => ({ lane, color, t: m.t, title: `${time(new Date(m.t))}\n${lane}: ${count(m)}${unit}` })));
    if (!marks.length) {
      empty(events, "No diagnostic events recorded in this range. Unsupported interface counters are not shown.");
      return;
    }
    const shown = lanes.map(([lane]) => lane).filter((lane) => marks.some((m) => m.lane === lane));
    events.replaceChildren(Plot.plot({
      width: width(events), height: 55 + shown.length * 24, style, x, marginLeft: 175,
      y: { domain: shown, label: null, grid: true },
      marks: [Plot.dot(marks, { x: "t", y: "lane", fill: "color", title: "title", r: 4 })],
    }));
  }

  function render() {
    overview();
    renderDetail();
  }

  document.querySelectorAll("#ranges button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#ranges button").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      const hours = Number(button.dataset.hours);
      view = hours ? [Math.max(dataStart, dataEnd - hours * 3600000), dataEnd] : [dataStart, dataEnd];
      render();
    });
  });
  document.getElementById("log-scale").addEventListener("change", latency);
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  });
  render();
})();
