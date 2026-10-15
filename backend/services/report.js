/* ============================================================
   Smart analysis report for the admin.
   Reads the whole database (resources, reports, requests) and
   produces a structured report: health score, narrative summary,
   purchase priorities, problem hotspots, repair-vs-replace advice,
   demand trends and recommended actions.

   It runs fully offline (no API key). To use a real AI model later,
   send the object returned by buildReport() to the model and ask it
   to rewrite `narrative` / `actions`.
   ============================================================ */
const { Resource, Report, Request } = require("../models");

const DAY = 24 * 60 * 60 * 1000;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function buildReport() {
  const now = Date.now();
  const since30 = now - 30 * DAY;
  const since90 = now - 90 * DAY;

  const [resources, reports, requests] = await Promise.all([
    Resource.find(),
    Report.find().populate("resource", "name location category"),
    Request.find().populate("user", "name"),
  ]);

  /* ---------- per-resource facts ---------- */
  const facts = new Map(
    resources.map((r) => [String(r._id), { r, reportsAll: 0, open: 0, highOpen: 0, demandQty: 0, pendingQty: 0 }])
  );
  for (const p of reports) {
    const e = p.resource && facts.get(String(p.resource._id));
    if (!e) continue;
    e.reportsAll++;
    if (p.status !== "resolved") {
      e.open++;
      if (p.priority === "high") e.highOpen++;
    }
  }
  const nameToId = new Map(resources.map((r) => [r.name.toLowerCase(), String(r._id)]));
  for (const q of requests) {
    if (q.status === "rejected" || q.createdAt.getTime() < since90) continue;
    const id = q.resource ? String(q.resource) : nameToId.get(String(q.itemName).toLowerCase());
    const e = id && facts.get(id);
    if (!e) continue;
    e.demandQty += q.quantity;
    if (q.status === "pending") e.pendingQty += q.quantity;
  }

  /* ---------- headline numbers ---------- */
  const totalUnits = resources.reduce((s, r) => s + r.totalQty, 0);
  const availUnits = resources.reduce((s, r) => s + r.availableQty, 0);
  const damagedTypes = resources.filter((r) => r.status === "damaged");
  const neededTypes = resources.filter((r) => r.status === "needed");
  const lowTypes = resources.filter((r) => r.totalQty > 0 && r.availableQty / r.totalQty <= 0.25);

  const openReports = reports.filter((p) => p.status !== "resolved");
  const highOpen = openReports.filter((p) => p.priority === "high");
  const staleOpen = openReports.filter((p) => p.createdAt.getTime() < now - 7 * DAY);
  const reports30 = reports.filter((p) => p.createdAt.getTime() >= since30);
  const resolved30 = reports.filter((p) => p.resolvedAt && p.resolvedAt.getTime() >= since30);
  const requests30 = requests.filter((q) => q.createdAt.getTime() >= since30);
  const pendingRequests = requests.filter((q) => q.status === "pending");

  const resolvedWithTime = reports.filter((p) => p.resolvedAt);
  const avgResolveHours = resolvedWithTime.length
    ? Math.round(resolvedWithTime.reduce((s, p) => s + (p.resolvedAt - p.createdAt), 0) / resolvedWithTime.length / 3600000)
    : null;

  /* ---------- health score ---------- */
  let healthScore = 100;
  healthScore -= Math.min(30, damagedTypes.length * 5);
  healthScore -= Math.min(20, neededTypes.length * 3);
  healthScore -= Math.min(15, lowTypes.length * 3);
  healthScore -= Math.min(25, highOpen.length * 10 + openReports.length * 2);
  healthScore = Math.max(0, Math.min(100, healthScore));
  const healthLabel = healthScore >= 80 ? "Good" : healthScore >= 60 ? "Fair" : "Needs attention";

  /* ---------- purchase / repair priorities ---------- */
  const purchase = [];
  for (const { r, reportsAll, open, highOpen: hOpen, demandQty, pendingQty } of facts.values()) {
    const ratio = r.totalQty ? r.availableQty / r.totalQty : 0;
    let score = 0;
    const why = [];

    if (r.totalQty > 0) {
      if (ratio <= 0.1) { score += 40; why.push(`only ${r.availableQty} of ${r.totalQty} units available (${pct(r.availableQty, r.totalQty)}%)`); }
      else if (ratio <= 0.25) { score += 30; why.push(`only ${r.availableQty} of ${r.totalQty} units available (${pct(r.availableQty, r.totalQty)}%)`); }
      else if (ratio <= 0.4) { score += 15; why.push(`stock is getting low (${pct(r.availableQty, r.totalQty)}% available)`); }
    }
    if (r.status === "needed") { score += 20; why.push("marked as needed"); }
    if (r.status === "damaged") { score += 25; why.push("marked as damaged"); }
    if (hOpen) { score += 20 * Math.min(hOpen, 2); why.push(`${plural(hOpen, "high-priority report")} still open`); }
    if (open - hOpen > 0) { score += 5 * Math.min(open - hOpen, 3); why.push(`${plural(open - hOpen, "other open report")}`); }
    if (demandQty > 0) { score += Math.min(15, demandQty * 2); why.push(`${plural(demandQty, "unit")} requested in the last 90 days${pendingQty ? ` (${pendingQty} still pending)` : ""}`); }

    if (score < 20) continue;
    const isRepair = r.status === "damaged";
    const target = Math.ceil(r.totalQty * 0.5);
    purchase.push({
      id: String(r._id),
      name: r.name,
      category: r.category,
      location: r.location,
      action: isRepair ? "Repair or replace" : "Procure more",
      suggestedQty: isRepair ? null : Math.max(1, target - r.availableQty),
      priority: score >= 60 ? "high" : score >= 35 ? "medium" : "low",
      score,
      why,
    });
  }
  purchase.sort((a, b) => b.score - a.score);
  const purchaseTop = purchase.slice(0, 10);

  /* ---------- problem hotspots (by location, last 90 days) ---------- */
  const locMap = new Map();
  for (const p of reports) {
    if (!p.resource || p.createdAt.getTime() < since90) continue;
    const key = p.resource.location;
    const e = locMap.get(key) || { location: key, reports: 0, open: 0, resources: new Set() };
    e.reports++;
    if (p.status !== "resolved") e.open++;
    e.resources.add(p.resource.name);
    locMap.set(key, e);
  }
  const hotspots = [...locMap.values()]
    .map((h) => ({ location: h.location, reports: h.reports, open: h.open, resources: [...h.resources].slice(0, 3) }))
    .sort((a, b) => b.reports - a.reports || b.open - a.open)
    .slice(0, 5);

  /* ---------- repair vs replace ---------- */
  const repairReplace = [];
  for (const { r, reportsAll, open } of facts.values()) {
    if (reportsAll < 2 && r.status !== "damaged") continue;
    if (reportsAll >= 3) {
      repairReplace.push({ name: r.name, location: r.location, decision: "Replace", reason: `${reportsAll} problem reports so far — repeated failures make repair costly in the long run.` });
    } else if (r.status === "damaged") {
      repairReplace.push({ name: r.name, location: r.location, decision: "Repair first", reason: `Marked damaged with ${plural(reportsAll, "report")}. Try repair; replace if it fails again.` });
    } else {
      repairReplace.push({ name: r.name, location: r.location, decision: "Inspect", reason: `Reported ${reportsAll} times${open ? `, ${open} still open` : ""}. A quick inspection can prevent a bigger fault.` });
    }
  }
  const order = { Replace: 0, "Repair first": 1, Inspect: 2 };
  repairReplace.sort((a, b) => order[a.decision] - order[b.decision]);

  /* ---------- demand trends (requests, last 90 days) ---------- */
  const demandMap = new Map();
  for (const q of requests) {
    if (q.createdAt.getTime() < since90) continue;
    const e = demandMap.get(q.itemName) || { item: q.itemName, requests: 0, qty: 0, pending: 0, teachers: new Set() };
    e.requests++;
    e.qty += q.quantity;
    if (q.status === "pending") e.pending++;
    if (q.user) e.teachers.add(String(q.user._id));
    demandMap.set(q.itemName, e);
  }
  const demand = [...demandMap.values()]
    .map((d) => ({ item: d.item, requests: d.requests, qty: d.qty, pending: d.pending, teachers: d.teachers.size }))
    .sort((a, b) => b.requests - a.requests || b.qty - a.qty)
    .slice(0, 5);

  /* ---------- category health ---------- */
  const catMap = new Map();
  for (const r of resources) {
    const c = catMap.get(r.category) || { category: r.category, types: 0, total: 0, available: 0, damaged: 0, needed: 0 };
    c.types++;
    c.total += r.totalQty;
    c.available += r.availableQty;
    if (r.status === "damaged") c.damaged++;
    if (r.status === "needed") c.needed++;
    catMap.set(r.category, c);
  }
  const categories = [...catMap.values()]
    .map((c) => ({ ...c, availability: pct(c.available, c.total) }))
    .sort((a, b) => a.availability - b.availability);

  /* ---------- recommended actions ---------- */
  const actions = [];
  if (highOpen.length) {
    const names = [...new Set(highOpen.map((p) => (p.resource ? p.resource.name : "a removed resource")))];
    actions.push(`Resolve the ${plural(highOpen.length, "high-priority problem")} first: ${names.join(", ")}.`);
  }
  for (const p of purchaseTop.filter((x) => x.priority === "high").slice(0, 3)) {
    actions.push(p.action === "Procure more"
      ? `Procure about ${p.suggestedQty} more unit(s) of ${p.name} (${p.why[0]}).`
      : `Arrange repair or replacement for ${p.name} at ${p.location} (${p.why[0]}).`);
  }
  if (staleOpen.length) actions.push(`${plural(staleOpen.length, "report")} ${staleOpen.length === 1 ? "has" : "have"} been open for more than 7 days — update or close ${staleOpen.length === 1 ? "it" : "them"}.`);
  if (pendingRequests.length) actions.push(`Review ${plural(pendingRequests.length, "pending request")} from teachers.`);
  if (hotspots[0] && hotspots[0].reports >= 2) actions.push(`Inspect ${hotspots[0].location}: it has the most problem reports (${hotspots[0].reports}) in the last 90 days.`);
  const toReplace = repairReplace.filter((x) => x.decision === "Replace");
  if (toReplace.length) actions.push(`Plan replacement for ${toReplace.map((x) => x.name).join(", ")} because of repeated failures.`);
  if (!actions.length) actions.push("No urgent actions right now. Keep monitoring stock levels and new reports.");

  /* ---------- narrative ---------- */
  const narrative = [];
  narrative.push(
    `The department currently holds ${totalUnits} units across ${plural(resources.length, "resource type")}, and ${availUnits} (${pct(availUnits, totalUnits)}%) are available right now. ` +
    `${plural(damagedTypes.length, "resource type")} ${damagedTypes.length === 1 ? "is" : "are"} marked as damaged and ${neededTypes.length} ${neededTypes.length === 1 ? "is" : "are"} marked as needed; ${plural(lowTypes.length, "type")} ${lowTypes.length === 1 ? "has" : "have"} 25% or less of the stock available.`
  );
  narrative.push(
    `In the last 30 days users filed ${plural(reports30.length, "problem report")} (${resolved30.length} resolved) and teachers submitted ${plural(requests30.length, "request")}. ` +
    `${openReports.length} report(s) are still open${highOpen.length ? `, ${highOpen.length} of them high priority` : ""}` +
    `${avgResolveHours !== null ? `. Problems are resolved in about ${avgResolveHours} hour(s) on average` : ""}.`
  );
  narrative.push(
    `Overall health score: ${healthScore}/100 (${healthLabel}).` +
    (purchaseTop.length ? ` The most urgent item is ${purchaseTop[0].name} — ${purchaseTop[0].why[0]}.` : " No resource is in urgent need right now.")
  );

  return {
    generatedAt: new Date().toISOString(),
    source: "Built-in analysis engine (rule-based, runs offline)",
    healthScore,
    healthLabel,
    narrative,
    kpis: {
      totalUnits, availableUnits: availUnits, availabilityPct: pct(availUnits, totalUnits),
      types: resources.length, damagedTypes: damagedTypes.length, neededTypes: neededTypes.length,
      openReports: openReports.length, highPriorityOpen: highOpen.length,
      pendingRequests: pendingRequests.length, avgResolveHours,
    },
    actions: actions.slice(0, 7),
    purchase: purchaseTop,
    hotspots,
    repairReplace: repairReplace.slice(0, 8),
    demand,
    categories,
  };
}

module.exports = { buildReport };
