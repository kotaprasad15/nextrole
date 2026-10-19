// NextRole web UI: no framework, no build step. Talks to the same-origin FastAPI backend.
// Safety: user/LLM-derived text is only ever set via textContent/value (never innerHTML).
"use strict";

const app = document.getElementById("app");
const nav = document.getElementById("nav");

/** Tiny hyperscript helper: h("div", {class: "x", onclick: fn}, child, "text"). */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

async function api(method, path, body) {
  const opts = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers["content-type"] = "application/json";
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    return { ok: false, status: 0, error: "Cannot reach the server." };
  }
  let data = null;
  if ((res.headers.get("content-type") || "").includes("json")) data = await res.json();
  return { ok: res.ok, status: res.status, data, error: errorText(data, res.status) };
}

function errorText(data, status) {
  const d = data && data.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e.msg).join("; ");
  return `Request failed (${status})`;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2500);
}

function field(label, input, hint) {
  return h("div", {}, h("label", {}, label), input, hint ? h("p", { class: "hint" }, hint) : null);
}

function setBusy(btn, busy, text) {
  btn.disabled = busy;
  btn.replaceChildren(...(busy ? [h("span", { class: "spinner" }), text] : [text]));
}

const csv = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

// ---------- Views ----------

function renderNav(email, active) {
  nav.replaceChildren();
  if (!email) return;
  if (active) {
    for (const [route, label] of [["dashboard", "Dashboard"], ["profile", "Profile"]]) {
      nav.append(h("a", { href: `#/${route}`, class: route === active ? "navlink active" : "navlink" }, label));
    }
  }
  nav.append(email, h("button", { class: "link", onclick: logout }, "Log out"));
}

async function logout() {
  await api("POST", "/auth/logout");
  boot();
}

function authView() {
  renderNav(null);
  let mode = "login";
  const err = h("p", { class: "error" });
  const email = h("input", { type: "email", autocomplete: "email", required: true });
  const pw = h("input", { type: "password", autocomplete: "current-password", minlength: 8, required: true });
  const submit = h("button", { class: "primary", type: "submit" }, "Log in");
  const tabs = ["login", "signup"].map((m) =>
    h("button", { type: "button", class: m === mode ? "active" : "", onclick: () => switchMode(m) },
      m === "login" ? "Log in" : "Sign up"));

  function switchMode(m) {
    mode = m;
    tabs.forEach((b, i) => b.classList.toggle("active", ["login", "signup"][i] === m));
    submit.textContent = m === "login" ? "Log in" : "Create account";
    pw.autocomplete = m === "login" ? "current-password" : "new-password";
    err.textContent = "";
  }

  const form = h("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault();
    setBusy(submit, true, mode === "login" ? "Logging in" : "Creating account");
    const r = await api("POST", `/auth/${mode}`, { email: email.value, password: pw.value });
    setBusy(submit, false, mode === "login" ? "Log in" : "Create account");
    if (r.ok) boot(); else err.textContent = r.error;
  } },
    h("div", { class: "tabs" }, tabs),
    field("Email", email),
    field("Password", pw, "At least 8 characters."),
    err,
    h("div", { class: "actions" }, submit),
  );
  app.replaceChildren(
    h("h1", {}, "Find roles that fit you"),
    h("p", { class: "sub" }, "Upload your resume, see real openings, and draft personalized outreach."),
    form,
  );
}

const LEVELS = ["Intern / New grad", "Junior", "Mid", "Senior"];

function onboardingView(email) {
  renderNav(email);
  const err = h("p", { class: "error" });
  const roles = h("input", { type: "text", required: true, placeholder: "Backend Engineer, Data Engineer" });
  const locations = h("input", { type: "text", placeholder: "London, Bangalore" });
  const remote = h("input", { type: "checkbox", checked: true });
  const level = h("select", {}, LEVELS.map((l) => h("option", {}, l)));
  const extras = h("textarea", { placeholder: "e.g. prefer small teams, no on-call" });
  const file = h("input", { type: "file", accept: ".pdf,.docx", required: true });
  const submit = h("button", { class: "primary", type: "submit" }, "Parse my resume");

  const form = h("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("roles", roles.value);
    fd.set("locations", locations.value);
    fd.set("remote_ok", remote.checked);
    fd.set("experience_level", level.value);
    fd.set("extras", extras.value);
    fd.set("resume", file.files[0]);
    setBusy(submit, true, "Reading your resume (this can take ~20s)");
    const r = await api("POST", "/onboarding", fd);
    setBusy(submit, false, "Parse my resume");
    if (r.ok) boot(); else err.textContent = r.error;
  } },
    field("Desired roles", roles, "Comma separated."),
    field("Locations", locations, "Comma separated. Leave empty for anywhere."),
    h("label", { class: "inline" }, remote, "Open to remote"),
    field("Experience level", level),
    field("Other preferences (optional)", extras),
    field("Resume", file, "PDF or DOCX, up to 5 MB. Stored encrypted; you can delete it any time."),
    err,
    h("div", { class: "actions" }, submit),
  );
  app.replaceChildren(
    h("h1", {}, "Tell us what you're looking for"),
    h("p", { class: "sub" }, "We'll parse your resume into a profile you can review and edit."),
    form,
  );
}

