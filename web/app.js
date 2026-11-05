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
  date: today(), selAssess: {}, confirm: null, error: "", pending: 0, editStudent: null
};

/* ---------------- helpers ---------------- */
function today(d = new Date()) { const z = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
function shift(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return today(d); }
function fmt(iso, o = { weekday: "short", day: "numeric", month: "short" }) { return new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, o); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function pct(n) { return n == null || isNaN(n) ? "–" : Math.round(n) + "%"; }
let tt; function toast(m) { toastEl.textContent = m; toastEl.hidden = false; clearTimeout(tt); tt = setTimeout(() => toastEl.hidden = true, 2800); }
function go(h) { if (location.hash === "#" + h) route(); else location.hash = h; }
function back(fallback) { if (history.length > 1 && S.navDepth > 0) history.back(); else go(fallback); }
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
    .map(a => ({ t: a.title, d: a.day, m: Number(a.max_marks), s: Number(b.scores[a.id][sid]) }));
  return { att, grades };
}

/* ---------------- data ---------------- */
async function loadClasses() {
  S.classes = await API.select("classes", "select=id,name,subject,term,teacher_name,students(count)&order=created_at.asc");
}
async function loadClass(id) {
  const q = `class_id=eq.${id}`;
  const [info, students, att, assess, scores] = await Promise.all([
    API.select("classes", `id=eq.${id}&select=*`),
    API.select("students", `${q}&select=*`),
    API.select("attendance", `${q}&select=student_id,day,mark`),
    API.select("assessments", `${q}&select=*&order=day.desc`),
    API.select("scores", `${q}&select=assessment_id,student_id,score`)
  ]);
  if (!info.length) { delete S.bundles[id]; return null; }
  const b = { info: info[0], students, att: {}, assess, scores: {}, at: Date.now() };
  att.forEach(r => { (b.att[r.day] = b.att[r.day] || {})[r.student_id] = r.mark; });
  scores.forEach(r => { (b.scores[r.assessment_id] = b.scores[r.assessment_id] || {})[r.student_id] = Number(r.score); });
  // Keep edits that are still being saved.
  const old = S.bundles[id];
  if (old && old.unsaved) { Object.entries(old.unsaved).forEach(([k, fn]) => fn(b)); b.unsaved = old.unsaved; }
  S.bundles[id] = b;
  return b;
}
function track(p) { S.pending++; return p.finally(() => { S.pending--; }); }

/* ---------------- router ---------------- */
S.navDepth = 0;
window.addEventListener("hashchange", () => { S.navDepth++; S.confirm = null; S.error = ""; route(); });

async function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/");
  if (!API.config()) return setupView();
  if (h === "" ) {
    if (API.signedIn) return go("classes");
    if (S.code) return go("report");
    return welcomeView();
  }
  if (h === "setup") return setupView();
  if (h === "teacher") return loginView();
  if (h === "signup") return signupView();
  if (h === "forgot") return forgotView();
  if (h === "code") return codeView();
  if (h === "report") return reportView();
  if (!API.signedIn) return go("teacher");
  if (h === "classes") return classesView();
  if (h === "new-class") return classFormView(null);
  if (parts[0] === "class" && parts[1]) {
    const id = parts[1];
    if (parts[2] === "student" && parts[3]) return studentView(id, parts[3]);
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
    <div class="muted small">${[c.name, c.subject, c.teacher && "Teacher: " + c.teacher, c.term, r.roll && "Roll no. " + r.roll].filter(Boolean).map(esc).join(" · ")}</div>
    ${reportCard(r.attendance || [], (r.grades || []).map(g => ({ ...g, m: Number(g.m), s: Number(g.s) })))}
    <div class="sync">Updated ${esc(S.reportAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))} · refreshes by itself</div>
    <button class="btn" data-act="logout-code">Log out</button>`;
}

function reportCard(att, grades) {
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
    <div class="card"><h3>Marks</h3>
      ${grades.length ? `<div>${[...grades].reverse().map(x => `<div class="grade"><div><div class="name">${esc(x.t)}</div><div class="muted small">${esc(fmt(x.d, { day: "numeric", month: "short", year: "numeric" }))}</div></div><span class="num">${x.s} / ${x.m}</span><div class="pbar"><i style="width:${x.m ? Math.min(100, x.s / x.m * 100) : 0}%"></i></div></div>`).join("")}</div>` : `<p class="muted">No marks entered yet.</p>`}
    </div>`;
}

