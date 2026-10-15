/* ============================================================
   PUST-CSE Resource Management System — Frontend App
   Talks to the Express/MongoDB backend through js/api.js
   ============================================================ */

const me = Auth.user();
if (!Auth.token() || !me) {
  window.location.replace("index.html");
}

/* ---------- Constants ---------- */
const ROLE_ICON = { student: "🎓", teacher: "📚", staff: "🛠", admin: "⚙️" };
const STATUS_LABEL = { available: "Available", working: "Working", damaged: "Damaged", needed: "Needed" };
const STATUS_COLOR = { available: "var(--info)", working: "var(--ok)", damaged: "var(--danger)", needed: "var(--warn)" };
const ALL_ROLES = ["student", "teacher", "staff", "admin"];

const NAV = [
  { view: "resources", icon: "📋", label: "Resources", roles: ALL_ROLES },
  { view: "request", icon: "➕", label: "Request Resource", roles: ["teacher"] },
  { view: "report", icon: "⚠️", label: "Report Problem", roles: ALL_ROLES },
  { view: "admin", icon: "◈", label: "Admin Panel", roles: ["admin"], badge: true },
  { view: "ai", icon: "🤖", label: "AI Suggestions", roles: ["admin"] },
];

const state = {
  view: null,
  resources: [],
  categories: [],
  statuses: [],
  stats: null,
  category: "All",
  q: "",
  priority: "medium",
  adminTab: "requests",
};

/* ---------- Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function statusPill(status) {
  return `<span class="status-pill s-${status}"><span class="dot"></span>${STATUS_LABEL[status] || status}</span>`;
}
function tag(status) {
  return `<span class="status-tag ${status}">${esc(String(status).replace("_", " "))}</span>`;
}
function empty(icon, text) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div>${esc(text)}</div>`;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  $("#toastMsg").textContent = msg;
  $("#toastIcon").textContent = isError ? "✕" : "✓";
  t.classList.toggle("error", isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}

function showError(id, msg) {
  const box = $("#" + id);
  box.textContent = msg;
  box.classList.remove("hidden");
}
function hideError(id) {
  $("#" + id).classList.add("hidden");
}

/* ---------- Modal ---------- */
function openModal(title, bodyHtml, { confirmText = "Save", danger = false, onConfirm } = {}) {
  const root = $("#modalRoot");
  root.innerHTML = `
    <div class="modal-overlay" data-modal-overlay>
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        <div id="modalError" class="error-box hidden"></div>
        <div id="modalBody">${bodyHtml}</div>
        <div class="modal-actions">
          <button class="btn btn-secondary btn-sm" data-modal-cancel>Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"} btn-sm" id="modalConfirm">${esc(confirmText)}</button>
        </div>
      </div>
    </div>`;
  const close = () => (root.innerHTML = "");
  root.querySelector("[data-modal-cancel]").onclick = close;
  root.querySelector("[data-modal-overlay]").addEventListener("mousedown", (e) => {
    if (e.target.hasAttribute("data-modal-overlay")) close();
  });
  const confirmBtn = $("#modalConfirm");
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    try {
      await onConfirm();
      close();
    } catch (err) {
      const box = $("#modalError");
      box.textContent = err.message;
      box.classList.remove("hidden");
      confirmBtn.disabled = false;
    }
  };
  const first = root.querySelector("input, textarea, select");
  if (first) first.focus();
}

/* ---------- Boot ---------- */
function init() {
  $("#userAvatar").textContent = ROLE_ICON[me.role] || "🙂";
  $("#userName").textContent = me.name;
  $("#userRole").textContent = me.role;
  $("#userName").title = me.email;

  const nav = $("#navList");
  nav.innerHTML = NAV.filter((n) => n.roles.includes(me.role))
    .map(
      (n) => `<button class="nav-item" data-action="nav" data-view="${n.view}">
        <span class="nav-icon">${n.icon}</span> ${n.label}${n.badge ? '<span class="nav-badge hidden" id="adminBadge"></span>' : ""}
      </button>`
    )
    .join("");

  bindStaticEvents();

  const wanted = location.hash.replace("#", "");
  const allowed = NAV.filter((n) => n.roles.includes(me.role)).map((n) => n.view);
  showView(allowed.includes(wanted) ? wanted : "resources");
  if (me.role === "admin") refreshBadge();
}