/** A list editor: renders one nested card per item with add/remove. */
function listEditor(title, items, blank, renderItem, addLabel) {
  const wrap = h("div");
  function draw() {
    wrap.replaceChildren(
      h("h2", {}, title),
      ...items.map((it, i) => h("div", { class: "card nested" },
        h("button", { type: "button", class: "link small remove", "aria-label": `Remove ${title} ${i + 1}`,
          onclick: () => { items.splice(i, 1); draw(); } }, "Remove"),
        renderItem(it))),
      h("button", { type: "button", class: "small", onclick: () => { items.push(blank()); draw(); } }, addLabel),
    );
  }
  draw();
  return wrap;
}

/** Text input bound to obj[key]. */
function bound(obj, key, props = {}) {
  return h("input", { type: "text", value: obj[key] ?? "", ...props,
    oninput: (e) => { obj[key] = e.target.value; } });
}

function profileView(email, profile) {
  renderNav(email, "profile");
  const p = structuredClone(profile);
  const prefs = p.preferences;
  const err = h("p", { class: "error" });

  const basics = h("div", { class: "card" },
    field("Name", bound(p, "name")),
    field("Summary", h("textarea", { oninput: (e) => { p.summary = e.target.value; } }, p.summary)),
    field("Skills", bound({ get skills() { return p.skills.join(", "); }, set skills(v) { p.skills = csv(v); } }, "skills"),
      "Comma separated."),
  );

  const prefCard = h("div", { class: "card" },
    h("label", {}, "Desired roles"),
    h("input", { type: "text", value: prefs.roles.join(", "), oninput: (e) => { prefs.roles = csv(e.target.value); } }),
    h("label", {}, "Locations"),
    h("input", { type: "text", value: prefs.locations.join(", "), oninput: (e) => { prefs.locations = csv(e.target.value); } }),
    h("label", { class: "inline" },
      h("input", { type: "checkbox", checked: prefs.remote_ok, onchange: (e) => { prefs.remote_ok = e.target.checked; } }),
      "Open to remote"),
  );

  const exp = listEditor("Experience", p.experience,
    () => ({ company: "", title: "", start: "", end: "", bullets: [] }),
    (e) => h("div", {},
      h("div", { class: "row" }, field("Company", bound(e, "company")), field("Title", bound(e, "title"))),
      h("div", { class: "row" }, field("Start", bound(e, "start")), field("End", bound(e, "end"))),
      field("Highlights", h("textarea", { oninput: (ev) => { e.bullets = ev.target.value.split("\n").map((s) => s.trim()).filter(Boolean); } },
        e.bullets.join("\n")), "One per line.")),
    "Add experience");

  const proj = listEditor("Projects", p.projects,
    () => ({ name: "", description: "", tech: [] }),
    (e) => h("div", {},
      field("Name", bound(e, "name")),
      field("Description", h("textarea", { oninput: (ev) => { e.description = ev.target.value; } }, e.description)),
      field("Tech", h("input", { type: "text", value: e.tech.join(", "), oninput: (ev) => { e.tech = csv(ev.target.value); } }),
        "Comma separated.")),
    "Add project");

  const edu = listEditor("Education", p.education,
    () => ({ institution: "", degree: "", year: "" }),
    (e) => h("div", { class: "row" },
      field("Institution", bound(e, "institution")),
      h("div", { class: "row" }, field("Degree", bound(e, "degree")), field("Year", bound(e, "year")))),
    "Add education");

  const save = h("button", { class: "primary", onclick: async () => {
    setBusy(save, true, "Saving");
    const r = await api("PUT", "/profile", p);
    setBusy(save, false, "Save changes");
    if (r.ok) { err.textContent = ""; toast("Profile saved"); } else err.textContent = r.error;
  } }, "Save changes");

  const del = h("button", { class: "danger", onclick: async () => {
    if (!confirm("Permanently delete your account, profile and uploaded resume?")) return;
    const r = await api("DELETE", "/me");
    if (r.ok) boot(); else err.textContent = r.error;
  } }, "Delete my account and data");

  app.replaceChildren(
    h("h1", {}, "Review your profile"),
    h("p", { class: "sub" }, "Parsed from your resume. Fix anything wrong before we use it to find roles."),
    basics, h("h2", {}, "Preferences"), prefCard, exp, proj, edu, err,
    h("div", { class: "actions" }, save, del),
  );
}


