// ── Constants ────────────────────────────────────────────────────────────────
const CURATED_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', 
  '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#64748b'
];

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  subjects: [],
  sessions: [],
  weeklyStats: { by_subject: [], by_day: [] },
  activeSession: null,      // { id, subject_id, start_time }
  timerInterval: null,
  elapsedSeconds: 0,
  selectedSubjectId: null,
  selectedSessionId: null,
  selectedColor: CURATED_COLORS[0],
  theme: 'light',
};

// ── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Utility ───────────────────────────────────────────────────────────────────
function formatDuration(seconds) {
  if (!seconds || seconds < 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDurationTimer(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(Math.floor(seconds % 60)).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatDateTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function formatDate(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function dayAbbrev(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString([], { weekday: "short" });
}

async function apiFetch(url, options = {}) {
  const resp = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

function showToast(message, type = "info") {
  const container = $("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const icons = { success: "✅", error: "❌", info: "ℹ️" };
  toast.innerHTML = `<span>${icons[type] || ""}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// ── Load everything ───────────────────────────────────────────────────────────
async function loadAll(showSpinner = false) {
  const btn = $("btn-refresh");
  if (showSpinner) btn.classList.add("loading");
  try {
    await Promise.all([loadSubjects(), loadSessions(), loadWeeklyStats()]);
    renderSubjectSelect();
  } finally {
    if (showSpinner) btn.classList.remove("loading");
  }
}

// ── Subjects ──────────────────────────────────────────────────────────────────
async function loadSubjects() {
  state.subjects = await apiFetch("/api/subjects");
  renderSubjects();
}

function renderSubjects() {
  const list = $("subjects-list");
  const heroList = $("hero-subjects");

  if (!state.subjects.length) {
    const emptyMsg = `<div class="empty-state">No subjects yet.<br>Add one above!</div>`;
    list.innerHTML = emptyMsg;
    if (heroList) heroList.innerHTML = emptyMsg;
    return;
  }

  // Main Management List (Dashboard)
  list.innerHTML = state.subjects.map(sub => {
    const totalSecs = state.sessions
      .filter(s => s.subject_id === sub.id)
      .reduce((a, s) => a + (s.duration_seconds || 0), 0);
    const active = sub.id === state.selectedSubjectId ? "active" : "";
    return `
      <div class="subject-item ${active}" data-id="${sub.id}" onclick="selectSubject(${sub.id})">
        <span class="subject-dot" style="background:${sub.color}"></span>
        <span class="subject-name">${escHtml(sub.name)}</span>
        <span class="subject-stats">${formatDuration(totalSecs)}</span>
        <button class="btn btn-danger subject-delete" title="Delete subject"
          onclick="deleteSubject(event, ${sub.id})">✕</button>
      </div>`;
  }).join("");

  // Quick Selector List (Hero)
  if (heroList) {
    heroList.innerHTML = state.subjects.map(sub => {
      const active = sub.id === state.selectedSubjectId ? "active" : "";
      return `
        <div class="hero-subject-item ${active}" data-id="${sub.id}" onclick="selectSubject(${sub.id})">
          <span class="subject-dot" style="background:${sub.color}"></span>
          <span class="subject-name">${escHtml(sub.name)}</span>
        </div>`;
    }).join("");
  }
}

function selectSubject(id) {
  if (state.activeSession) return; // can't change during session
  state.selectedSubjectId = id;
  const sub = state.subjects.find(s => s.id === id);
  if (sub) {
    $("timer-badge-text").textContent = sub.name;
    $("timer-badge-dot").style.background = sub.color;
  }
  renderSubjects();
}

function renderColorPalette() {
  const palette = $("color-palette");
  if (!palette) return;

  palette.innerHTML = CURATED_COLORS.map(color => `
    <div 
      class="color-option ${color === state.selectedColor ? 'selected' : ''}" 
      style="background:${color}" 
      onclick="selectColor('${color}')"
    ></div>
  `).join("");
}

function selectColor(color) {
  state.selectedColor = color;
  renderColorPalette();
}

async function addSubject() {
  const nameInput = $("subject-name");
  const name = nameInput.value.trim();
  if (!name) { showToast("Enter a subject name", "error"); return; }
  try {
    const sub = await apiFetch("/api/subjects", {
      method: "POST",
      body: JSON.stringify({ name, color: state.selectedColor }),
    });
    state.subjects.push(sub);
    nameInput.value = "";
    selectSubject(sub.id);
    renderSubjects();
    showToast(`Subject "${name}" added!`, "success");
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function deleteSubject(e, id) {
  e.stopPropagation();
  const sub = state.subjects.find(s => s.id === id);
  if (!confirm(`Delete "${sub?.name}"? All sessions will be removed.`)) return;
  try {
    await apiFetch(`/api/subjects/${id}`, { method: "DELETE" });
    state.subjects = state.subjects.filter(s => s.id !== id);
    if (state.selectedSubjectId === id) {
      state.selectedSubjectId = state.subjects[0]?.id || null;
      updateTimerBadge();
    }
    await loadSessions();
    await loadWeeklyStats();
    renderSubjects();
    showToast("Subject deleted", "info");
  } catch (e) {
    showToast(e.message, "error");
  }
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function startTimer() {
  if (!state.selectedSubjectId) {
    showToast("Select a subject first!", "error"); return;
  }
  if (state.activeSession) return;

  apiFetch("/api/sessions/start", {
    method: "POST",
    body: JSON.stringify({ subject_id: state.selectedSubjectId }),
  }).then(session => {
    state.activeSession = session;
    state.elapsedSeconds = 0;
    $("timer-card").classList.add("running");
    $("btn-start").style.display = "none";
    $("btn-stop").style.display = "";
    $("notes-area").style.display = "";
    state.timerInterval = setInterval(() => {
      state.elapsedSeconds++;
      $("timer-display").textContent = formatDurationTimer(state.elapsedSeconds);
    }, 1000);
    showToast("Session started! 🚀", "success");
  }).catch(e => showToast(e.message, "error"));
}

async function stopTimer() {
  if (!state.activeSession) return;
  clearInterval(state.timerInterval);
  const notes = $("session-notes").value.trim();
  try {
    const finished = await apiFetch(
      `/api/sessions/${state.activeSession.id}/stop`,
      { method: "POST", body: JSON.stringify({ notes }) }
    );
    state.activeSession = null;
    state.elapsedSeconds = 0;
    $("timer-display").textContent = "00:00:00";
    $("timer-card").classList.remove("running");
    $("btn-start").style.display = "";
    $("btn-stop").style.display = "none";
    $("notes-area").style.display = "none";
    $("session-notes").value = "";
    showToast(`Session saved: ${formatDuration(finished.duration_seconds)} 🎉`, "success");
    await loadSessions();
    await loadWeeklyStats();
    renderSubjects();
  } catch (e) {
    showToast(e.message, "error");
  }
}

function updateTimerBadge() {
  const sub = state.subjects.find(s => s.id === state.selectedSubjectId);
  if (sub) {
    $("timer-badge-text").textContent = sub.name;
    $("timer-badge-dot").style.background = sub.color;
  } else {
    $("timer-badge-text").textContent = "Select a subject";
    $("timer-badge-dot").style.background = "var(--text-muted)";
  }
}

// ── Sessions ──────────────────────────────────────────────────────────────────
async function loadSessions() {
  state.sessions = await apiFetch("/api/sessions?days=7");
  renderSessions();
}

function renderSessions() {
  const list = $("session-list");
  if (!state.sessions.length) {
    list.innerHTML = `
      <div class="no-sessions">
        <div class="no-sessions-icon">📚</div>
        <div class="no-sessions-text">No sessions this week yet.<br>Start studying!</div>
      </div>`;
    return;
  }

  list.innerHTML = state.sessions.map(s => {
    const selected = s.id === state.selectedSessionId ? "selected" : "";
    return `
      <div class="session-item ${selected}" data-id="${s.id}" onclick="toggleSelectSession(${s.id})">
        <div class="session-color-bar" style="background:${s.subject_color}"></div>
        <div class="session-select-check">
          <span class="check-icon">✓</span>
        </div>
        <div class="session-info">
          <div class="session-subject">${escHtml(s.subject_name)}</div>
          <div class="session-time">${formatDateTime(s.start_time)}</div>
          ${s.notes ? `<div class="session-notes-preview">${escHtml(s.notes)}</div>` : ""}
        </div>
        <div class="session-duration">${formatDuration(s.duration_seconds)}</div>
        <div class="session-actions" onclick="event.stopPropagation()">
          <button class="btn-tweet" onclick="tweetSession(${s.id})" title="Tweet this session">
            <svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            Tweet
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteSession(${s.id})" title="Delete">✕</button>
        </div>
      </div>`;
  }).join("");
}

function toggleSelectSession(id) {
  state.selectedSessionId = state.selectedSessionId === id ? null : id;
  renderSessions();
  updateTweetBar();
}

function updateTweetBar() {
  const bar = $("tweet-bar");
  if (!state.selectedSessionId) {
    bar.classList.remove("visible");
    return;
  }
  const session = state.sessions.find(s => s.id === state.selectedSessionId);
  if (!session) { bar.classList.remove("visible"); return; }
  bar.classList.add("visible");
  $("tweet-bar-preview").innerHTML =
    `<strong>${escHtml(session.subject_name)}</strong> — ${formatDuration(session.duration_seconds)} on ${formatDate(session.start_time)}`;
}

function tweetSession(id) {
  const session = state.sessions.find(s => s.id === id);
  if (!session) return;
  const text = buildTweetText(session);
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer,width=600,height=450");
}

function tweetSelected() {
  if (state.selectedSessionId) tweetSession(state.selectedSessionId);
}

function buildTweetText(session) {
  const duration = formatDuration(session.duration_seconds);
  const date = formatDate(session.start_time);
  let text = `📚 Just completed a study session!\n\n` +
    `📖 Subject: ${session.subject_name}\n` +
    `⏱️ Duration: ${duration}\n` +
    `📅 Date: ${date}`;
  if (session.notes) text += `\n📝 ${session.notes}`;
  text += `\n\n#StudySession #Learning #Productivity`;
  return text;
}

async function deleteSession(id) {
  if (!confirm("Delete this session?")) return;
  try {
    await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
    state.sessions = state.sessions.filter(s => s.id !== id);
    if (state.selectedSessionId === id) {
      state.selectedSessionId = null;
      updateTweetBar();
    }
    renderSessions();
    await loadWeeklyStats();
    renderSubjects();
    showToast("Session deleted", "info");
  } catch (e) {
    showToast(e.message, "error");
  }
}

// ── Weekly Stats ──────────────────────────────────────────────────────────────
async function loadWeeklyStats() {
  state.weeklyStats = await apiFetch("/api/stats/weekly");
  renderWeeklyStats();
}

function renderWeeklyStats() {
  renderSummaryCards();
  renderBarChart();
  renderBreakdown();
}

function renderSummaryCards() {
  const totalSecs = state.weeklyStats.by_subject.reduce((a, s) => a + s.total_seconds, 0);
  const totalSessions = state.weeklyStats.by_subject.reduce((a, s) => a + s.session_count, 0);
  const avgSecs = totalSessions > 0 ? Math.round(totalSecs / totalSessions) : 0;

  $("stat-total-time").textContent = formatDuration(totalSecs);
  $("stat-sessions").textContent = totalSessions;
  $("stat-avg").textContent = formatDuration(avgSecs);
}

function renderBarChart() {
  const container = $("chart-bars");
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last7.push(d.toISOString().split("T")[0]);
  }

  const dayMap = {};
  state.weeklyStats.by_day.forEach(d => { dayMap[d.day] = d.total_seconds; });

  const maxSec = Math.max(...last7.map(d => dayMap[d] || 0), 1);

  container.innerHTML = last7.map(day => {
    const secs = dayMap[day] || 0;
    const pct = Math.max((secs / maxSec) * 100, secs > 0 ? 6 : 2);
    const label = dayAbbrev(day);
    return `
      <div class="chart-bar-wrap">
        <div class="chart-bar" style="height:${pct}%"
          data-tooltip="${formatDuration(secs)}"></div>
        <span class="chart-day-label">${label}</span>
      </div>`;
  }).join("");
}

function renderBreakdown() {
  const container = $("breakdown-list");
  if (!state.weeklyStats.by_subject.length) {
    container.innerHTML = `<div class="empty-state" style="padding:20px 0">No data for this week yet.</div>`;
    return;
  }
  const maxSec = state.weeklyStats.by_subject[0].total_seconds || 1;
  container.innerHTML = state.weeklyStats.by_subject.map(sub => `
    <div class="breakdown-item">
      <span class="breakdown-label" title="${escHtml(sub.name)}">${escHtml(sub.name)}</span>
      <div class="breakdown-bar-wrap">
        <div class="breakdown-bar"
          style="width:${(sub.total_seconds / maxSec) * 100}%; background:${sub.color}"></div>
      </div>
      <span class="breakdown-time">${formatDuration(sub.total_seconds)}</span>
    </div>
  `).join("");
}

function renderSubjectSelect() {
  renderSubjects();
  updateTimerBadge();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Event Listeners ────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Theme Initialization
  const savedTheme = localStorage.getItem('studyflow-theme') || 'light';
  state.theme = savedTheme;
  setTheme(state.theme);

  // Theme Toggle
  $("btn-theme-toggle").addEventListener("click", () => {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  });

  // Refresh
  $("btn-refresh").addEventListener("click", () => loadAll(true));

  // Add subject on Enter
  $("subject-name").addEventListener("keydown", e => {
    if (e.key === "Enter") addSubject();
  });

  // Initial load
  renderColorPalette();
  loadAll();
});

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('studyflow-theme', theme);
}