/* ---------------- teacher: classes ---------------- */
async function classesView() {
  const draw = () => {
    const list = S.classes || [];
    app.innerHTML = `
      ${topbar("My classes", { eyebrow: API.user && API.user.name ? API.user.name : "Teacher", right: `<button class="iconbtn" data-act="logout" aria-label="Log out" title="Log out">⎋</button>` })}
      ${S.classes == null ? `<div class="center muted">Loading classes…</div>` : list.length ? `<div class="card" style="padding:4px 16px"><div class="list">
        ${list.map(c => `<button class="item" data-act="nav" data-to="class/${c.id}/attendance"><span class="grow"><span class="name">${esc(c.name)}</span><span class="sub" style="display:block">${[c.subject, c.term].filter(Boolean).map(esc).join(" · ") || "&nbsp;"}</span></span><span class="chip">${(c.students && c.students[0] && c.students[0].count) || 0} students</span><span class="chev">›</span></button>`).join("")}
      </div></div>` : `<div class="card"><div class="empty"><h3>No classes yet</h3><p>Create your first class, then add your students.</p></div></div>`}
      <button class="btn primary block" data-act="nav" data-to="new-class">+ New class</button>`;
  };
  draw();
  try { await loadClasses(); if (curHash() === "classes") draw(); } catch (e) { handleAuthError(e) || toast(errMsg(e)); }
}

function classFormView(b) {
  const i = b ? b.info : { name: "", subject: "", term: "", teacher_name: (API.user && API.user.name) || "" };
  app.innerHTML = `${topbar(b ? "Class settings" : "New class", { backTo: b ? `class/${i.id}/attendance` : "classes" })}
    <form class="card" data-form="class" data-id="${b ? i.id : ""}">
      <label class="field">Class name<input class="input" name="name" required maxlength="80" placeholder="Grade 8 · Section B" value="${esc(i.name)}"></label>
      <label class="field">Subject<input class="input" name="subject" maxlength="60" placeholder="Mathematics" value="${esc(i.subject)}"></label>
      <label class="field">Term<input class="input" name="term" maxlength="40" placeholder="Term 2, 2026" value="${esc(i.term)}"></label>
      <label class="field">Teacher name (shown to students and parents)<input class="input" name="teacher_name" maxlength="60" value="${esc(i.teacher_name)}"></label>
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
    <p class="muted small">Tap P, L or A. Tap again to clear. Saves straight away.</p>`;
}