// ---------- Dashboard ----------

const TIER_SECTIONS = [
  ["startup", "Startups"],
  ["mid", "Mid-size companies"],
  ["mnc", "MNCs"],
];
let autoRefreshTried = false;

function scoreBand(score) {
  return score >= 80 ? "high" : score >= 60 ? "mid" : "low";
}

function chips(items, cls) {
  return h("ul", { class: `chips ${cls}` }, items.map((t) => h("li", {}, t)));
}

function jobCard(c) {
  // The URL comes from the source API via the backend; still refuse anything but https.
  const safe = typeof c.apply_url === "string" && c.apply_url.startsWith("https://");
  return h("article", { class: "card job" },
    h("div", { class: "job-head" },
      h("div", {},
        h("h3", {}, c.title),
        h("p", { class: "meta" }, [c.company, c.location].filter(Boolean).join(" · "),
          c.remote ? h("span", { class: "tag" }, "Remote") : null)),
      h("div", { class: `score ${scoreBand(c.score)}`, title: "Match score" },
        h("strong", {}, String(c.score)), h("span", {}, "match"))),
    h("p", { class: "why" }, c.rationale),
    c.strengths.length ? chips(c.strengths, "good") : null,
    c.gaps.length ? chips(c.gaps, "gap") : null,
    h("div", { class: "actions" },
      safe
        ? h("a", { class: "btn primary", href: c.apply_url, target: "_blank", rel: "noopener noreferrer" }, "Apply")
        : h("button", { disabled: true }, "No apply link")),
  );
}

async function dashboardView(email) {
  renderNav(email, "dashboard");
  const status = h("p", { class: "sub" });
  const err = h("p", { class: "error" });
  const results = h("div");
  const refresh = h("button", { class: "primary" }, "Refresh matches");

  function draw(rec) {
    const total = TIER_SECTIONS.reduce((n, [k]) => n + rec[k].length, 0);
    results.replaceChildren(...(total === 0
      ? [h("div", { class: "card empty" }, "No matches yet. Click Refresh to search job boards and score them against your profile.")]
      : TIER_SECTIONS.map(([k, label]) => h("section", {},
          h("h2", {}, `${label} `, h("span", { class: "count" }, String(rec[k].length))),
          rec[k].length ? rec[k].map(jobCard) : h("p", { class: "hint" }, "Nothing in this group right now.")))));
    return total;
  }

  async function load() {
    const r = await api("GET", "/recommendations");
    if (!r.ok) { err.textContent = r.error; return 0; }
    return draw(r.data);
  }

  async function run() {
    err.textContent = "";
    setBusy(refresh, true, "Searching and scoring (~30s)");
    status.textContent = "Searching job boards, then scoring the best candidates against your profile...";
    const r = await api("POST", "/recommendations/refresh");
    setBusy(refresh, false, "Refresh matches");
    if (!r.ok) { err.textContent = r.error; status.textContent = ""; return; }
    const d = r.data, failed = Object.keys(d.source_errors).length;
    status.textContent = `Scored ${d.matched} of ${d.discovered} openings found` +
      (failed ? ` (${failed} job board${failed > 1 ? "s" : ""} unavailable)` : "") +
      ` · ${d.tokens.toLocaleString()} tokens · $${d.cost_usd.toFixed(4)}`;
    await load();
  }
  refresh.addEventListener("click", run);

  app.replaceChildren(
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Your matches"), status), refresh),
    err, results,
  );
  const total = await load();
  if (total === 0 && !autoRefreshTried) { autoRefreshTried = true; run(); }
}

async function boot() {
  const who = await api("GET", "/me");
  if (!who.ok) return authView();
  const email = who.data.email;
  const r = await api("GET", "/profile");
  if (r.status === 404) return onboardingView(email);
  if (r.ok) {
    return location.hash === "#/profile" ? profileView(email, r.data) : dashboardView(email);
  }
  app.replaceChildren(h("p", { class: "error" }, r.error));
}

window.addEventListener("hashchange", boot);
boot();
