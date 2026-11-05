// School App — screens and logic.
(function () {
"use strict";
const ATT_MIN = 75;   // attendance % below this is flagged
const PASS_MIN = 50;  // average % below this is flagged
const app = document.getElementById("app");
const toastEl = document.getElementById("toast");
const LS = API.LS;

const S = {
  classes: null,          // teacher's classes
  bundles: {},            // class id -> { info, students, att, assess, scores, at }
  report: null, reportAt: null, code: LS.get("sr_code"),
  date: today(), selAssess: {}, confirm: null, error: "", pending: 0, editStudent: null,
  member: undefined,      // my institute membership (null = not in one)
  inst: null, instAt: null, instDate: today(), instDay: {}, instFilter: "all", instDept: "", newInvite: null, instStudents: {}
};
const KINDS = ["Test", "Quiz", "Assignment", "Exam"];
const COUNTRY_CODE = "92"; // used when a parent's number starts with 0 (e.g. 0300 1234567 -> 92300 1234567)
S.month = today().slice(0, 7);
const ROLE_NAME = { principal: "Principal", head: "Department head", teacher: "Teacher" };

/* ---------------- helpers ---------------- */
function today(d = new Date()) { const z = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
function shift(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return today(d); }
function fmt(iso, o = { weekday: "short", day: "numeric", month: "short" }) { return new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, o); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
function pct(n) { return n == null || isNaN(n) ? "–" : Math.round(n) + "%"; }
let tt; function toast(m) { toastEl.textContent = m; toastEl.hidden = false; clearTimeout(tt); tt = setTimeout(() => toastEl.hidden = true, 2800); }
function go(h) { if (location.hash === "#" + h) route(); else location.hash = h; }
function back(to) { location.replace("#" + to); }          // in-app ‹ always goes to the parent screen
function swap(h) { location.replace("#" + h); }            // go somewhere without leaving a form in history
function sortSt(list) { return [...list].sort((a, b) => (Number(a.roll) || 9999) - (Number(b.roll) || 9999) || a.name.localeCompare(b.name)); }
function errMsg(e) {
  const m = (e && e.message) || "Something went wrong.";
  if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
  if (/already registered|already been registered/i.test(m)) return "This email already has an account. Log in instead.";
  if (/email not confirmed/i.test(m)) return "Please confirm your email first. Check your inbox.";
  if (/password should be at least/i.test(m)) return "Password must be at least 6 characters.";
  if (/token has expired|invalid/i.test(m) && /otp|token/i.test(m)) return "That code is wrong or has expired. Ask for a new one.";
  return m;
}
function waNumber(p) {
  let d = String(p || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = COUNTRY_CODE + d.slice(1);
  return d.replace(/\D/g, "");
}
function openExternal(url) {
  if (window.AndroidBridge && AndroidBridge.openUrl) AndroidBridge.openUrl(url);
  else window.open(url, "_blank");
}
function saveFile(name, mime, text) {
  if (window.AndroidBridge && AndroidBridge.saveFile) { AndroidBridge.saveFile(name, mime, text); return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast("Saved " + name);
}
function printPage(title) {
  if (window.AndroidBridge && AndroidBridge.print) AndroidBridge.print(title); else window.print();
}
function share(text) {
  if (window.AndroidBridge && AndroidBridge.share) AndroidBridge.share(text);
  else if (navigator.share) navigator.share({ text }).catch(() => {});
  else copy(text);
}
function copy(text) {
  if (window.AndroidBridge && AndroidBridge.copy) { AndroidBridge.copy(text); toast("Copied"); return; }
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("Copied"), () => toast("Couldn't copy. Press and hold the code to copy it."));
}
function topbar(title, { backTo, eyebrow, right = "" } = {}) {
  return `<div class="topbar">
    ${backTo ? `<button class="iconbtn" data-act="back" data-to="${esc(backTo)}" aria-label="Back">‹</button>` : ""}
    <div class="title">${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}<h2>${esc(title)}</h2></div>
    ${right}
  </div>`;
}

/* ---------------- stats ---------------- */
function attStats(list) { // list of {d, m}
  const a = { P: 0, L: 0, A: 0, total: 0 };
  list.forEach(x => { if (a[x.m] != null) { a[x.m]++; a.total++; } });
  a.pct = a.total ? (a.P + a.L) / a.total * 100 : null;
  return a;
}
function avg(grades) { return grades.length ? grades.reduce((t, g) => t + (g.m ? g.s / g.m : 0), 0) / grades.length * 100 : null; }
function studentData(b, sid) {
  const att = Object.keys(b.att).sort().filter(d => b.att[d][sid]).map(d => ({ d, m: b.att[d][sid] }));
  const grades = [...b.assess].sort((x, y) => String(x.day).localeCompare(y.day))
    .filter(a => b.scores[a.id] && b.scores[a.id][sid] != null)
    .map(a => ({ t: a.title, k: a.kind, d: a.day, m: Number(a.max_marks), s: Number(b.scores[a.id][sid]) }));
  return { att, grades };
}

/* ---------------- data ---------------- */
async function loadClasses() {
  S.classes = await API.select("classes", "select=id,name,subject,term,teacher_name,department_id,students(count)&order=created_at.asc");
}
async function loadClass(id) {
  const q = `class_id=eq.${id}`;
  const [info, students, att, assess, scores] = await Promise.all([
    API.select("classes", `id=eq.${id}&select=*`),
    API.select("students", `${q}&select=*`),
    API.select("attendance", `${q}&select=student_id,day,mark,notified_at`),
    API.select("assessments", `${q}&select=*&order=day.desc`),
    API.select("scores", `${q}&select=assessment_id,student_id,score`)
  ]);
  if (!info.length) { delete S.bundles[id]; return null; }
  const b = { info: info[0], students, att: {}, notified: {}, assess, scores: {}, at: Date.now() };
  att.forEach(r => { (b.att[r.day] = b.att[r.day] || {})[r.student_id] = r.mark; if (r.notified_at) (b.notified[r.day] = b.notified[r.day] || {})[r.student_id] = true; });
  scores.forEach(r => { (b.scores[r.assessment_id] = b.scores[r.assessment_id] || {})[r.student_id] = Number(r.score); });
  // Keep edits that are still being saved.
  const old = S.bundles[id];
  if (old && old.unsaved) { Object.entries(old.unsaved).forEach(([k, fn]) => fn(b)); b.unsaved = old.unsaved; }
  S.bundles[id] = b;
  return b;
}
async function loadMembership() {
  S.member = (await API.rpc("my_membership", {})) || null;
}
async function loadInstitute() {
  const [o, day] = await Promise.all([API.rpc("institute_overview", {}), API.rpc("institute_day", { p_day: S.instDate })]);
  S.inst = o; S.instDay = day || {}; S.instAt = Date.now();
}
function deptName(id) {
  const list = (S.inst && S.inst.departments) || (S.member && S.member.departments) || [];
  const d = list.find(x => x.id === id); return d ? d.name : "No department";
}
function track(p) { S.pending++; return p.finally(() => { S.pending--; }); }

/* ---------------- router ---------------- */
S.navDepth = 0;
window.addEventListener("hashchange", () => { S.navDepth++; S.confirm = null; S.error = ""; route(); });

async function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/");
  if (!API.config()) return setupView();
  if (API.signedIn && ["", "teacher", "signup", "forgot", "code", "report", "setup"].includes(h)) return swap("classes");
  if (!API.signedIn && S.code && ["", "code"].includes(h)) return swap("report");
  if (h === "") return welcomeView();
  if (h === "setup") return setupView();
  if (h === "teacher") return loginView();
  if (h === "signup") return signupView();
  if (h === "forgot") return forgotView();
  if (h === "code") return codeView();
  if (h === "report") return reportView();
  if (!API.signedIn) return go("teacher");
  if (h === "classes") return classesView();
  if (S.member === undefined) { try { await loadMembership(); } catch { S.member = null; } }
  if (h === "new-class") return classFormView(null);
  if (h === "institute-new") return instituteFormView();
  if (h === "join") return joinView();
  if (parts[0] === "inst") {
    if (parts[1] === "student" && parts[2]) return instStudentView(parts[2]);
    if (parts[1] === "class" && parts[2]) return instClassView(parts[2]);
    if (parts[1] === "month" && parts[2]) return instMonthView(parts[2]);
    return instView(parts[1] || "overview");
  }
  if (parts[0] === "class" && parts[1]) {
    const id = parts[1];
    if (parts[2] === "student" && parts[3]) return studentView(id, parts[3]);
    if (parts[2] === "month") return teacherMonthView(id);
    return classView(id, parts[2] || "attendance");
  }
  go("");
}

/* ---------------- welcome / setup ---------------- */
function welcomeView() {
  app.innerHTML = `
    <div class="hero"><div class="logo">SA</div><h1>School App</h1><p class="muted">Attendance and marks, always up to date for teachers, students and parents.</p></div>
    <button class="choice" data-act="nav" data-to="teacher"><span class="ic">T</span><span><b>I'm a teacher</b><span class="muted small">Take attendance, enter marks, share progress</span></span></button>
    <button class="choice" data-act="nav" data-to="code"><span class="ic">S</span><span><b>I'm a student or parent</b><span class="muted small">Enter the code from your teacher</span></span></button>
    ${API.config() && !API.config().builtIn ? `<button class="linkbtn small" data-act="nav" data-to="setup">Server settings</button>` : ""}`;
}
function setupView() {
  const c = API.config() || {};
  app.innerHTML = `
    <div class="hero"><div class="logo">SA</div><h1>Connect to your school</h1><p class="muted">Ask the person who set up the app for your school's server address and key. You only do this once.</p></div>
    <form class="card" data-form="setup">
      <label class="field">Server address<input class="input" name="url" required placeholder="https://xxxx.supabase.co" value="${esc(c.url || "")}" autocomplete="off" inputmode="url"></label>
      <label class="field">Key<input class="input" name="key" required placeholder="eyJhbGciOi…" value="${esc(c.key || "")}" autocomplete="off"></label>
      ${S.error ? `<div class="error">${esc(S.error)}</div>` : ""}
      <button class="btn primary block" type="submit">Connect</button>
    </form>`;
}

/* ---------------- teacher auth ---------------- */
function loginView() {
  app.innerHTML = `${topbar("Teacher log in", { backTo: "" })}
    <form class="card" data-form="login">
      <label class="field">Email<input class="input" type="email" name="email" required autocomplete="email"></label>
      <label class="field">Password<input class="input" type="password" name="password" required autocomplete="current-password"></label>
      ${S.error ? `<div class="error">${esc(S.error)}</div>` : ""}
      <button class="btn primary block" type="submit">Log in</button>
      <div class="between"><button type="button" class="linkbtn" data-act="nav" data-to="signup">Create teacher account</button><button type="button" class="linkbtn" data-act="nav" data-to="forgot">Forgot password?</button></div>
    </form>`;
}
function signupView() {
  app.innerHTML = `${topbar("Create teacher account", { backTo: "teacher" })}
    <form class="card" data-form="signup">
      <label class="field">Your name (students will see this)<input class="input" name="name" required maxlength="60" placeholder="Ms. Ahmed" autocomplete="name"></label>
      <label class="field">Email<input class="input" type="email" name="email" required autocomplete="email"></label>
      <label class="field">Password (at least 6 characters)<input class="input" type="password" name="password" required minlength="6" autocomplete="new-password"></label>
      ${S.error ? `<div class="error">${esc(S.error)}</div>` : ""}
      <button class="btn primary block" type="submit">Create account</button>
    </form>`;
}
function forgotView() {
  const sent = S.resetEmail;
  app.innerHTML = `${topbar("Reset password", { backTo: "teacher" })}
    ${sent ? `<form class="card" data-form="reset">
      <p class="muted">We emailed a 6-digit code to <b>${esc(sent)}</b>. Type it here with your new password.</p>
      <label class="field">Code from the email<input class="input code-input" name="code" required inputmode="numeric" maxlength="10" autocomplete="one-time-code"></label>
      <label class="field">New password (at least 6 characters)<input class="input" type="password" name="password" required minlength="6" autocomplete="new-password"></label>
      ${S.error ? `<div class="error">${esc(S.error)}</div>` : ""}
      <button class="btn primary block" type="submit">Save new password</button>
      <button type="button" class="linkbtn" data-act="reset-again">Use a different email</button>
    </form>` : `<form class="card" data-form="forgot">
      <p class="muted">We'll email you a code to set a new password.</p>
      <label class="field">Email<input class="input" type="email" name="email" required autocomplete="email"></label>
      ${S.error ? `<div class="error">${esc(S.error)}</div>` : ""}
      <button class="btn primary block" type="submit">Send code</button>
    </form>`}`;
}

/* ---------------- student / parent ---------------- */
function codeView() {
  app.innerHTML = `${topbar("Student or parent", { backTo: "" })}
    <form class="card" data-form="code">
      <p class="muted">Type the 10-character code your teacher gave you. Students and parents have different codes.</p>
      <input class="input code-input" name="code" required maxlength="11" placeholder="XXXXX-XXXXX" autocomplete="off" autocapitalize="characters" spellcheck="false">
      ${S.error ? `<div class="error">${esc(S.error)}</div>` : ""}
      <button class="btn primary block" type="submit">See record</button>
    </form>`;
}
async function fetchReport() {
  const r = await API.report(S.code);
  if (!r) { S.code = null; LS.set("sr_code", null); S.report = null; return false; }
  S.report = r; S.reportAt = new Date(); return true;
}
async function reportView(refresh = true) {
  if (!S.code) return go("code");
  if (!S.report) app.innerHTML = `<div class="center muted">Loading record…</div>`;
  else drawReport();
  if (!refresh) return;
  try {
    const ok = await fetchReport();
    if (!ok) { S.error = "This code no longer works. Ask your teacher for a new one."; return codeView(); }
    drawReport();
  } catch (e) { if (!S.report) app.innerHTML = `${topbar("My record", { backTo: "" })}<div class="card"><div class="error">${esc(errMsg(e))}</div><button class="btn" data-act="refresh-report">Try again</button></div>`; else toast(errMsg(e)); }
}
function drawReport() {
  if (location.hash.replace(/^#\/?/, "") !== "report") return;
  const r = S.report, c = r.class || {};
  app.innerHTML = `
    ${topbar(r.name, { eyebrow: r.role === "parent" ? "Parent view" : "My record", right: `<button class="iconbtn" data-act="refresh-report" aria-label="Refresh">↻</button>` })}
    <div class="muted small">${[c.institute, c.department, c.name, c.subject, c.teacher && "Teacher: " + c.teacher, c.term, r.roll && "Roll no. " + r.roll].filter(Boolean).map(esc).join(" · ")}</div>
    ${reportCard(r.attendance || [], (r.grades || []).map(g => ({ ...g, m: Number(g.m), s: Number(g.s) })))}
    <div class="sync">Updated ${esc(S.reportAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))} · refreshes by itself</div>
    <button class="btn" data-act="logout-code">Log out</button>`;
}

function reportCard(att, grades, { openDays = false } = {}) {
  const a = attStats(att), g = avg(grades);
  const aColor = a.pct == null ? "var(--rule)" : a.pct < ATT_MIN ? "var(--absent)" : "var(--present)";
  const months = {};
  att.forEach(x => { const k = String(x.d).slice(0, 7); (months[k] = months[k] || []).push(x); });
  const recent = att.slice(-21);
  return `
    <div class="stats">
      <div class="stat"><div class="ring" style="--p:${a.pct ?? 0};--c:${aColor}"><span>${pct(a.pct)}</span></div>
        <b>Attendance</b>
        <div class="chips" style="justify-content:center"><span class="chip P"><b>${a.P}</b> present</span><span class="chip L"><b>${a.L}</b> late</span><span class="chip A"><b>${a.A}</b> absent</span></div>
        ${a.pct != null && a.pct < ATT_MIN ? `<span class="chip warn">Below ${ATT_MIN}% minimum</span>` : ""}
      </div>
      <div class="stat"><div class="ring" style="--p:${g ?? 0}"><span>${pct(g)}</span></div>
        <b>Average mark</b>
        <span class="muted small">${grades.length ? `${grades.length} assessment${grades.length > 1 ? "s" : ""}` : "No marks yet"}</span>
        ${g != null ? (g < PASS_MIN ? `<span class="chip warn">Needs support</span>` : `<span class="chip ok">On track</span>`) : ""}
      </div>
    </div>
    ${recent.length ? `<div class="card"><h3>Recent days</h3><div class="dots">${recent.map(x => `<span class="dot ${x.m}" title="${esc(fmt(x.d))}"><span><b>${x.m}</b><br>${new Date(String(x.d).slice(0, 10) + "T12:00:00").getDate()}</span></span>`).join("")}</div>
      <p class="muted small">P present · L late · A absent. Numbers are the day of the month.</p></div>` : ""}
    ${Object.keys(months).length > 1 ? `<div class="card"><h3>By month</h3><div class="list">${Object.keys(months).sort().reverse().map(k => { const s = attStats(months[k]); return `<div class="item"><span class="grow">${esc(fmt(k + "-15", { month: "long", year: "numeric" }))}</span><span class="num small">${s.P + s.L}/${s.total} days</span><span class="chip ${s.pct < ATT_MIN ? "warn" : "ok"}">${pct(s.pct)}</span></div>`; }).join("")}</div></div>` : ""}
    ${att.length ? `<details class="card" ${openDays ? "open" : ""}><summary><h3 style="display:inline">Every day</h3> <span class="muted small">(${att.length} days)</span></summary>
      <div class="list">${Object.keys(months).sort().reverse().map(k => `<div class="eyebrow" style="padding-top:10px">${esc(fmt(k + "-15", { month: "long", year: "numeric" }))}</div>` +
        [...months[k]].reverse().map(x => `<div class="item"><span class="grow">${esc(fmt(x.d, { weekday: "long", day: "numeric", month: "short" }))}</span><span class="chip ${x.m}">${{ P: "Present", L: "Late", A: "Absent" }[x.m]}</span></div>`).join("")).join("")}</div>
    </details>` : ""}
    <div class="card"><h3>Results</h3>
      ${grades.length ? `<div>${[...grades].reverse().map(x => `<div class="grade"><div><div class="name">${esc(x.t)}${x.k ? ` <span class="chip">${esc(x.k)}</span>` : ""}</div><div class="muted small">${esc(fmt(x.d, { day: "numeric", month: "short", year: "numeric" }))}</div></div><span class="num">${x.s} / ${x.m}</span><div class="pbar"><i style="width:${x.m ? Math.min(100, x.s / x.m * 100) : 0}%"></i></div></div>`).join("")}</div>` : `<p class="muted">No results entered yet.</p>`}
    </div>`;
}

/* ---------------- teacher: classes ---------------- */
async function classesView() {
  const draw = () => {
    const list = S.classes || [];
    app.innerHTML = `
      ${topbar("My classes", { eyebrow: API.user && API.user.name ? API.user.name : "Teacher", right: `<button class="btn sm" data-act="logout">Log out</button>` })}
      ${S.confirm === "logout" ? `<div class="card"><p>Log out of <b>${esc((API.user && API.user.email) || "this account")}</b>? You'll need your email and password to log in again.</p>
        <div class="row-wrap"><button class="btn danger" data-act="logout">Log out</button><button class="btn" data-act="cancel">Stay logged in</button></div></div>` : ""}
      ${instituteCard()}
      ${S.classes == null ? `<div class="center muted">Loading classes…</div>` : list.length ? `<div class="card" style="padding:4px 16px"><div class="list">
        ${list.map(c => `<button class="item" data-act="nav" data-to="class/${c.id}/attendance"><span class="grow"><span class="name">${esc(c.name)}</span><span class="sub" style="display:block">${[c.subject, c.term].filter(Boolean).map(esc).join(" · ") || "&nbsp;"}</span></span>${c.department_id && S.member ? `<span class="chip info">${esc(deptName(c.department_id))}</span>` : ""}<span class="chip">${(c.students && c.students[0] && c.students[0].count) || 0} students</span><span class="chev">›</span></button>`).join("")}
      </div></div>` : `<div class="card"><div class="empty"><h3>No classes yet</h3><p>Create your first class, then add your students.</p></div></div>`}
      <button class="btn primary block" data-act="nav" data-to="new-class">+ New class</button>
      ${window.AndroidBridge && AndroidBridge.version ? `<div class="sync">School App version ${esc(AndroidBridge.version())}</div>` : ""}`;
  };
  draw();
  try { await Promise.all([loadClasses(), loadMembership().catch(() => { S.member = null; })]); if (curHash() === "classes") draw(); } catch (e) { handleAuthError(e) || toast(errMsg(e)); }
}

function classFormView(b) {
  const i = b ? b.info : { name: "", subject: "", term: "", teacher_name: (API.user && API.user.name) || "" };
  app.innerHTML = `${topbar(b ? "Class settings" : "New class", { backTo: b ? `class/${i.id}/attendance` : "classes" })}
    <form class="card" data-form="class" data-id="${b ? i.id : ""}">
      <label class="field">Class name<input class="input" name="name" required maxlength="80" placeholder="Grade 8 · Section B" value="${esc(i.name)}"></label>
      <label class="field">Subject<input class="input" name="subject" maxlength="60" placeholder="Mathematics" value="${esc(i.subject)}"></label>
      <label class="field">Term<input class="input" name="term" maxlength="40" placeholder="Term 2, 2026" value="${esc(i.term)}"></label>
      <label class="field">Teacher name (shown to students and parents)<input class="input" name="teacher_name" maxlength="60" value="${esc(i.teacher_name)}"></label>
      ${S.member && S.member.departments.length ? `<label class="field">Department<select class="input" name="department_id">
        <option value="">No department</option>
        ${S.member.departments.map(d => `<option value="${d.id}" ${(b ? i.department_id : S.member.department_id) === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}
      </select></label>` : ""}
      ${S.error ? `<div class="error">${esc(S.error)}</div>` : ""}
      <button class="btn primary block" type="submit">${b ? "Save" : "Create class"}</button>
    </form>
    ${b ? `<div class="card"><h3>Delete class</h3><p class="muted small">Deletes the class with all its students, attendance and marks. Their codes stop working.</p>
      ${S.confirm === "del-class" ? `<div class="row-wrap"><button class="btn danger" data-act="delete-class" data-id="${i.id}">Yes, delete everything</button><button class="btn" data-act="cancel">Keep</button></div>` : `<button class="btn danger" data-act="confirm" data-key="del-class">Delete class</button>`}</div>` : ""}`;
}

/* ---------------- teacher: one class ---------------- */
async function classView(id, tab) {
  const draw = () => drawClass(id, tab);
  if (S.bundles[id]) draw(); else app.innerHTML = `${topbar("Loading…", { backTo: "classes" })}<div class="center muted">Loading class…</div>`;
  try {
    const b = await loadClass(id);
    if (!b) { toast("That class doesn't exist any more."); return go("classes"); }
    if (curHash() === `class/${id}/${tab}` || (tab === "attendance" && curHash() === `class/${id}`)) draw();
  } catch (e) { handleAuthError(e) || toast(errMsg(e)); }
}
function curHash() { return location.hash.replace(/^#\/?/, ""); }

function drawClass(id, tab) {
  const b = S.bundles[id]; if (!b) return;
  if (tab === "settings") return classFormView(b);
  const keepScroll = window.scrollY;
  const focused = document.activeElement && document.activeElement.id;
  const tabs = [["attendance", "Attendance"], ["marks", "Marks"], ["students", "Students"]];
  app.innerHTML = `
    ${topbar(b.info.name, { backTo: "classes", eyebrow: [b.info.subject, b.info.term].filter(Boolean).join(" · ") || "Class", right: `<button class="iconbtn" data-act="nav" data-to="class/${id}/settings" aria-label="Class settings">⚙</button>` })}
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab ${tab === k ? "on" : ""}" role="tab" aria-selected="${tab === k}" data-act="nav" data-to="class/${id}/${k}" data-replace="1">${l}</button>`).join("")}</div>
    ${tab === "marks" ? marksTab(id, b) : tab === "students" ? studentsTab(id, b) : attendanceTab(id, b)}
    <div class="sync">${S.pending ? "Saving…" : "Saved · updated " + new Date(b.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>`;
  window.scrollTo(0, keepScroll);
  if (focused) { const el = document.getElementById(focused); if (el) el.focus(); }
}
function noStudents(id) {
  return `<div class="card"><div class="empty"><h3>No students yet</h3><p>Add your class list first.</p><button class="btn primary" data-act="nav" data-to="class/${id}/students">Add students</button></div></div>`;
}

function attendanceTab(id, b) {
  if (!b.students.length) return noStudents(id);
  const marks = b.att[S.date] || {};
  const list = sortSt(b.students);
  const c = { P: 0, L: 0, A: 0 }; list.forEach(s => { if (marks[s.id]) c[marks[s.id]]++; });
  const left = list.length - c.P - c.L - c.A;
  return `
    <div class="card">
      <div class="datebar">
        <button class="iconbtn" data-act="day" data-n="-1" aria-label="Previous day">‹</button>
        <label class="day">${S.date === today() ? "Today, " : ""}${esc(fmt(S.date))}<input type="date" id="pick-date" value="${S.date}" aria-label="Choose date"></label>
        <button class="iconbtn" data-act="pick-date" aria-label="Choose date">📅</button>
        <button class="iconbtn" data-act="day" data-n="1" aria-label="Next day">›</button>
      </div>
      <div class="chips"><span class="chip P"><b>${c.P}</b> present</span><span class="chip L"><b>${c.L}</b> late</span><span class="chip A"><b>${c.A}</b> absent</span>${left ? `<span class="chip"><b>${left}</b> not marked</span>` : `<span class="chip ok">All marked</span>`}</div>
      ${left ? `<button class="btn block" data-act="all-present" data-id="${id}">Mark the rest present</button>` : ""}
    </div>
    <div class="card" style="padding:4px 14px"><div class="list">
      ${list.map(s => `<div class="item"><span class="roll">${esc(s.roll || "–")}</span><span class="grow name">${esc(s.name)}</span>
        <span class="marks">${["P", "L", "A"].map(m => `<button class="mark ${m} ${marks[s.id] === m ? "on" : ""}" data-act="mark" data-id="${id}" data-sid="${s.id}" data-m="${m}" aria-pressed="${marks[s.id] === m}" aria-label="${{ P: "Present", L: "Late", A: "Absent" }[m]}">${m}</button>`).join("")}</span></div>`).join("")}
    </div></div>
    ${notifyCard(id, b)}
    <p class="muted small">Tap P, L or A. Tap again to clear. Saves straight away.</p>
    <button class="btn block" data-act="nav" data-to="class/${id}/month">Monthly attendance report</button>`;
}
function absentMessage(s, b, day) {
  const when = day === today() ? `today, ${fmt(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}` : `on ${fmt(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`;
  const inst = S.member && S.member.institute ? S.member.institute.name : "";
  const from = [b.info.teacher_name, inst].filter(Boolean).join(", ");
  return `Assalam-o-Alaikum. This is to inform you that ${s.name}${s.roll ? " (Roll no. " + s.roll + ")" : ""} of ${b.info.name} was absent ${when}.${from ? "\n\n" + from : ""}`;
}
function notifyCard(id, b) {
  const marks = b.att[S.date] || {};
  const absent = sortSt(b.students).filter(s => marks[s.id] === "A");
  if (!absent.length) return "";
  const sent = b.notified[S.date] || {};
  const done = absent.filter(s => sent[s.id]).length;
  return `<div class="card"><div class="between"><h3>Tell parents</h3><span class="chip ${done === absent.length ? "ok" : ""}"><b>${done}/${absent.length}</b> sent</span></div>
    <p class="muted small">Nothing is sent unless you tap. Each button opens WhatsApp or SMS with the message ready, and you tap send.</p>
    <div class="list">${absent.map(s => `<div class="item"><span class="grow"><span class="name">${esc(s.name)}</span><span class="sub" style="display:block">${s.parent_phone ? esc(s.parent_phone) : "No parent number"}</span></span>
      ${sent[s.id] ? `<span class="chip ok">✓ Sent</span>` : ""}
      ${s.parent_phone ? `<button class="btn sm ${sent[s.id] ? "" : "primary"}" data-act="notify" data-via="wa" data-id="${id}" data-sid="${s.id}">WhatsApp</button><button class="btn sm" data-act="notify" data-via="sms" data-id="${id}" data-sid="${s.id}">SMS</button>`
        : `<button class="btn sm" data-act="add-phone" data-id="${id}" data-sid="${s.id}">Add number</button>`}</div>`).join("")}</div></div>`;
}

function marksTab(id, b) {
  if (!b.students.length) return noStudents(id);
  let aid = S.selAssess[id];
  if (!b.assess.find(a => a.id === aid)) aid = S.selAssess[id] = b.assess[0] && b.assess[0].id;
  const a = b.assess.find(x => x.id === aid);
  const form = `<form class="card" data-form="assess" data-id="${id}">
      <h3>New test, quiz or exam</h3>
      <label class="field">Name<input class="input" name="title" required maxlength="60" placeholder="Unit 3 test"></label>
      <label class="field">Type<select class="input" name="kind">${KINDS.map(k => `<option>${k}</option>`).join("")}</select></label>
      <div class="row-wrap" style="align-items:end">
        <label class="field" style="flex:1 1 120px">Out of<input class="input" name="max" type="number" min="1" max="1000" step="any" value="20" required></label>
        <label class="field" style="flex:1 1 150px">Date<input class="input" name="day" type="date" value="${today()}" required></label>
      </div>
      <button class="btn primary block" type="submit">Add</button>
    </form>`;
  if (!a) return `<div class="card"><div class="empty"><h3>No marks yet</h3><p>Add a test, quiz, assignment or exam below, then type each student's score.</p></div></div>${form}`;
  const list = sortSt(b.students), sc = b.scores[a.id] || {};
  const vals = list.map(s => sc[s.id]).filter(v => v != null);
  const mean = vals.length ? vals.reduce((t, v) => t + v, 0) / vals.length : null;
  return `
    <div class="assess-strip">${b.assess.map(x => `<button class="assess ${x.id === a.id ? "on" : ""}" data-act="pick-assess" data-id="${id}" data-aid="${x.id}">${esc(x.title)}<small>${esc(x.kind || "Test")} · ${esc(fmt(x.day, { day: "numeric", month: "short" }))} · /${Number(x.max_marks)}</small></button>`).join("")}</div>
    <div class="card">
      <div class="between"><div><h3>${esc(a.title)}</h3><div class="muted small">${esc(a.kind || "Test")} · ${esc(fmt(a.day, { weekday: "long", day: "numeric", month: "long" }))} · out of <span class="num">${Number(a.max_marks)}</span></div></div>
        ${S.confirm === "del-" + a.id ? `<div class="row-wrap"><button class="btn sm danger" data-act="delete-assess" data-id="${id}" data-aid="${a.id}">Delete</button><button class="btn sm" data-act="cancel">Keep</button></div>` : `<button class="btn sm danger" data-act="confirm" data-key="del-${a.id}">Delete</button>`}</div>
      <div class="chips"><span class="chip info">Average <b>${mean == null ? "–" : mean.toFixed(1)}</b></span><span class="chip">Highest <b>${vals.length ? Math.max(...vals) : "–"}</b></span><span class="chip">Lowest <b>${vals.length ? Math.min(...vals) : "–"}</b></span><span class="chip"><b>${vals.length}/${list.length}</b> entered</span></div>
    </div>
    <div class="card" style="padding:4px 14px"><div class="list">
      ${list.map(s => `<div class="item"><span class="roll">${esc(s.roll || "–")}</span><span class="grow name">${esc(s.name)}</span>
        <input class="input score" id="sc-${a.id}-${s.id}" type="number" inputmode="decimal" min="0" max="${Number(a.max_marks)}" step="any" value="${sc[s.id] ?? ""}" data-score="1" data-id="${id}" data-aid="${a.id}" data-sid="${s.id}" aria-label="Score for ${esc(s.name)}"><span class="outof">/${Number(a.max_marks)}</span></div>`).join("")}
    </div></div>
    <p class="muted small">Scores save as you type. Leave empty if the student was absent.</p>
    ${form}`;
}

function studentsTab(id, b) {
  const list = sortSt(b.students);
  const rows = list.map(s => {
    const d = studentData(b, s.id), a = attStats(d.att), g = avg(d.grades);
    const flags = (a.pct != null && a.pct < ATT_MIN) || (g != null && g < PASS_MIN);
    return `<button class="item" data-act="nav" data-to="class/${id}/student/${s.id}"><span class="roll">${esc(s.roll || "–")}</span>
      <span class="grow"><span class="name">${esc(s.name)}</span><span class="sub" style="display:block">Attendance ${pct(a.pct)} · Average ${pct(g)}</span></span>
      ${flags ? `<span class="chip warn">Check</span>` : ""}<span class="chev">›</span></button>`;
  }).join("");
  return `
    <form class="card" data-form="student" data-id="${id}">
      <h3>Add student</h3>
      <div class="row-wrap" style="align-items:end">
        <label class="field" style="flex:0 1 90px">Roll no.<input class="input" id="new-roll" name="roll" maxlength="10" inputmode="numeric"></label>
        <label class="field" style="flex:1 1 180px">Full name<input class="input" id="new-name" name="name" required maxlength="80"></label>
      </div>
      <label class="field">Parent's WhatsApp number (optional)<input class="input" id="new-phone" name="phone" inputmode="tel" maxlength="20" placeholder="0300 1234567"></label>
      <button class="btn primary block" type="submit">Add student</button>
    </form>
    ${list.length ? `<div class="card" style="padding:4px 14px"><div class="list">${rows}</div></div>
      <p class="muted small">Tap a student to see their record and their student and parent codes.</p>` : ""}`;
}

async function studentView(id, sid) {
  if (!S.bundles[id]) { app.innerHTML = `<div class="center muted">Loading…</div>`; try { await loadClass(id); } catch (e) { return handleAuthError(e) || toast(errMsg(e)); } }
  drawStudent(id, sid);
}
function drawStudent(id, sid) {
  const b = S.bundles[id]; if (!b) return go("classes");
  const s = b.students.find(x => x.id === sid); if (!s) return go(`class/${id}/students`);
  const d = studentData(b, sid);
  const shareText = who => `${who === "parent" ? "Parent" : "Student"} login for ${s.name} (${b.info.name}).\n\nOpen the School App app, tap "I'm a student or parent", and enter this code:\n\n${who === "parent" ? s.parent_code : s.student_code}`;
  const editing = S.editStudent === sid;
  app.innerHTML = `
    ${topbar(s.name, { backTo: `class/${id}/students`, eyebrow: `${b.info.name}${s.roll ? " · Roll no. " + s.roll : ""}` })}
    ${reportCard(d.att, d.grades)}
    <div class="card"><h3>Login codes</h3>
      <p class="muted small">Give the student code to the student and the parent code to the parent. Each one opens only this student's record.</p>
      ${[["student", "Student code", s.student_code], ["parent", "Parent code", s.parent_code]].map(([w, l, c]) => `
        <div class="codebox"><div class="eyebrow">${l}</div><div class="code">${esc(c)}</div>
          <div class="row-wrap"><button class="btn sm primary" data-act="share" data-text="${esc(shareText(w))}">Share</button><button class="btn sm" data-act="copy" data-text="${esc(c)}">Copy</button>
          ${S.confirm === "reset-" + w ? `<button class="btn sm danger" data-act="reset-code" data-id="${id}" data-sid="${sid}" data-which="${w}">Make new code</button><button class="btn sm" data-act="cancel">Keep</button>` : `<button class="btn sm" data-act="confirm" data-key="reset-${w}">New code…</button>`}</div>
          ${S.confirm === "reset-" + w ? `<p class="small muted">The old code will stop working.</p>` : ""}
        </div>`).join("")}
    </div>
    <div class="card"><h3>Student details</h3>
      ${editing ? `<form class="stack" data-form="edit-student" data-id="${id}" data-sid="${sid}">
          <label class="field">Roll no.<input class="input" name="roll" maxlength="10" value="${esc(s.roll)}"></label>
          <label class="field">Full name<input class="input" name="name" required maxlength="80" value="${esc(s.name)}"></label>
          <label class="field">Parent's WhatsApp number<input class="input" name="phone" inputmode="tel" maxlength="20" placeholder="0300 1234567" value="${esc(s.parent_phone || "")}"></label>
          <div class="row-wrap"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="edit-student" data-sid="">Cancel</button></div>
        </form>` : `<p class="small">Parent's number: ${s.parent_phone ? `<b>${esc(s.parent_phone)}</b>` : `<span class="muted">not added</span>`}</p>
        <div class="row-wrap"><button class="btn" data-act="edit-student" data-sid="${sid}">Edit name, roll no. or number</button>
        ${S.confirm === "rm-" + sid ? `<button class="btn danger" data-act="remove-student" data-id="${id}" data-sid="${sid}">Remove for good</button><button class="btn" data-act="cancel">Keep</button>` : `<button class="btn danger" data-act="confirm" data-key="rm-${sid}">Remove student</button>`}</div>`}
    </div>`;
}

/* ---------------- institute: teachers' side ---------------- */
function instituteCard() {
  const m = S.member;
  if (m === undefined) return "";
  if (!m) return `<div class="card"><div><div class="eyebrow">Institute</div><h3>Is your school or college using School App?</h3></div>
    <p class="muted small">Principals create the institute and invite teachers. Your classes stay private to you; only the principal can view them.</p>
    <div class="stack"><button class="btn primary" data-act="nav" data-to="institute-new">Create an institute (I'm the principal)</button>
    <button class="btn" data-act="nav" data-to="join">Join with an invite code</button></div></div>`;
  const i = m.institute;
  return `<div class="card"><div class="between"><div><div class="eyebrow">${esc(i.kind)}${i.city ? " · " + esc(i.city) : ""}</div><h3>${esc(i.name)}</h3>
      <div class="muted small">${esc(ROLE_NAME[m.role])}${m.department_id ? " · " + esc(deptName(m.department_id)) : ""}</div></div>
      ${m.role === "principal" ? `<button class="btn primary sm" data-act="nav" data-to="inst/overview">Principal dashboard</button>` : ""}</div>
    ${m.role !== "principal" ? `<p class="muted small">Your classes are private to you. The principal can view them but can't change them.</p>` : ""}</div>`;
}
function instituteFormView() {
  const i = (S.inst && S.inst.institute) || null;
  app.innerHTML = `${topbar(i ? "Institute details" : "Create an institute", { backTo: i ? "inst/staff" : "classes" })}
    <form class="card" data-form="institute">
      ${i ? "" : `<p class="muted">You'll be the <b>principal</b>. Next you'll add departments and invite teachers and department heads.</p>`}
      <label class="field">Type<select class="input" name="kind">${["School", "College", "University", "Academy", "Organization"].map(k => `<option ${i && i.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>
      <label class="field">Name<input class="input" name="name" required maxlength="100" placeholder="Government High School No. 1" value="${esc(i ? i.name : "")}"></label>
      <label class="field">City<input class="input" name="city" maxlength="60" value="${esc(i ? i.city : "")}"></label>
      ${i ? "" : `<label class="field">Your name<input class="input" name="my_name" required maxlength="80" value="${esc((API.user && API.user.name) || "")}"></label>`}
      ${S.error ? `<div class="error">${esc(S.error)}</div>` : ""}
      <button class="btn primary block" type="submit">${i ? "Save" : "Create institute"}</button>
    </form>`;
}
function joinView() {
  app.innerHTML = `${topbar("Join an institute", { backTo: "classes" })}
    <form class="card" data-form="join">
      <p class="muted">Type the invite code your principal sent you. Each code works once.</p>
      <input class="input code-input" name="code" required maxlength="11" placeholder="XXXXX-XXXXX" autocomplete="off" autocapitalize="characters" spellcheck="false">
      <label class="field">Your name<input class="input" name="my_name" required maxlength="80" value="${esc((API.user && API.user.name) || "")}"></label>
      ${S.error ? `<div class="error">${esc(S.error)}</div>` : ""}
      <button class="btn primary block" type="submit">Join</button>
    </form>`;
}

/* ---------------- institute: principal dashboard (view only) ---------------- */
async function instView(tab) {
  if (S.inst) drawInst(tab); else app.innerHTML = `${topbar("Principal", { backTo: "classes" })}<div class="center muted">Loading institute…</div>`;
  try { await loadInstitute(); if (curHash().split("/")[0] === "inst") drawInst(tab); }
  catch (e) { if (!handleAuthError(e)) { toast(errMsg(e)); if (/only the principal/i.test(errMsg(e))) go("classes"); } }
}
function allStudents() {
  const out = [];
  (S.inst.classes || []).forEach(k => k.students.forEach(s => out.push({ ...s, cls: k })));
  return out;
}
function sAtt(s) { const t = s.P + s.L + s.A; return t ? (s.P + s.L) / t * 100 : null; }
function deptFilterSelect() {
  const ds = S.inst.departments;
  if (!ds.length) return "";
  return `<select class="input" id="inst-dept" style="flex:1 1 160px"><option value="">All departments</option>
    ${ds.map(d => `<option value="${d.id}" ${S.instDept === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}
    <option value="none" ${S.instDept === "none" ? "selected" : ""}>No department</option></select>`;
}
function classesInFilter() {
  return (S.inst.classes || []).filter(k => !S.instDept || (S.instDept === "none" ? !k.department_id : k.department_id === S.instDept));
}
function groupByDept(classes) {
  const groups = {};
  classes.forEach(k => { const key = k.department_id || "none"; (groups[key] = groups[key] || []).push(k); });
  return Object.keys(groups).sort((a, b) => deptName(a === "none" ? null : a).localeCompare(deptName(b === "none" ? null : b))).map(key => ({ id: key, name: key === "none" ? "No department" : deptName(key), classes: groups[key] }));
}
function drawInst(tab) {
  if (!S.inst) return;
  const i = S.inst.institute;
  const tabs = [["overview", "Overview"], ["attendance", "Attendance"], ["results", "Results"], ["staff", "Staff"]];
  app.innerHTML = `
    ${topbar(i.name, { backTo: "classes", eyebrow: `Principal · ${i.kind}${i.city ? " · " + i.city : ""}`, right: `<button class="iconbtn" data-act="inst-refresh" aria-label="Refresh">↻</button>` })}
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab ${tab === k ? "on" : ""}" data-act="nav" data-to="inst/${k}" data-replace="1">${l}</button>`).join("")}</div>
    ${tab === "attendance" ? instAttendance() : tab === "results" ? instResults() : tab === "staff" ? instStaff() : instOverview()}
    <div class="sync">View only · updated ${new Date(S.instAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>`;
}
function dayCounts(students) {
  const c = { P: 0, L: 0, A: 0, none: 0 };
  students.forEach(s => { const m = S.instDay[s.id]; if (m) c[m]++; else c.none++; });
  return c;
}
function instOverview() {
  const st = allStudents(), teachers = S.inst.members.filter(m => m.role !== "principal");
  const isToday = S.instDate === today();
  const groups = groupByDept(S.inst.classes);
  const flagged = st.filter(s => { const a = sAtt(s); return (a != null && a < ATT_MIN) || (s.avg != null && s.avg < PASS_MIN); })
    .sort((a, b) => (sAtt(a) ?? 100) - (sAtt(b) ?? 100)).slice(0, 25);
  const c = dayCounts(st);
  if (!S.inst.classes.length) return `<div class="card"><div class="empty"><h3>No classes yet</h3><p>Add departments and invite your teachers in the <b>Staff</b> tab. Their classes will appear here.</p><button class="btn primary" data-act="nav" data-to="inst/staff" data-replace="1">Go to Staff</button></div></div>`;
  return `
    <div class="chips"><span class="chip info"><b>${S.inst.departments.length}</b> departments</span><span class="chip info"><b>${teachers.length}</b> teachers</span><span class="chip info"><b>${S.inst.classes.length}</b> classes</span><span class="chip info"><b>${st.length}</b> students</span></div>
    <div class="card"><div class="between"><h3>${isToday ? "Today" : esc(fmt(S.instDate))}</h3><button class="btn sm" data-act="nav" data-to="inst/attendance" data-replace="1">See who</button></div>
      <div class="chips"><span class="chip P"><b>${c.P}</b> present</span><span class="chip L"><b>${c.L}</b> late</span><span class="chip A"><b>${c.A}</b> absent</span><span class="chip"><b>${c.none}</b> not marked</span></div>
      <div class="list">${groups.map(g => { const ss = g.classes.flatMap(k => k.students), gc = dayCounts(ss), marked = gc.P + gc.L + gc.A;
        return `<div class="item"><span class="grow"><span class="name">${esc(g.name)}</span><span class="sub" style="display:block">${plural(g.classes.length, "class", "classes")} · ${plural(ss.length, "student", "students")}</span></span>
          <span class="chip A"><b>${gc.A}</b> absent</span><span class="chip ${marked && (gc.P + gc.L) / marked * 100 < ATT_MIN ? "warn" : "ok"}">${marked ? pct((gc.P + gc.L) / marked * 100) : "–"}</span></div>`; }).join("")}</div>
    </div>
    <div class="card"><h3>Students needing attention</h3>
      ${flagged.length ? `<div class="list">${flagged.map(s => `<button class="item" data-act="nav" data-to="inst/student/${s.id}"><span class="grow"><span class="name">${esc(s.name)}</span><span class="sub" style="display:block">${esc(s.cls.name)} · ${esc(deptName(s.cls.department_id))}</span></span>
        ${sAtt(s) != null && sAtt(s) < ATT_MIN ? `<span class="chip warn">Att. ${pct(sAtt(s))}</span>` : ""}${s.avg != null && s.avg < PASS_MIN ? `<span class="chip warn">Avg ${pct(s.avg)}</span>` : ""}<span class="chev">›</span></button>`).join("")}</div>`
        : `<p class="muted">Nobody is below ${ATT_MIN}% attendance or a ${PASS_MIN}% average.</p>`}
    </div>`;
}
function instAttendance() {
  const isToday = S.instDate === today();
  const f = S.instFilter;
  const groups = groupByDept(classesInFilter());
  const show = s => { const m = S.instDay[s.id]; return f === "all" || (f === "none" ? !m : m === f); };
  const body = groups.map(g => {
    const cards = g.classes.map(k => {
      const ss = k.students.filter(show); if (!ss.length) return "";
      const kc = dayCounts(k.students);
      return `<div class="card" style="padding:12px 14px"><div class="between"><div><b>${esc(k.name)}</b><div class="muted small">${esc(k.teacher_name || "")}${k.subject ? " · " + esc(k.subject) : ""}</div></div>
          <div class="chips"><span class="chip P"><b>${kc.P}</b></span><span class="chip L"><b>${kc.L}</b></span><span class="chip A"><b>${kc.A}</b></span></div></div>
        <div class="list">${ss.map(s => { const m = S.instDay[s.id]; return `<button class="item" data-act="nav" data-to="inst/student/${s.id}"><span class="roll">${esc(s.roll || "–")}</span><span class="grow name">${esc(s.name)}</span>
          ${m ? `<span class="chip ${m}">${{ P: "Present", L: "Late", A: "Absent" }[m]}</span>` : `<span class="chip">Not marked</span>`}</button>`; }).join("")}</div></div>`;
    }).join("");
    return cards ? `<div class="eyebrow" style="padding-top:6px">${esc(g.name)}</div>${cards}` : "";
  }).join("");
  const filters = [["all", "Everyone"], ["A", "Absent"], ["L", "Late"], ["P", "Present"], ["none", "Not marked"]];
  return `
    <div class="card">
      <div class="datebar">
        <button class="iconbtn" data-act="inst-day" data-n="-1" aria-label="Previous day">‹</button>
        <label class="day">${isToday ? "Today, " : ""}${esc(fmt(S.instDate))}<input type="date" id="inst-date" value="${S.instDate}" aria-label="Choose date"></label>
        <button class="iconbtn" data-act="pick-inst-date" aria-label="Choose date">📅</button>
        <button class="iconbtn" data-act="inst-day" data-n="1" aria-label="Next day">›</button>
      </div>
      <div class="chips">${filters.map(([k, l]) => `<button class="chip ${f === k ? "info" : ""}" style="border:none" data-act="inst-filter" data-f="${k}">${l}</button>`).join("")}</div>
      ${deptFilterSelect() ? `<div class="row-wrap">${deptFilterSelect()}</div>` : ""}
    </div>
    ${body || `<div class="card"><div class="empty"><p>No students match this filter on this day.</p></div></div>`}
    <p class="muted small">Tap a student to see every date they were present, late or absent.</p>`;
}
function instResults() {
  const groups = groupByDept(classesInFilter());
  return `${deptFilterSelect() ? `<div class="row-wrap">${deptFilterSelect()}</div>` : ""}
    ${groups.map(g => `<div class="eyebrow" style="padding-top:6px">${esc(g.name)}</div>` + g.classes.map(k => {
      const atts = k.students.map(sAtt).filter(v => v != null), avgs = k.students.map(s => s.avg).filter(v => v != null);
      const mean = a => a.length ? a.reduce((t, v) => t + v, 0) / a.length : null;
      return `<button class="card" style="text-align:left;width:100%" data-act="nav" data-to="inst/class/${k.id}">
        <div class="between"><div><b>${esc(k.name)}</b><div class="muted small">${esc(k.teacher_name || "")}${k.subject ? " · " + esc(k.subject) : ""} · ${k.students.length} students</div></div><span class="chev">›</span></div>
        <div class="chips"><span class="chip info">Attendance <b>${pct(mean(atts))}</b></span><span class="chip info">Average <b>${pct(mean(avgs))}</b></span><span class="chip"><b>${k.assessments.length}</b> tests & quizzes</span></div>
        ${k.assessments.slice(0, 3).map(a => `<div class="small muted">${esc(a.kind)} · ${esc(a.title)} · ${esc(fmt(a.day, { day: "numeric", month: "short" }))} · avg ${a.avg == null ? "–" : Number(a.avg).toFixed(1)}/${Number(a.max)}</div>`).join("")}
      </button>`; }).join("")).join("") || `<div class="card"><div class="empty"><p>No classes yet.</p></div></div>`}`;
}
async function instClassView(cid) {
  if (!S.inst) { app.innerHTML = `<div class="center muted">Loading…</div>`; try { await loadInstitute(); } catch (e) { return handleAuthError(e) || toast(errMsg(e)); } }
  const k = S.inst.classes.find(x => x.id === cid); if (!k) return go("inst/results");
  app.innerHTML = `${topbar(k.name, { backTo: "inst/results", eyebrow: `${deptName(k.department_id)} · ${k.teacher_name || "Teacher"}` })}
    <button class="btn block" data-act="nav" data-to="inst/month/${k.id}">Monthly attendance report</button>
    <div class="card"><h3>Tests, quizzes & exams</h3>
      ${k.assessments.length ? `<div class="list">${k.assessments.map(a => `<div class="item"><span class="grow"><span class="name">${esc(a.title)}</span><span class="sub" style="display:block">${esc(a.kind)} · ${esc(fmt(a.day, { day: "numeric", month: "short", year: "numeric" }))} · ${a.n}/${k.students.length} entered</span></span>
        <span class="num small">avg ${a.avg == null ? "–" : Number(a.avg).toFixed(1)} / ${Number(a.max)}</span></div>`).join("")}</div>` : `<p class="muted">No results entered yet.</p>`}
    </div>
    <div class="card" style="padding:4px 14px"><div class="list">${k.students.map(s => { const a = sAtt(s); const flag = (a != null && a < ATT_MIN) || (s.avg != null && s.avg < PASS_MIN);
      return `<button class="item" data-act="nav" data-to="inst/student/${s.id}"><span class="roll">${esc(s.roll || "–")}</span><span class="grow"><span class="name">${esc(s.name)}</span>
        <span class="sub" style="display:block">Attendance ${pct(a)} (${s.A} absent) · Average ${pct(s.avg)}</span></span>${flag ? `<span class="chip warn">Check</span>` : ""}<span class="chev">›</span></button>`; }).join("") || `<p class="muted" style="padding:12px 0">No students yet.</p>`}</div></div>`;
}
async function instStudentView(sid) {
  const draw = r => {
    if (curHash() !== "inst/student/" + sid) return;
    const c = r.class || {};
    app.innerHTML = `${topbar(r.name, { backTo: "inst/attendance", eyebrow: [c.department, c.name].filter(Boolean).join(" · ") })}
      <div class="muted small">${[c.subject, c.teacher && "Teacher: " + c.teacher, c.term, r.roll && "Roll no. " + r.roll].filter(Boolean).map(esc).join(" · ")}</div>
      ${reportCard(r.attendance || [], (r.grades || []).map(g => ({ ...g, m: Number(g.m), s: Number(g.s) })), { openDays: true })}
      <p class="muted small">View only. Only the class teacher can change attendance or marks.</p>`;
  };
  if (S.instStudents[sid]) draw(S.instStudents[sid]); else app.innerHTML = `<div class="center muted">Loading record…</div>`;
  try {
    const r = await API.rpc("institute_student", { p_sid: sid });
    if (!r) { toast("That student isn't in your institute."); return go("inst/overview"); }
    S.instStudents[sid] = r; draw(r);
  } catch (e) { handleAuthError(e) || toast(errMsg(e)); }
}
function instStaff() {
  const ds = S.inst.departments, inv = S.newInvite;
  const deptOptions = sel => `<option value="">No department</option>${ds.map(d => `<option value="${d.id}" ${sel === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}`;
  const classCount = uid => S.inst.classes.filter(k => k.teacher_id === uid).length;
  return `
    <div class="card"><h3>Departments</h3>
      ${ds.length ? `<div class="list">${ds.map(d => `<div class="item"><span class="grow name">${esc(d.name)}</span><span class="chip">${plural(S.inst.classes.filter(k => k.department_id === d.id).length, "class", "classes")}</span>
        ${S.confirm === "deldept-" + d.id ? `<button class="btn sm danger" data-act="del-dept" data-id="${d.id}">Delete</button><button class="btn sm" data-act="cancel">Keep</button>` : `<button class="btn sm" data-act="confirm" data-key="deldept-${d.id}" aria-label="Delete ${esc(d.name)}">✕</button>`}</div>`).join("")}</div>` : `<p class="muted small">Add departments like Science, Arts or Primary. Teachers choose one for each class.</p>`}
      <form class="row-wrap" data-form="dept"><input class="input" id="dept-name" name="name" required maxlength="60" placeholder="New department" style="flex:1 1 160px"><button class="btn" type="submit">Add</button></form>
    </div>
    <form class="card" data-form="invite"><h3>Invite a teacher or department head</h3>
      <label class="field">Their name<input class="input" id="inv-name" name="name" required maxlength="80" placeholder="Ms. Sara Ahmed"></label>
      <div class="row-wrap">
        <label class="field" style="flex:1 1 140px">Role<select class="input" name="role"><option value="teacher">Teacher</option><option value="head">Department head</option></select></label>
        <label class="field" style="flex:1 1 160px">Department<select class="input" name="department">${deptOptions("")}</select></label>
      </div>
      <button class="btn primary block" type="submit">Create invite code</button>
      ${inv ? `<div class="codebox"><div class="eyebrow">Invite for ${esc(inv.name)}</div><div class="code">${esc(inv.code)}</div>
        <div class="row-wrap"><button class="btn sm primary" data-act="share" data-text="${esc(inviteText(inv))}">Share</button><button class="btn sm" data-act="copy" data-text="${esc(inv.code)}">Copy</button></div>
        <p class="muted small">Send it only to ${esc(inv.name)}. It works once.</p></div>` : ""}
    </form>
    ${S.inst.invites.length ? `<div class="card"><h3>Invites not used yet</h3><div class="list">${S.inst.invites.map(v => `<div class="item"><span class="grow"><span class="name">${esc(v.name)}</span><span class="sub" style="display:block">${esc(ROLE_NAME[v.role])} · ${esc(deptName(v.department_id))} · <span class="num">${esc(v.code)}</span></span></span>
      <button class="btn sm" data-act="share" data-text="${esc(inviteText(v))}">Share</button>
      ${S.confirm === "delinv-" + v.code ? `<button class="btn sm danger" data-act="del-invite" data-code="${esc(v.code)}">Cancel invite</button>` : `<button class="btn sm" data-act="confirm" data-key="delinv-${esc(v.code)}" aria-label="Cancel invite">✕</button>`}</div>`).join("")}</div></div>` : ""}
    <div class="card"><h3>Staff</h3><div class="list">${S.inst.members.map(m => `<div class="item"><span class="grow"><span class="name">${esc(m.name || "Unnamed")}</span>
      <span class="sub" style="display:block">${esc(ROLE_NAME[m.role])}${m.role !== "principal" ? " · " + esc(deptName(m.department_id)) + " · " + plural(classCount(m.user_id), "class", "classes") : ""}</span></span>
      ${m.role === "principal" ? "" : S.confirm === "rm-" + m.user_id ? `<button class="btn sm danger" data-act="remove-member" data-uid="${m.user_id}">Remove</button><button class="btn sm" data-act="cancel">Keep</button>` : `<button class="btn sm" data-act="confirm" data-key="rm-${m.user_id}" aria-label="Remove">✕</button>`}</div>`).join("")}</div>
      <p class="muted small">Removing someone takes their classes out of the institute. Their classes and data are not deleted.</p></div>
    <button class="btn block" data-act="nav" data-to="institute-new">Edit institute details</button>`;
}
function inviteText(v) {
  const i = S.inst.institute;
  return `You're invited to join ${i.name} on School App as ${v.role === "head" ? "a department head" : "a teacher"}.\n\n1. Install School App and open it.\n2. Tap "I'm a teacher" and create an account (or log in).\n3. On My classes, tap "Join with an invite code".\n4. Enter this code:\n\n${v.code}`;
}

/* ---------------- monthly attendance report ---------------- */
function monthShift(ym, n) { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function monthData(students, attRows, ym) {
  const [y, m] = ym.split("-").map(Number), days = new Date(y, m, 0).getDate();
  const grid = {}; attRows.forEach(r => { if (String(r.d).slice(0, 7) === ym) (grid[r.s] = grid[r.s] || {})[Number(String(r.d).slice(8, 10))] = r.m; });
  const used = new Set(); Object.values(grid).forEach(g => Object.keys(g).forEach(d => used.add(Number(d))));
  const rows = sortSt(students).map(s => { const g = grid[s.id] || {}, t = { P: 0, L: 0, A: 0 }; Object.values(g).forEach(v => t[v]++); const n = t.P + t.L + t.A; return { s, g, t, pct: n ? (t.P + t.L) / n * 100 : null }; });
  return { y, m, days, used, rows };
}
function monthReportHtml(title, sub, data, ym, backTo, key) {
  const { y, m, days, used, rows } = data;
  const wd = d => new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "narrow" });
  const isSun = d => new Date(y, m - 1, d).getDay() === 0;
  const label = new Date(y, m - 1, 15).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const schoolDays = used.size;
  return `${topbar(title, { backTo, eyebrow: "Monthly attendance" })}
    <div class="card no-print">
      <div class="datebar"><button class="iconbtn" data-act="month" data-n="-1" aria-label="Previous month">‹</button><span class="day">${esc(label)}</span><button class="iconbtn" data-act="month" data-n="1" aria-label="Next month">›</button></div>
      <div class="row-wrap"><button class="btn primary" style="flex:1" data-act="month-csv" data-key="${esc(key)}">Save as Excel</button><button class="btn" style="flex:1" data-act="month-pdf" data-key="${esc(key)}">Save as PDF</button></div>
    </div>
    <div class="print-head"><h2>${esc(title)} — ${esc(label)}</h2><div class="muted small">${esc(sub)}</div></div>
    <div class="chips"><span class="chip info"><b>${schoolDays}</b> school days recorded</span><span class="chip"><b>${rows.length}</b> students</span></div>
    ${rows.length ? `<div class="table-scroll"><table class="register"><thead><tr><th class="sticky">Roll</th><th class="sticky2">Name</th>
      ${Array.from({ length: days }, (_, i) => i + 1).map(d => `<th class="${isSun(d) ? "sun" : ""} ${used.has(d) ? "" : "dim"}">${d}<br><small>${wd(d)}</small></th>`).join("")}
      <th>P</th><th>L</th><th>A</th><th>%</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="sticky num">${esc(r.s.roll || "–")}</td><td class="sticky2">${esc(r.s.name)}</td>
        ${Array.from({ length: days }, (_, i) => i + 1).map(d => `<td class="c ${r.g[d] || ""} ${isSun(d) ? "sun" : ""}">${r.g[d] || ""}</td>`).join("")}
        <td class="num">${r.t.P}</td><td class="num">${r.t.L}</td><td class="num">${r.t.A}</td><td class="num ${r.pct != null && r.pct < ATT_MIN ? "low" : ""}">${pct(r.pct)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card"><div class="empty"><p>No students in this class.</p></div></div>`}
    <p class="muted small no-print">P present · L late (counts as attended) · A absent. Swipe the table sideways to see every day.</p>`;
}
function monthCsv(title, data, ym) {
  const { days, rows } = data;
  const q = v => { v = String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const head = ["Roll", "Name", ...Array.from({ length: days }, (_, i) => String(i + 1)), "Present", "Late", "Absent", "Attendance %"];
  const lines = [[title + " — " + ym], head, ...rows.map(r => [r.s.roll, r.s.name, ...Array.from({ length: days }, (_, i) => r.g[i + 1] || ""), r.t.P, r.t.L, r.t.A, r.pct == null ? "" : Math.round(r.pct)])];
  return "﻿" + lines.map(l => l.map(q).join(",")).join("\r\n");
}
S.reports = {};
async function teacherMonthView(id) {
  if (!S.bundles[id]) { app.innerHTML = `<div class="center muted">Loading…</div>`; try { await loadClass(id); } catch (e) { return handleAuthError(e) || toast(errMsg(e)); } }
  const b = S.bundles[id]; if (!b) return go("classes");
  const rows = []; Object.keys(b.att).forEach(d => Object.entries(b.att[d]).forEach(([sid, mk]) => rows.push({ s: sid, d, m: mk })));
  const data = monthData(b.students, rows, S.month), key = "c-" + id;
  const title = b.info.name, sub = [b.info.subject, b.info.teacher_name && "Teacher: " + b.info.teacher_name, S.member && S.member.institute && S.member.institute.name].filter(Boolean).join(" · ");
  S.reports[key] = { title, data, ym: S.month };
  app.innerHTML = monthReportHtml(title, sub, data, S.month, `class/${id}/attendance`, key);
}
async function instMonthView(cid) {
  app.innerHTML = `${topbar("Monthly attendance", { backTo: "inst/class/" + cid })}<div class="center muted">Loading…</div>`;
  try {
    const r = await API.rpc("institute_class_month", { p_class: cid, p_month: S.month + "-01" });
    if (!r) { toast("That class isn't in your institute."); return go("inst/results"); }
    if (curHash() !== "inst/month/" + cid) return;
    const data = monthData(r.students, r.attendance, S.month), key = "i-" + cid;
    const sub = [r.class.subject, r.class.teacher_name && "Teacher: " + r.class.teacher_name, S.inst && S.inst.institute.name].filter(Boolean).join(" · ");
    S.reports[key] = { title: r.class.name, data, ym: S.month };
    app.innerHTML = monthReportHtml(r.class.name, sub, data, S.month, "inst/class/" + cid, key);
  } catch (e) { handleAuthError(e) || toast(errMsg(e)); }
}

/* ---------------- app updates ---------------- */
window.SR_updateAvailable = function (info) {
  const el = document.getElementById("update"); if (!el || !info || !info.apk) return;
  el.innerHTML = `<span><b>New version ${esc(info.versionName || "")} is ready.</b> Your data and login stay the same.</span><button class="btn sm primary" id="update-btn">Update</button>`;
  el.hidden = false;
  document.getElementById("update-btn").onclick = () => { openExternal(info.apk); toast("Downloading… then tap the file and choose Update"); };
};

function handleAuthError(e) {
  if (e && (e.status === 401 || e.code === "no_session")) { toast("Please log in again."); go("teacher"); return true; }
  return false;
}

/* ---------------- actions ---------------- */
function redraw() {
  const h = curHash(), p = h.split("/");
  if (p[0] === "inst" && !p[1] || (p[0] === "inst" && ["overview", "attendance", "results", "staff"].includes(p[1]))) drawInst(p[1] || "overview");
  else if (p[0] === "class" && p[2] === "month") teacherMonthView(p[1]);
  else if (p[0] === "class" && p[2] === "student") drawStudent(p[1], p[3]);
  else if (p[0] === "class") drawClass(p[1], p[2] || "attendance");
  else route();
}

app.addEventListener("click", async e => {
  const t = e.target.closest("[data-act]"); if (!t) return;
  const d = t.dataset, act = d.act;
  if (act === "nav") { S.error = ""; if (d.replace) location.replace("#" + d.to); else go(d.to); }
  else if (act === "back") back(d.to);
  else if (act === "confirm") { S.confirm = d.key; redraw(); }
  else if (act === "cancel") { S.confirm = null; redraw(); }
  else if (act === "day") { S.date = shift(S.date, Number(d.n)); redraw(); }
  else if (act === "pick-date") { const i = document.getElementById("pick-date"); if (i) { try { i.showPicker(); } catch { i.click(); } } }
  else if (act === "mark") setMark(d.id, d.sid, d.m);
  else if (act === "all-present") allPresent(d.id);
  else if (act === "pick-assess") { S.selAssess[d.id] = d.aid; S.confirm = null; redraw(); }
  else if (act === "delete-assess") {
    S.confirm = null; const b = S.bundles[d.id];
    b.assess = b.assess.filter(a => a.id !== d.aid); redraw();
    track(API.remove("assessments", `id=eq.${d.aid}`)).then(() => toast("Deleted"), err => { toast(errMsg(err)); loadClass(d.id).then(redraw); });
  }
  else if (act === "share") share(d.text);
  else if (act === "copy") copy(d.text);
  else if (act === "reset-code") {
    S.confirm = null;
    try {
      const code = await track(API.rpc("reset_code", { sid: d.sid, which: d.which }));
      const s = S.bundles[d.id].students.find(x => x.id === d.sid);
      if (s) s[d.which === "parent" ? "parent_code" : "student_code"] = code;
      toast("New code made. The old one no longer works."); redraw();
    } catch (err) { toast(errMsg(err)); }
  }
  else if (act === "edit-student") { S.editStudent = d.sid || null; redraw(); }
  else if (act === "remove-student") {
    try { await track(API.remove("students", `id=eq.${d.sid}`)); const b = S.bundles[d.id]; b.students = b.students.filter(s => s.id !== d.sid); toast("Student removed"); go(`class/${d.id}/students`); }
    catch (err) { toast(errMsg(err)); }
  }
  else if (act === "delete-class") {
    try { await track(API.remove("classes", `id=eq.${d.id}`)); delete S.bundles[d.id]; S.classes = null; toast("Class deleted"); go("classes"); }
    catch (err) { toast(errMsg(err)); }
  }
  else if (act === "logout") {
    if (S.confirm !== "logout") { S.confirm = "logout"; return route(); }
    S.confirm = null; await API.signOut(); S.bundles = {}; S.classes = null; S.member = undefined; S.inst = null; S.instStudents = {}; swap("");
  }
  else if (act === "logout-code") { S.code = null; S.report = null; LS.set("sr_code", null); swap(""); }
  else if (act === "refresh-report") { reportView(true); }
  else if (act === "reset-again") { S.resetEmail = null; S.error = ""; forgotView(); }
  else if (act === "notify") notifyParent(d.id, d.sid, d.via);
  else if (act === "add-phone") { S.editStudent = d.sid; go(`class/${d.id}/student/${d.sid}`); }
  else if (act === "month") { S.month = monthShift(S.month, Number(d.n)); route(); }
  else if (act === "month-csv") { const r = S.reports[d.key]; if (r) saveFile(`${r.title.replace(/[^\w\- ]+/g, "").trim() || "class"} attendance ${r.ym}.csv`, "text/csv", monthCsv(r.title, r.data, r.ym)); }
  else if (act === "month-pdf") { const r = S.reports[d.key]; printPage(r ? `${r.title} attendance ${r.ym}` : "Attendance"); }
  else if (act === "inst-refresh") { S.instStudents = {}; instView(curHash().split("/")[1] || "overview"); }
  else if (act === "inst-day") { S.instDate = shift(S.instDate, Number(d.n)); loadDay(); }
  else if (act === "pick-inst-date") { const i = document.getElementById("inst-date"); if (i) { try { i.showPicker(); } catch { i.click(); } } }
  else if (act === "inst-filter") { S.instFilter = d.f; redraw(); }
  else if (act === "del-dept") { S.confirm = null; instAction(API.rpc("delete_department", { p_id: d.id }), "Department deleted"); }
  else if (act === "del-invite") { S.confirm = null; instAction(API.rpc("delete_invite", { p_code: d.code }), "Invite cancelled"); }
  else if (act === "remove-member") { S.confirm = null; instAction(API.rpc("remove_member", { p_user: d.uid }), "Removed from the institute"); }
});

app.addEventListener("change", e => {
  if (e.target.id === "pick-date" && e.target.value) { S.date = e.target.value; redraw(); }
  if (e.target.id === "inst-date" && e.target.value) { S.instDate = e.target.value; loadDay(); }
  if (e.target.id === "inst-dept") { S.instDept = e.target.value; redraw(); }
});

const timers = {};
app.addEventListener("input", e => {
  const t = e.target; if (!t.dataset.score) return;
  const { id, aid, sid } = t.dataset, b = S.bundles[id];
  const a = b && b.assess.find(x => x.id === aid); if (!a) return;
  const raw = t.value.trim(), v = raw === "" ? null : Number(raw);
  if (v != null && (isNaN(v) || v < 0)) return;
  if (v != null && v > Number(a.max_marks)) { toast(`Score can't be more than ${Number(a.max_marks)}.`); return; }
  const apply = bb => { const m = (bb.scores[aid] = bb.scores[aid] || {}); if (v == null) delete m[sid]; else m[sid] = v; };
  apply(b);
  const key = aid + "/" + sid;
  (b.unsaved = b.unsaved || {})[key] = apply;
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => {
    const p = v == null ? API.remove("scores", `assessment_id=eq.${aid}&student_id=eq.${sid}`)
                        : API.upsert("scores", { assessment_id: aid, student_id: sid, class_id: id, score: v }, "assessment_id,student_id");
    track(p).then(() => { if (b.unsaved && b.unsaved[key] === apply) delete b.unsaved[key]; }, err => { toast(errMsg(err)); });
  }, 700);
});

// After leaving a score box, refresh the average/highest/lowest chips.
app.addEventListener("focusout", e => {
  if (!e.target.dataset || !e.target.dataset.score) return;
  setTimeout(() => { const a = document.activeElement; if (!(a && a.dataset && a.dataset.score)) redraw(); }, 50);
});

app.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target, kind = f.dataset.form, v = Object.fromEntries(new FormData(f).entries());
  const btn = f.querySelector("[type=submit]"); if (btn) btn.disabled = true;
  S.error = "";
  try {
    if (kind === "setup") {
      const url = v.url.trim();
      if (!/^https:\/\/.+/.test(url)) throw new Error("The server address should start with https://");
      API.saveServer(url, v.key);
      go("");
    } else if (kind === "login") {
      await API.signIn(v.email.trim(), v.password); S.member = undefined; swap("classes");
    } else if (kind === "signup") {
      const r = await API.signUp(v.email.trim(), v.password, v.name.trim());
      if (r.signedIn) { S.member = undefined; swap("classes"); }
      else { S.error = ""; app.innerHTML = `${topbar("Check your email", { backTo: "teacher" })}<div class="card"><p>We sent a link to <b>${esc(v.email)}</b>. Open it to confirm your account, then come back and log in.</p><button class="btn primary" data-act="nav" data-to="teacher">Go to log in</button></div>`; }
    } else if (kind === "forgot") {
      await API.resetPassword(v.email.trim()); S.resetEmail = v.email.trim(); toast("Email sent. Check your inbox."); forgotView();
    } else if (kind === "reset") {
      await API.finishReset(S.resetEmail, v.code.trim(), v.password); S.resetEmail = null; toast("Password changed"); swap("classes");
    } else if (kind === "code") {
      const code = v.code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (code.length !== 10) throw new Error("Codes have 10 letters and numbers, like ABCDE-23456.");
      S.code = code; const ok = await fetchReport();
      if (!ok) throw new Error("That code didn't work. Check it with your teacher.");
      LS.set("sr_code", code); swap("report");
    } else if (kind === "class") {
      const row = { name: v.name.trim(), subject: v.subject.trim(), term: v.term.trim(), teacher_name: v.teacher_name.trim() };
      if (S.member) { row.institute_id = S.member.institute.id; if ("department_id" in v) row.department_id = v.department_id || null; }
      if (f.dataset.id) { await track(API.update("classes", `id=eq.${f.dataset.id}`, row)); S.bundles[f.dataset.id].info = { ...S.bundles[f.dataset.id].info, ...row }; toast("Saved"); go(`class/${f.dataset.id}/attendance`); }
      else { const c = await track(API.insert("classes", row)); S.classes = null; swap(`class/${c.id}/students`); }
    } else if (kind === "student") {
      const id = f.dataset.id, b = S.bundles[id], roll = v.roll.trim();
      if (roll && b.students.some(s => s.roll === roll)) throw new Error(`Roll no. ${roll} is already used in this class.`);
      const s = await track(API.insert("students", { class_id: id, name: v.name.trim(), roll, parent_phone: (v.phone || "").trim() }));
      b.students.push(s); toast(`Added ${s.name}`); redraw();
      const r = document.getElementById("new-roll"); if (r) { r.value = roll && !isNaN(roll) ? String(Number(roll) + 1) : ""; }
      const ph = document.getElementById("new-phone"); if (ph) ph.value = "";
      const n = document.getElementById("new-name"); if (n) n.focus();
      return;
    } else if (kind === "edit-student") {
      const { id, sid } = f.dataset, b = S.bundles[id], roll = v.roll.trim();
      if (roll && b.students.some(s => s.roll === roll && s.id !== sid)) throw new Error(`Roll no. ${roll} is already used in this class.`);
      const s = await track(API.update("students", `id=eq.${sid}`, { name: v.name.trim(), roll, parent_phone: (v.phone || "").trim() }));
      const i = b.students.findIndex(x => x.id === sid); if (i >= 0 && s) b.students[i] = s;
      S.editStudent = null; toast("Saved"); redraw();
    } else if (kind === "institute") {
      if (S.inst && S.member && S.member.role === "principal" && S.inst.institute) {
        await track(API.rpc("update_institute", { p_name: v.name.trim(), p_kind: v.kind, p_city: v.city.trim() }));
        toast("Saved"); await loadInstitute(); go("inst/staff");
      } else {
        await track(API.rpc("create_institute", { p_name: v.name.trim(), p_kind: v.kind, p_city: v.city.trim(), p_my_name: v.my_name.trim() }));
        await loadMembership(); toast("Institute created. Now add departments and invite teachers."); swap("inst/staff");
      }
    } else if (kind === "join") {
      const code = v.code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (code.length !== 10) throw new Error("Invite codes have 10 letters and numbers, like ABCDE-23456.");
      const r = await track(API.rpc("join_institute", { p_code: code, p_my_name: v.my_name.trim() }));
      await loadMembership(); S.classes = null; toast(`You joined ${r && r.institute ? r.institute : "the institute"}`); swap("classes");
    } else if (kind === "dept") {
      await track(API.rpc("add_department", { p_name: v.name.trim() })); toast(`Added ${v.name.trim()}`); await loadInstitute(); redraw();
      const n = document.getElementById("dept-name"); if (n) { n.value = ""; n.focus(); }
    } else if (kind === "invite") {
      const code = await track(API.rpc("create_invite", { p_name: v.name.trim(), p_role: v.role, p_department: v.department || null }));
      S.newInvite = { code, name: v.name.trim(), role: v.role }; await loadInstitute(); redraw();
      const n = document.getElementById("inv-name"); if (n) n.value = "";
    } else if (kind === "assess") {
      const id = f.dataset.id;
      const a = await track(API.insert("assessments", { class_id: id, title: v.title.trim(), kind: v.kind || "Test", max_marks: Number(v.max), day: v.day }));
      const b = S.bundles[id]; b.assess = [a, ...b.assess].sort((x, y) => String(y.day).localeCompare(x.day));
      S.selAssess[id] = a.id; toast(`Added ${a.title}`); redraw();
    }
  } catch (err) {
    if (handleAuthError(err)) return;
    if (["setup", "login", "signup", "forgot", "reset", "code", "class", "institute", "join"].includes(kind)) { S.error = errMsg(err); route(); }
    else toast(errMsg(err));
  } finally { if (btn && btn.isConnected) btn.disabled = false; }
});

function notifyParent(id, sid, via) {
  const b = S.bundles[id], s = b && b.students.find(x => x.id === sid); if (!s) return;
  const day = S.date, text = absentMessage(s, b, day), num = waNumber(s.parent_phone);
  if (!num) { toast("Add the parent's number first."); return; }
  openExternal(via === "sms" ? `sms:${s.parent_phone.replace(/[^\d+]/g, "")}?body=${encodeURIComponent(text)}` : `https://wa.me/${num}?text=${encodeURIComponent(text)}`);
  (b.notified[day] = b.notified[day] || {})[sid] = true; redraw();
  track(API.update("attendance", `student_id=eq.${sid}&day=eq.${day}`, { notified_at: new Date().toISOString() })).catch(() => {});
}
async function loadDay() {
  redraw();
  try { S.instDay = (await API.rpc("institute_day", { p_day: S.instDate })) || {}; redraw(); } catch (e) { toast(errMsg(e)); }
}
async function instAction(p, msg) {
  try { await track(p); toast(msg); await loadInstitute(); redraw(); } catch (e) { toast(errMsg(e)); redraw(); }
}
function setMark(id, sid, m) {
  const b = S.bundles[id], day = S.date;
  const cur = (b.att[day] = b.att[day] || {});
  const prev = cur[sid], next = prev === m ? null : m;
  const apply = bb => { const x = (bb.att[day] = bb.att[day] || {}); if (next) x[sid] = next; else delete x[sid]; };
  apply(b);
  const key = "att/" + day + "/" + sid;
  (b.unsaved = b.unsaved || {})[key] = apply;
  redraw();
  const p = next ? API.upsert("attendance", { student_id: sid, class_id: id, day, mark: next }, "student_id,day")
                 : API.remove("attendance", `student_id=eq.${sid}&day=eq.${day}`);
  track(p).then(() => { const bb = S.bundles[id] || b; if (bb.unsaved && bb.unsaved[key] === apply) delete bb.unsaved[key]; redraw(); },
    err => { const bb = S.bundles[id] || b; if (bb.unsaved) delete bb.unsaved[key]; const x = (bb.att[day] = bb.att[day] || {}); if (prev) x[sid] = prev; else delete x[sid]; toast(errMsg(err)); redraw(); });
}
function allPresent(id) {
  const b = S.bundles[id], day = S.date, cur = (b.att[day] = b.att[day] || {});
  const rows = b.students.filter(s => !cur[s.id]).map(s => ({ student_id: s.id, class_id: id, day, mark: "P" }));
  if (!rows.length) return;
  // Keep these marks on screen even if a background refresh lands before the save finishes.
  const apply = bb => { const x = (bb.att[day] = bb.att[day] || {}); rows.forEach(r => { if (!x[r.student_id]) x[r.student_id] = "P"; }); };
  const key = "allp/" + day + "/" + Date.now();
  apply(b); (b.unsaved = b.unsaved || {})[key] = apply; redraw();
  track(API.upsert("attendance", rows, "student_id,day")).then(() => { const bb = S.bundles[id]; if (bb && bb.unsaved) delete bb.unsaved[key]; toast(`${rows.length} marked present`); redraw(); },
    err => { const bb = S.bundles[id] || b; if (bb.unsaved) delete bb.unsaved[key]; const x = bb.att[day] || {}; rows.forEach(r => { if (x[r.student_id] === "P") delete x[r.student_id]; }); toast(errMsg(err)); redraw(); });
}

/* ---------------- automatic updates ---------------- */
async function autoRefresh() {
  if (document.visibilityState !== "visible" || S.pending) return;
  const a = document.activeElement;
  if (a && (a.tagName === "INPUT" || a.tagName === "SELECT")) return;
  const p = curHash().split("/");
  try {
    if (p[0] === "report" && S.code) { if (await fetchReport()) drawReport(); }
    else if (p[0] === "class" && p[1] && API.signedIn && !S.confirm && !S.editStudent) { await loadClass(p[1]); if (curHash().split("/")[1] === p[1]) redraw(); }
    else if (p[0] === "inst" && API.signedIn && !S.confirm && !/^(student|class)$/.test(p[1] || "")) { await loadInstitute(); if (curHash().split("/")[0] === "inst") redraw(); }
    else if (p[0] === "classes" && API.signedIn) { await loadClasses(); if (curHash() === "classes") route(); }
  } catch { /* try again next time */ }
}
setInterval(autoRefresh, 30000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") autoRefresh(); });
window.SR_onResume = autoRefresh;
window.SR_back = function () {
  if (S.confirm) { S.confirm = null; redraw(); return true; }
  const b = app.querySelector('[data-act="back"]');
  if (b) { b.click(); return true; }
  return false; // first screen (My classes, a student's record, or the welcome screen): let the app close
}; // called by the Android app when it comes back to the front

route();
})();