async function refreshBadge() {
  try {
    const s = await api("/admin/summary");
    const total = s.pendingRequests + s.openReports;
    const b = $("#adminBadge");
    if (!b) return;
    b.textContent = total;
    b.classList.toggle("hidden", total === 0);
  } catch { /* ignore */ }
}

async function showView(view) {
  state.view = view;
  history.replaceState(null, "", "#" + view);
  document.querySelectorAll("main section").forEach((s) => s.classList.add("hidden"));
  $("#view-" + view).classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  window.scrollTo(0, 0);

  try {
    if (view === "resources") await loadResourcesView();
    if (view === "request") await loadRequestView();
    if (view === "report") await loadReportView();
    if (view === "admin") await loadAdminView();
    if (view === "ai") await loadAiView();
  } catch (err) {
    toast(err.message, true);
  }
}

/* ============================================================
   RESOURCES VIEW
   ============================================================ */
async function fetchResources() {
  const [r, s] = await Promise.all([api("/resources"), api("/resources/stats")]);
  state.resources = r.resources;
  state.categories = r.categories;
  state.statuses = r.statuses;
  state.stats = s;
}

async function loadResourcesView() {
  await fetchResources();
  renderStats();
  renderChips();
  renderResourceTable();
}

function renderStats() {
  const s = state.stats;
  $("#statTotal").textContent = s.total;
  $("#statAvailable").textContent = s.available;
  $("#statInUse").textContent = s.inUseOrDamaged;
  $("#statTypes").textContent = s.types;
}

function renderChips() {
  const cats = ["All", ...state.categories];
  $("#catChips").innerHTML = cats
    .map((c) => `<div class="chip ${c === state.category ? "active" : ""}" data-action="cat" data-cat="${esc(c)}">${esc(c)}</div>`)
    .join("");
}

function availCell(r) {
  const pct = r.totalQty ? Math.round((r.availableQty / r.totalQty) * 100) : 0;
  const color = STATUS_COLOR[r.status];
  return `<div class="avail-cell"><span class="avail-num" style="color:${color}">${r.availableQty}</span>
    <span class="avail-bar"><span class="avail-bar-fill" style="width:${pct}%;background:${color}"></span></span></div>`;
}