function marksTab(id, b) {
  if (!b.students.length) return noStudents(id);
  let aid = S.selAssess[id];
  if (!b.assess.find(a => a.id === aid)) aid = S.selAssess[id] = b.assess[0] && b.assess[0].id;
  const a = b.assess.find(x => x.id === aid);
  const form = `<form class="card" data-form="assess" data-id="${id}">
      <h3>New test or assignment</h3>
      <label class="field">Name<input class="input" name="title" required maxlength="60" placeholder="Unit 3 test"></label>
      <div class="row-wrap" style="align-items:end">
        <label class="field" style="flex:1 1 120px">Out of<input class="input" name="max" type="number" min="1" max="1000" step="any" value="20" required></label>
        <label class="field" style="flex:1 1 150px">Date<input class="input" name="day" type="date" value="${today()}" required></label>
      </div>
      <button class="btn primary block" type="submit">Add</button>
    </form>`;
  if (!a) return `<div class="card"><div class="empty"><h3>No marks yet</h3><p>Add a test, quiz or homework below, then type each student's score.</p></div></div>${form}`;
  const list = sortSt(b.students), sc = b.scores[a.id] || {};
  const vals = list.map(s => sc[s.id]).filter(v => v != null);
  const mean = vals.length ? vals.reduce((t, v) => t + v, 0) / vals.length : null;
  return `
    <div class="assess-strip">${b.assess.map(x => `<button class="assess ${x.id === a.id ? "on" : ""}" data-act="pick-assess" data-id="${id}" data-aid="${x.id}">${esc(x.title)}<small>${esc(fmt(x.day, { day: "numeric", month: "short" }))} · /${Number(x.max_marks)}</small></button>`).join("")}</div>
    <div class="card">
      <div class="between"><div><h3>${esc(a.title)}</h3><div class="muted small">${esc(fmt(a.day, { weekday: "long", day: "numeric", month: "long" }))} · out of <span class="num">${Number(a.max_marks)}</span></div></div>
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
          <div class="row-wrap"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="edit-student" data-sid="">Cancel</button></div>
        </form>` : `<div class="row-wrap"><button class="btn" data-act="edit-student" data-sid="${sid}">Edit name or roll no.</button>
        ${S.confirm === "rm-" + sid ? `<button class="btn danger" data-act="remove-student" data-id="${id}" data-sid="${sid}">Remove for good</button><button class="btn" data-act="cancel">Keep</button>` : `<button class="btn danger" data-act="confirm" data-key="rm-${sid}">Remove student</button>`}</div>`}
    </div>`;
}

function handleAuthError(e) {
  if (e && (e.status === 401 || e.code === "no_session")) { toast("Please log in again."); go("teacher"); return true; }
  return false;
}

/* ---------------- actions ---------------- */
function redraw() {
  const h = curHash(), p = h.split("/");
  if (p[0] === "class" && p[2] === "student") drawStudent(p[1], p[3]);
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
  else if (act === "logout") { await API.signOut(); S.bundles = {}; S.classes = null; go(""); }
  else if (act === "logout-code") { S.code = null; S.report = null; LS.set("sr_code", null); go(""); }
  else if (act === "refresh-report") { reportView(true); }
  else if (act === "reset-again") { S.resetEmail = null; S.error = ""; forgotView(); }
});

app.addEventListener("change", e => {
  if (e.target.id === "pick-date" && e.target.value) { S.date = e.target.value; redraw(); }
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
      await API.signIn(v.email.trim(), v.password); go("classes");
    } else if (kind === "signup") {
      const r = await API.signUp(v.email.trim(), v.password, v.name.trim());
      if (r.signedIn) go("classes");
      else { S.error = ""; app.innerHTML = `${topbar("Check your email", { backTo: "teacher" })}<div class="card"><p>We sent a link to <b>${esc(v.email)}</b>. Open it to confirm your account, then come back and log in.</p><button class="btn primary" data-act="nav" data-to="teacher">Go to log in</button></div>`; }
    } else if (kind === "forgot") {
      await API.resetPassword(v.email.trim()); S.resetEmail = v.email.trim(); toast("Email sent. Check your inbox."); forgotView();
    } else if (kind === "reset") {
      await API.finishReset(S.resetEmail, v.code.trim(), v.password); S.resetEmail = null; toast("Password changed"); go("classes");
    } else if (kind === "code") {
      const code = v.code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (code.length !== 10) throw new Error("Codes have 10 letters and numbers, like ABCDE-23456.");
      S.code = code; const ok = await fetchReport();
      if (!ok) throw new Error("That code didn't work. Check it with your teacher.");
      LS.set("sr_code", code); go("report");
    } else if (kind === "class") {
      const row = { name: v.name.trim(), subject: v.subject.trim(), term: v.term.trim(), teacher_name: v.teacher_name.trim() };
      if (f.dataset.id) { await track(API.update("classes", `id=eq.${f.dataset.id}`, row)); S.bundles[f.dataset.id].info = { ...S.bundles[f.dataset.id].info, ...row }; toast("Saved"); go(`class/${f.dataset.id}/attendance`); }
      else { const c = await track(API.insert("classes", row)); S.classes = null; go(`class/${c.id}/students`); }
    } else if (kind === "student") {
      const id = f.dataset.id, b = S.bundles[id], roll = v.roll.trim();
      if (roll && b.students.some(s => s.roll === roll)) throw new Error(`Roll no. ${roll} is already used in this class.`);
      const s = await track(API.insert("students", { class_id: id, name: v.name.trim(), roll }));
      b.students.push(s); toast(`Added ${s.name}`); redraw();
      const r = document.getElementById("new-roll"); if (r) { r.value = roll && !isNaN(roll) ? String(Number(roll) + 1) : ""; }
      const n = document.getElementById("new-name"); if (n) n.focus();
      return;
    } else if (kind === "edit-student") {
      const { id, sid } = f.dataset, b = S.bundles[id], roll = v.roll.trim();
      if (roll && b.students.some(s => s.roll === roll && s.id !== sid)) throw new Error(`Roll no. ${roll} is already used in this class.`);
      const s = await track(API.update("students", `id=eq.${sid}`, { name: v.name.trim(), roll }));
      const i = b.students.findIndex(x => x.id === sid); if (i >= 0 && s) b.students[i] = s;
      S.editStudent = null; toast("Saved"); redraw();
    } else if (kind === "assess") {
      const id = f.dataset.id;
      const a = await track(API.insert("assessments", { class_id: id, title: v.title.trim(), max_marks: Number(v.max), day: v.day }));
      const b = S.bundles[id]; b.assess = [a, ...b.assess].sort((x, y) => String(y.day).localeCompare(x.day));
      S.selAssess[id] = a.id; toast(`Added ${a.title}`); redraw();
    }
  } catch (err) {
    if (handleAuthError(err)) return;
    if (["setup", "login", "signup", "forgot", "reset", "code", "class"].includes(kind)) { S.error = errMsg(err); route(); }
    else toast(errMsg(err));
  } finally { if (btn && btn.isConnected) btn.disabled = false; }
});

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
  track(p).then(() => { if (b.unsaved[key] === apply) delete b.unsaved[key]; redraw(); },
    err => { delete b.unsaved[key]; const x = b.att[day]; if (prev) x[sid] = prev; else delete x[sid]; toast(errMsg(err)); redraw(); });
}
function allPresent(id) {
  const b = S.bundles[id], day = S.date, cur = (b.att[day] = b.att[day] || {});
  const rows = b.students.filter(s => !cur[s.id]).map(s => ({ student_id: s.id, class_id: id, day, mark: "P" }));
  if (!rows.length) return;
  rows.forEach(r => cur[r.student_id] = "P"); redraw();
  track(API.upsert("attendance", rows, "student_id,day")).then(() => { toast(`${rows.length} marked present`); redraw(); },
    err => { rows.forEach(r => { if (cur[r.student_id] === "P") delete cur[r.student_id]; }); toast(errMsg(err)); redraw(); });
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
    else if (p[0] === "classes" && API.signedIn) { await loadClasses(); if (curHash() === "classes") route(); }
  } catch { /* try again next time */ }
}
setInterval(autoRefresh, 30000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") autoRefresh(); });
window.SR_onResume = autoRefresh; // called by the Android app when it comes back to the front

route();
})();