function renderResourceTable() {
  const q = state.q.toLowerCase();
  const rows = state.resources.filter(
    (r) =>
      (state.category === "All" || r.category === state.category) &&
      (!q || r.name.toLowerCase().includes(q) || r.location.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
  );
  $("#resourceTableBody").innerHTML = rows.length
    ? rows
        .map(
          (r) => `<tr>
        <td><div class="res-name">${esc(r.name)}</div><div class="res-id">${esc(r.id.slice(-6))}</div></td>
        <td><span class="badge">${esc(r.category)}</span></td>
        <td>${r.totalQty}</td>
        <td>${availCell(r)}</td>
        <td>${esc(r.location)}</td>
        <td>${statusPill(r.status)}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="6">${empty("🔍", "No resources match your search.")}</td></tr>`;
}

/* ============================================================
   REQUEST VIEW (teacher)
   ============================================================ */
async function loadRequestView() {
  if (!state.resources.length) await fetchResources();
  const opts = state.resources.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
  $("#reqResource").innerHTML = opts + `<option value="">Other item (type the name)…</option>`;
  toggleCustomItem();
  const { requests } = await api("/requests/mine");
  $("#myRequestsList").innerHTML = requests.length
    ? requests
        .map(
          (r) => `<div class="info-card">
        <div class="info-icon">📦</div>
        <div style="flex:1">
          <div class="info-title">${esc(r.itemName)} ${tag(r.status)}</div>
          <div class="info-body">${esc(r.reason)}</div>
          <div class="meta-row"><span>Qty: ${r.quantity}</span>${r.neededBy ? `<span>Needed by ${fmtDate(r.neededBy)}</span>` : ""}<span>Submitted ${fmtDate(r.createdAt)}</span></div>
          ${r.adminNote ? `<div class="admin-note"><strong>Admin:</strong> ${esc(r.adminNote)}</div>` : ""}
        </div>
      </div>`
        )
        .join("")
    : empty("📭", "No requests submitted yet.");
}

function toggleCustomItem() {
  $("#reqCustomRow").classList.toggle("hidden", $("#reqResource").value !== "");
}

async function submitRequest(e) {
  e.preventDefault();
  hideError("reqError");
  const btn = $("#reqSubmit");
  const resourceId = $("#reqResource").value;
  btn.disabled = true;
  try {
    await api("/requests", {
      method: "POST",
      body: {
        resourceId: resourceId || undefined,
        itemName: resourceId ? undefined : $("#reqItemName").value,
        quantity: $("#reqQuantity").value,
        neededBy: $("#reqDate").value || undefined,
        reason: $("#reqReason").value,
      },
    });
    $("#requestForm").reset();
    $("#reqQuantity").value = 1;
    toggleCustomItem();
    toast("Request submitted");
    await loadRequestView();
  } catch (err) {
    showError("reqError", err.message);
  } finally {
    btn.disabled = false;
  }
}

/* ============================================================
   REPORT VIEW (everyone)
   ============================================================ */
async function loadReportView() {
  if (!state.resources.length) await fetchResources();
  $("#repResource").innerHTML = state.resources.map((r) => `<option value="${esc(r.id)}">${esc(r.name)} — ${esc(r.location)}</option>`).join("");
  const { reports } = await api("/reports/mine");
  $("#myReportsList").innerHTML = reports.length
    ? reports
        .map(
          (r) => `<div class="info-card">
        <div class="info-icon">⚠️</div>
        <div style="flex:1">
          <div class="info-title">${esc(r.resource ? r.resource.name : "Removed resource")} ${tag(r.status)}</div>
          <div class="info-body">${esc(r.description)}</div>
          <div class="meta-row"><span>Priority: ${esc(r.priority)}</span><span>Reported ${fmtDate(r.createdAt)}</span></div>
          ${r.adminNote ? `<div class="admin-note"><strong>Admin:</strong> ${esc(r.adminNote)}</div>` : ""}
        </div>
      </div>`
        )
        .join("")
    : empty("📭", "You haven't reported any problems yet.");
}

async function submitReport(e) {
  e.preventDefault();
  hideError("repError");
  const btn = $("#repSubmit");
  btn.disabled = true;
  try {
    await api("/reports", {
      method: "POST",
      body: { resourceId: $("#repResource").value, priority: state.priority, description: $("#repDescription").value },
    });
    $("#repDescription").value = "";
    toast("Problem reported");
    await loadReportView();
  } catch (err) {
    showError("repError", err.message);
  } finally {
    btn.disabled = false;
  }
}

/* ============================================================
   ADMIN PANEL
   ============================================================ */
async function loadAdminView() {
  document.querySelectorAll("#adminTabs .tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.adminTab));
  $("#adminContent").innerHTML = `<div class="loading">Loading…</div>`;
  const tab = state.adminTab;
  if (tab === "requests") await renderAdminRequests();
  if (tab === "reports") await renderAdminReports();
  if (tab === "resources") await renderAdminResources();
  if (tab === "users") await renderAdminUsers();
  if (tab === "records") await renderAdminRecords();
  refreshBadge();
}

async function renderAdminRequests() {
  const { requests } = await api("/requests");
  state.adminRequests = requests;
  $("#adminContent").innerHTML = requests.length
    ? requests
        .map(
          (r) => `<div class="info-card">
        <div class="info-icon">📦</div>
        <div style="flex:1">
          <div class="info-title">${esc(r.itemName)} ${tag(r.status)}</div>
          <div class="info-body">${esc(r.reason)}</div>
          <div class="meta-row">
            <span>By ${esc(r.user ? r.user.name : "Unknown")}</span><span>Qty: ${r.quantity}</span>
            ${r.neededBy ? `<span>Needed by ${fmtDate(r.neededBy)}</span>` : ""}<span>${fmtDate(r.createdAt)}</span>
          </div>
          ${r.adminNote ? `<div class="admin-note"><strong>Note:</strong> ${esc(r.adminNote)}${r.reviewedBy ? ` — ${esc(r.reviewedBy.name)}` : ""}</div>` : ""}
          ${
            r.status === "pending"
              ? `<div class="card-actions">
                  <button class="btn btn-success btn-sm" data-action="review-request" data-id="${esc(r.id)}" data-status="approved">Approve</button>
                  <button class="btn btn-danger btn-sm" data-action="review-request" data-id="${esc(r.id)}" data-status="rejected">Reject</button>
                </div>`
              : ""
          }
        </div>
      </div>`
        )
        .join("")
    : empty("📭", "No requests yet.");
}

function reviewRequest(id, status) {
  const r = state.adminRequests.find((x) => x.id === id);
  openModal(
    `${status === "approved" ? "Approve" : "Reject"} request`,
    `<p style="margin:0 0 14px;color:var(--text-dim);font-size:14px">${esc(r.quantity)} × <strong style="color:var(--text)">${esc(r.itemName)}</strong> for ${esc(r.user ? r.user.name : "")}</p>
     <div class="form-row"><label>Note to the teacher (optional)</label><textarea class="text-input" id="mNote" placeholder="e.g. Will be delivered by Sunday"></textarea></div>`,
    {
      confirmText: status === "approved" ? "Approve" : "Reject",
      danger: status === "rejected",
      onConfirm: async () => {
        await api("/requests/" + id, { method: "PATCH", body: { status, adminNote: $("#mNote").value } });
        toast("Request " + status);
        loadAdminView();
      },
    }
  );
}

async function renderAdminReports() {
  const { reports } = await api("/reports");
  state.adminReports = reports;
  $("#adminContent").innerHTML = reports.length
    ? reports
        .map((r) => {
          const tone = r.status === "resolved" ? "" : r.priority === "high" ? "tone-danger" : r.priority === "medium" ? "tone-warn" : "";
          return `<div class="info-card ${tone}">
        <div class="info-icon">${r.priority === "high" && r.status !== "resolved" ? "🔴" : "⚠️"}</div>
        <div style="flex:1">
          <div class="info-title">${esc(r.resource ? r.resource.name : "Removed resource")} ${tag(r.status)}</div>
          <div class="info-body">${esc(r.description)}</div>
          <div class="meta-row">
            <span>By ${esc(r.user ? r.user.name : "Unknown")} (${esc(r.user ? r.user.role : "")})</span>
            <span>Priority: ${esc(r.priority)}</span>${r.resource ? `<span>${esc(r.resource.location)}</span>` : ""}<span>${fmtDate(r.createdAt)}</span>
          </div>
          ${r.adminNote ? `<div class="admin-note"><strong>Note:</strong> ${esc(r.adminNote)}</div>` : ""}
          <div class="card-actions">
            ${r.status === "open" ? `<button class="btn btn-secondary btn-sm" data-action="set-report" data-id="${esc(r.id)}" data-status="in_progress">Start work</button>` : ""}
            ${r.status !== "resolved" ? `<button class="btn btn-success btn-sm" data-action="set-report" data-id="${esc(r.id)}" data-status="resolved">Mark resolved</button>` : `<button class="btn btn-secondary btn-sm" data-action="set-report" data-id="${esc(r.id)}" data-status="open">Reopen</button>`}
          </div>
        </div>
      </div>`;
        })
        .join("")
    : empty("📭", "No problems reported.");
}

function setReport(id, status) {
  const r = state.adminReports.find((x) => x.id === id);
  const labels = { in_progress: "Start work on report", resolved: "Resolve report", open: "Reopen report" };
  openModal(
    labels[status],
    `<p style="margin:0 0 14px;color:var(--text-dim);font-size:14px"><strong style="color:var(--text)">${esc(r.resource ? r.resource.name : "")}</strong> — ${esc(r.description)}</p>
     <div class="form-row"><label>Note (optional)</label><textarea class="text-input" id="mNote">${esc(r.adminNote || "")}</textarea></div>`,
    {
      confirmText: "Confirm",
      onConfirm: async () => {
        await api("/reports/" + id, { method: "PATCH", body: { status, adminNote: $("#mNote").value } });
        toast("Report updated");
        loadAdminView();
      },
    }
  );
}

async function renderAdminResources() {
  await fetchResources();
  $("#adminContent").innerHTML = `
    <div class="inline-row">
      <div style="color:var(--text-dim);font-size:14px">${state.resources.length} resource types in inventory</div>
      <button class="btn btn-primary btn-sm btn-auto" data-action="add-resource">+ Add Resource</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Resource</th><th>Category</th><th>Total</th><th>Available</th><th>Location</th><th>Status</th><th></th></tr></thead>
      <tbody>${state.resources
        .map(
          (r) => `<tr>
        <td><div class="res-name">${esc(r.name)}</div></td>
        <td><span class="badge">${esc(r.category)}</span></td>
        <td>${r.totalQty}</td><td>${availCell(r)}</td><td>${esc(r.location)}</td><td>${statusPill(r.status)}</td>
        <td><div class="row-actions">
          <button class="icon-btn" title="Edit" data-action="edit-resource" data-id="${esc(r.id)}">✎</button>
          <button class="icon-btn" title="Delete" data-action="delete-resource" data-id="${esc(r.id)}">🗑</button>
        </div></td>
      </tr>`
        )
        .join("")}</tbody></table></div>`;
}

function resourceForm(r = {}) {
  const cats = state.categories.map((c) => `<option ${c === r.category ? "selected" : ""}>${esc(c)}</option>`).join("");
  const sts = state.statuses.map((s) => `<option value="${s}" ${s === (r.status || "working") ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("");
  return `
    <div class="form-row"><label>Resource name</label><input class="text-input" id="fName" value="${esc(r.name || "")}" placeholder="e.g. Digital Multimeter" /></div>
    <div class="form-grid-2">
      <div class="form-row"><label>Category</label><select class="text-input" id="fCategory">${cats}</select></div>
      <div class="form-row"><label>Status</label><select class="text-input" id="fStatus">${sts}</select></div>
    </div>
    <div class="form-grid-2">
      <div class="form-row"><label>Total units</label><input class="text-input" type="number" min="0" id="fTotal" value="${r.totalQty ?? 1}" /></div>
      <div class="form-row"><label>Available units</label><input class="text-input" type="number" min="0" id="fAvail" value="${r.availableQty ?? 1}" /></div>
    </div>
    <div class="form-row"><label>Location</label><input class="text-input" id="fLocation" value="${esc(r.location || "")}" placeholder="e.g. Programming Lab 1" /></div>`;
}

function readResourceForm() {
  return {
    name: $("#fName").value,
    category: $("#fCategory").value,
    status: $("#fStatus").value,
    totalQty: $("#fTotal").value,
    availableQty: $("#fAvail").value,
    location: $("#fLocation").value,
  };
}

function addResource() {
  openModal("Add resource", resourceForm(), {
    confirmText: "Add",
    onConfirm: async () => {
      await api("/resources", { method: "POST", body: readResourceForm() });
      toast("Resource added");
      loadAdminView();
    },
  });
}

function editResource(id) {
  const r = state.resources.find((x) => x.id === id);
  openModal("Edit resource", resourceForm(r), {
    onConfirm: async () => {
      await api("/resources/" + id, { method: "PUT", body: readResourceForm() });
      toast("Resource updated");
      loadAdminView();
    },
  });
}

function deleteResource(id) {
  const r = state.resources.find((x) => x.id === id);
  openModal("Delete resource", `<p style="margin:0;color:var(--text-dim);font-size:14px">Remove <strong style="color:var(--text)">${esc(r.name)}</strong> from the inventory? Problem reports about it will also be deleted.</p>`, {
    confirmText: "Delete",
    danger: true,
    onConfirm: async () => {
      await api("/resources/" + id, { method: "DELETE" });
      toast("Resource deleted");
      loadAdminView();
    },
  });
}

async function renderAdminUsers() {
  const { users } = await api("/admin/users");
  $("#adminContent").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
    <tbody>${users
      .map((u) => `<tr><td><div class="res-name">${esc(u.name)}</div></td><td>${esc(u.email)}</td><td><span class="badge role-tag">${esc(u.role)}</span></td><td class="mono-time">${fmtDate(u.createdAt)}</td></tr>`)
      .join("")}</tbody></table></div>`;
}

async function renderAdminRecords() {
  const { activity } = await api("/admin/activity?limit=150");
  $("#adminContent").innerHTML = activity.length
    ? `<div class="table-wrap"><table>
    <thead><tr><th>When</th><th>User</th><th>Action</th><th>Details</th></tr></thead>
    <tbody>${activity
      .map(
        (a) => `<tr><td class="mono-time">${fmtDateTime(a.createdAt)}</td>
      <td>${esc(a.user ? a.user.name : "—")}</td>
      <td><span class="badge">${esc(a.action.replaceAll("_", " "))}</span></td>
      <td style="color:var(--text-dim)">${esc(a.details || "")}</td></tr>`
      )
      .join("")}</tbody></table></div>`
    : empty("🗂", "No records yet.");
}

/* ============================================================
   AI SUGGESTIONS
   ============================================================ */
async function loadAiView() {
  $("#aiList").innerHTML = `<div class="loading">Analyzing…</div>`;
  const { suggestions } = await api("/admin/suggestions");
  const icon = { warn: "⚠️", danger: "🔴", neutral: "📦", ok: "✅" };
  $("#aiList").innerHTML = suggestions
    .map(
      (s) => `<div class="info-card tone-${esc(s.tone)}">
      <div class="info-icon">${icon[s.tone] || "💡"}</div>
      <div><div class="info-title">${esc(s.title)}</div><div class="info-body">${esc(s.body)}</div></div>
    </div>`
    )
    .join("");
}


/* ---------- Full analysis report ---------- */
async function generateReport() {
  const btn = $("#genReportBtn");
  btn.disabled = true;
  btn.textContent = "Analyzing…";
  try {
    const rep = await api("/admin/report");
    renderReport(rep);
    $("#printReportBtn").classList.remove("hidden");
    btn.textContent = "Regenerate Report";
    $("#aiReport").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    toast(err.message, true);
    btn.textContent = "Generate Report";
  } finally {
    btn.disabled = false;
  }
}

function reportTable(headers, rows, emptyText) {
  if (!rows.length) return `<div class="report-empty">${esc(emptyText)}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function renderReport(rep) {
  const k = rep.kpis;
  const hc = rep.healthScore >= 80 ? "var(--ok)" : rep.healthScore >= 60 ? "var(--warn)" : "var(--danger)";
  const prio = (p) => `<span class="status-tag ${esc(p)}">${esc(p)}</span>`;

  const kpi = (value, label, color) =>
    `<div class="stat-card"><div class="stat-value" style="color:${color}">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div>`;

  const purchaseRows = rep.purchase.map(
    (p) => `<tr>
      <td><div class="res-name">${esc(p.name)}</div><div class="res-id">${esc(p.location)}</div></td>
      <td>${esc(p.action)}</td>
      <td>${p.suggestedQty === null ? "—" : "+" + p.suggestedQty}</td>
      <td>${prio(p.priority)}</td>
      <td style="color:var(--text-dim);font-size:13px">${esc(p.why.join("; "))}</td></tr>`
  );
  const hotRows = rep.hotspots.map(
    (h) => `<tr><td><div class="res-name">${esc(h.location)}</div><div class="res-id">${esc(h.resources.join(", "))}</div></td><td>${h.reports}</td><td>${h.open}</td></tr>`
  );
  const rrRows = rep.repairReplace.map(
    (r) => `<tr><td><div class="res-name">${esc(r.name)}</div><div class="res-id">${esc(r.location)}</div></td><td><span class="badge">${esc(r.decision)}</span></td><td style="color:var(--text-dim);font-size:13px">${esc(r.reason)}</td></tr>`
  );
  const demandRows = rep.demand.map(
    (d) => `<tr><td><div class="res-name">${esc(d.item)}</div></td><td>${d.requests}</td><td>${d.qty}</td><td>${d.teachers}</td><td>${d.pending}</td></tr>`
  );
  const catRows = rep.categories
    .map((c) => {
      const color = c.availability >= 70 ? "var(--ok)" : c.availability >= 45 ? "var(--warn)" : "var(--danger)";
      return `<div class="cat-row">
        <div class="cat-name">${esc(c.category)}</div>
        <div class="cat-bar"><div class="cat-bar-fill" style="width:${c.availability}%;background:${color}"></div></div>
        <div class="cat-pct">${c.availability}%</div>
        <div class="cat-meta">${c.available}/${c.total} units${c.damaged ? ` · ${c.damaged} damaged` : ""}${c.needed ? ` · ${c.needed} needed` : ""}</div>
      </div>`;
    })
    .join("");

  $("#aiReport").innerHTML = `
  <div class="report">
    <div class="report-head">
      <div>
        <div class="eyebrow">PUST CSE · RESOURCE SYSTEM</div>
        <div class="report-title">Resource Analysis Report</div>
        <div class="report-date">Generated ${esc(fmtDateTime(rep.generatedAt))}</div>
      </div>
      <div class="health">
        <div class="health-score" style="color:${hc}">${rep.healthScore}<span>/100</span></div>
        <div class="health-label" style="color:${hc}">${esc(rep.healthLabel)}</div>
      </div>
    </div>

    <div class="report-section">
      <h3>Summary</h3>
      ${rep.narrative.map((p) => `<p class="report-p">${esc(p)}</p>`).join("")}
    </div>

    <div class="stat-grid report-kpis">
      ${kpi(k.availabilityPct + "%", "Units available", "var(--ok)")}
      ${kpi(k.damagedTypes, "Damaged types", k.damagedTypes ? "var(--danger)" : "var(--ok)")}
      ${kpi(k.neededTypes, "Types needed", k.neededTypes ? "var(--warn)" : "var(--ok)")}
      ${kpi(k.openReports, "Open reports", k.openReports ? "var(--warn)" : "var(--ok)")}
      ${kpi(k.pendingRequests, "Pending requests", "var(--accent-a)")}
      ${kpi(k.avgResolveHours === null ? "—" : k.avgResolveHours + " h", "Avg. time to resolve", "var(--info)")}
    </div>

    <div class="report-section">
      <h3>Recommended actions</h3>
      <ol class="action-list">${rep.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>
    </div>

    <div class="report-section">
      <h3>Purchase &amp; repair priorities</h3>
      ${reportTable(["Resource", "Action", "Suggested qty", "Priority", "Why"], purchaseRows, "No resource needs urgent purchase or repair.")}
    </div>

    <div class="report-section">
      <h3>Problem hotspots <small>(last 90 days)</small></h3>
      ${reportTable(["Location", "Reports", "Still open"], hotRows, "No problem reports in the last 90 days.")}
    </div>

    <div class="report-section">
      <h3>Repair or replace?</h3>
      ${reportTable(["Resource", "Advice", "Reason"], rrRows, "No resource has repeated problems.")}
    </div>

    <div class="report-section">
      <h3>Demand trends <small>(teacher requests, last 90 days)</small></h3>
      ${reportTable(["Item", "Requests", "Units asked", "Teachers", "Pending"], demandRows, "No requests in the last 90 days.")}
    </div>

    <div class="report-section">
      <h3>Availability by category</h3>
      <div class="cat-list">${catRows}</div>
    </div>

    <div class="report-foot">${esc(rep.source)}. Suggestions are advice for the admin, not automatic decisions.</div>
  </div>`;
}

/* ============================================================
   EVENTS
   ============================================================ */
function bindStaticEvents() {
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const d = el.dataset;
    switch (d.action) {
      case "nav": return showView(d.view);
      case "signout": Auth.clear(); return (window.location.href = "index.html");
      case "cat": state.category = d.cat; renderChips(); return renderResourceTable();
      case "review-request": return reviewRequest(d.id, d.status);
      case "set-report": return setReport(d.id, d.status);
      case "add-resource": return addResource();
      case "edit-resource": return editResource(d.id);
      case "delete-resource": return deleteResource(d.id);
      case "gen-report": return generateReport();
      case "print-report": return window.print();
    }
  });

  $("#searchInput").addEventListener("input", (e) => {
    state.q = e.target.value.trim();
    renderResourceTable();
  });

  $("#adminTabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab-btn");
    if (!b) return;
    state.adminTab = b.dataset.tab;
    loadAdminView().catch((err) => toast(err.message, true));
  });

  $("#reqResource").addEventListener("change", toggleCustomItem);
  $("#requestForm").addEventListener("submit", submitRequest);
  $("#reportForm").addEventListener("submit", submitReport);

  $("#priorityRow").addEventListener("click", (e) => {
    const o = e.target.closest(".seg-opt");
    if (!o) return;
    document.querySelectorAll("#priorityRow .seg-opt").forEach((x) => x.classList.remove("selected"));
    o.classList.add("selected");
    state.priority = o.dataset.p;
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("#modalRoot").innerHTML = "";
  });
}

init();
