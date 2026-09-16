// app.js — kontroler aplikacji: routing widoków, render, obsługa zdarzeń.
// Vanilla JS. Ionic (web components) zostaje tylko jako <ion-app>/<ion-content>
// (przewijalny kontener) — cały pozostały chrome (tab bar, karty, formularze,
// modal) to własny markup, przeniesiony 1:1 ze statycznego podglądu wizualnego
// (Claude Design canvas, Kierunek A — patrz architektura projektu).

import * as store from './storage.js';
import {
  dateKey, parseDateKey, addUnits, generateAllOccurrences, monthGridRange, monthRange,
} from './recurrence.js';
import { computeDashboardStats } from './gamification.js';
import { svgIcon, googleLogoSvg, CATEGORY_ICON_CHOICES } from './icons.js';
import { signInWithGoogle, isGoogleSignInConfigured } from './google-auth.js';

// ---------- Stałe i pomocnicze formatery ----------

const WEEKDAYS_SHORT = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const WEEKDAYS_LONG = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const MONTHS_NOM = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const FREQUENCY_LABEL = { daily: 'Codzienne', frequent: 'Częste', rare: 'Rzadkie', once: 'Jednorazowe' };
const MEMBER_COLORS = ['#4C6B57', '#B45309', '#3B7DD8', '#7A5C9E', '#C0703A', '#6B7280'];
const CATEGORY_COLOR_PALETTE = ['#3B7DD8', '#6B7280', '#C0703A', '#7A5C9E', '#4C6B57', '#A6862F', '#2D9CB0', '#C97A9E'];

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function hexToRgba(hex, alpha) {
  const h = (hex || '#8B8172').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16) || 0;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// Kolory kategorii/domowników (colorHex) są zapisywane jako stałe wartości dobrane
// pod jasne tło. Na ciemnym tle ten sam kolor użyty wprost jako tekst/ikona na
// półprzezroczystym tle ma za mały kontrast — więc w ciemnym motywie rozjaśniamy go
// (mieszamy z bielą) tylko na potrzeby wyświetlania, bez zmiany zapisanej wartości.
function isDarkMode() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function lightenHex(hex, amount) {
  const h = (hex || '#8B8172').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16) || 0;
  const mix = (c) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `rgb(${r},${g},${b})`;
}

// Kolor "na wierzchu" (tekst/ikona) — rozjaśniony w dark mode dla czytelności.
function categoryFg(hex) {
  return isDarkMode() ? lightenHex(hex, 0.4) : hex;
}

// Alpha tła plakietki/chipa — trochę mocniejsze w dark mode, żeby kolor był widoczny
// na bardzo ciemnym tle zamiast ginąć w nim.
function tintAlpha() {
  return isDarkMode() ? 0.26 : 0.18;
}

// "Kim jesteś" na tym urządzeniu — decyduje, czyje są punkty/poziom na dashboardzie
// (patrz storage.getMyMemberId/setMyMemberId). Domyślnie pierwszy domownik na liście
// (tak jak dotąd wyglądał avatar w rogu), edytowalne w Koncie. Jeśli zapisany wybór
// wskazuje na usuniętego domownika, ustawiamy się od nowa na pierwszego dostępnego.
function resolveMyMemberId(members) {
  let id = store.getMyMemberId();
  if (!id || !members.some((m) => m.id === id)) {
    id = members[0]?.id || null;
    store.setMyMemberId(id);
  }
  return id;
}

// Po realnym zalogowaniu przez Google appka zna imię/e-mail konta — zamiast zostawiać
// "Kim jesteś" na generycznym domowniku (np. "Użytkownik A" z danych demo/domyślnych),
// podpina zalogowane konto pod konkretnego domownika:
// 1) jeśli jakiś domownik ma już zapisany ten e-mail (ponowne logowanie na tym samym
//    urządzeniu, albo dane były już wcześniej dopasowane) — używamy go bez zmian,
// 2) inaczej, jeśli nazwa domownika już zgadza się z imieniem i nazwiskiem z Google —
//    tak samo, tylko dopisujemy e-mail na przyszłość,
// 3) inaczej PRZEMIANOWUJE domownika, pod którym i tak już jesteś na tym urządzeniu
//    (resolveMyMemberId — zwykle pierwszy/domyślny wpis) na dane z Google, zamiast
//    tworzyć osobnego, dodatkowego domownika obok generycznego placeholdera.
function linkGoogleIdentityToMember(profile) {
  const members = store.getMembers();
  const email = (profile.email || '').trim().toLowerCase();
  const name = (profile.name || '').trim();
  const nameKey = name.toLowerCase();

  let match = email ? members.find((m) => (m.email || '').trim().toLowerCase() === email) : null;
  if (!match && nameKey) {
    match = members.find((m) => (m.name || '').trim().toLowerCase() === nameKey);
  }

  if (match) {
    if (email && (match.email || '').trim().toLowerCase() !== email) {
      store.saveMember({ id: match.id, email: profile.email });
    }
    store.setMyMemberId(match.id);
    return;
  }

  if (members.length === 0) {
    const created = store.saveMember({
      name: name || 'Nowy domownik',
      email: profile.email || undefined,
      colorHex: MEMBER_COLORS[0],
    });
    store.setMyMemberId(created.id);
    return;
  }

  const currentId = resolveMyMemberId(members);
  const patch = { id: currentId };
  if (name) patch.name = name;
  if (profile.email) patch.email = profile.email;
  store.saveMember(patch);
  store.setMyMemberId(currentId);
}

function formatDayHeading(date, today) {
  if (sameDay(date, today)) return 'Dziś';
  if (sameDay(date, addUnits(today, 'day', 1))) return 'Jutro';
  return `${WEEKDAYS_LONG[(date.getDay() + 6) % 7]}, ${date.getDate()} ${MONTHS_GEN[date.getMonth()]}`;
}

function formatFullDate(date) {
  return `${WEEKDAYS_LONG[(date.getDay() + 6) % 7]}, ${date.getDate()} ${MONTHS_GEN[date.getMonth()]} ${date.getFullYear()}`;
}

/** Krótki opis harmonogramu do plakietki kategorii, np. "codz.", "co 2 dni", "raz, 20 września". */
function describeScheduleShort(schedule) {
  if (schedule.mode === 'once') {
    const d = parseDateKey(schedule.anchorDate);
    return `raz, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
  }
  const n = schedule.interval;
  if (n === 1) {
    if (schedule.unit === 'day') return 'codz.';
    if (schedule.unit === 'week') return 'co tydz.';
    if (schedule.unit === 'month') return 'co mies.';
  }
  const unitShort = { day: 'dni', week: 'tyg.', month: 'mies.' }[schedule.unit];
  return `co ${n} ${unitShort}`;
}

function scheduleHintText(mode) {
  if (mode === 'once') return 'Jednorazowe zdarzenie — pojawi się tylko raz, we wskazanym dniu.';
  if (mode === 'rolling') return '„Wykonanie” liczy kolejny termin od ostatniego zaznaczenia — dobre dla rzadkich zadań.';
  return '„Stały” trzyma się kalendarza niezależnie od tego, kiedy wykonasz zadanie — dobre dla codziennych/częstych.';
}

// ---------- Kategorie: pomocnicze renderery ----------

function getCategoryOrFallback(categoryId) {
  if (!categoryId) return null;
  return store.getCategory(categoryId);
}

function categoryIconChip(category, size = 44) {
  if (!category) {
    return `<div class="icon-chip icon-chip--md" style="background:var(--cp-surface-border);color:var(--cp-text-tertiary)">${svgIcon('tag', { size: Math.round(size * 0.45) })}</div>`;
  }
  const sizeClass = size <= 40 ? 'icon-chip--sm' : 'icon-chip--md';
  const fg = categoryFg(category.colorHex);
  return `<div class="icon-chip ${sizeClass}" style="background:${hexToRgba(category.colorHex, tintAlpha())};color:${fg}">${svgIcon(category.icon, { size: Math.round(size * 0.45), color: fg })}</div>`;
}

function categoryBadge(category, schedule) {
  const scheduleText = describeScheduleShort(schedule);
  if (!category) {
    return `<span class="cat-badge-uncategorized">Bez kategorii · ${scheduleText}</span>`;
  }
  const fg = categoryFg(category.colorHex);
  return `<span class="cat-badge" style="background:${hexToRgba(category.colorHex, tintAlpha())};color:${fg}">${escapeHtml(category.name)} · ${scheduleText}</span>`;
}

// ---------- Stan UI (nie dane — te zawsze czytane ze storage) ----------

const ui = {
  route: 'login', // 'login' | 'app' — ustalane w init() na podstawie store.getSession()
  tab: 'dashboard', // dashboard | month | chores (zakładki dolnego paska)
  view: null, // null | 'categories' | 'konto' — pełnoekranowe widoki "pushed" (bez tab bara)
  monthCursor: startOfToday(),
  selectedDay: null,
  modal: null, // { type: 'occurrence'|'chore', ..., draft: {...} }
  categoryEditId: null, // id edytowanej kategorii w widoku Kategorie (null = tryb "nowa")
  categoryDraft: null, // { name, colorHex, icon, builtIn? } — stan roboczy kreatora/edytora kategorii
  loginGoogleNoteVisible: false,
  loginGoogleNoteText: 'Logowanie Google wymaga jeszcze skonfigurowania projektu w Google Cloud Console (Faza 2 — patrz README). Na razie kontynuuj lokalnie — dane zostaną na tym urządzeniu.',
  googleSignInBusy: false, // true w trakcie okna zgody Google (blokuje podwójne kliknięcie)
  choreFilter: 'all', // 'all' | 'fixed' | 'rolling' (filtr trybu harmonogramu w Obowiązkach)
};

// ---------- Motyw ----------

/** ion-content przewija się we własnym, wewnętrznym kontenerze (shadow DOM), który
 * NIE resetuje się sam przy podmianie innerHTML — bez tego, po przejściu np. z
 * przewiniętego w dół formularza na nowy pełnoekranowy widok, ten widok potrafi
 * wystartować przewinięty (górne elementy, np. przycisk "Wróć", są wtedy niewidoczne
 * poza ekranem). Wołane tylko przy faktycznej nawigacji między widokami — nie przy
 * drobnych re-renderach w obrębie tego samego ekranu. */
function scrollContentTop() {
  const content = document.getElementById('mainContent');
  if (content && typeof content.scrollToTop === 'function') content.scrollToTop(0);
  else window.scrollTo(0, 0);
}

const darkMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function applyTheme() {
  const pref = store.getThemePreference();
  const root = document.documentElement;
  // 'auto' rozwiązujemy do konkretnego light/dark już tutaj (zamiast zostawiać to
  // samemu CSS przez media query) — dzięki temu WSZYSTKIE reguły dark mode (nie tylko
  // tokeny kolorów w :root) mają jedno źródło prawdy: [data-theme="dark"].
  const resolved = pref === 'auto' ? (darkMediaQuery?.matches ? 'dark' : 'light') : pref;
  root.setAttribute('data-theme', resolved);
}

function watchSystemTheme() {
  if (!darkMediaQuery) return;
  const onChange = () => { if (store.getThemePreference() === 'auto') applyTheme(); };
  if (darkMediaQuery.addEventListener) darkMediaQuery.addEventListener('change', onChange);
  else if (darkMediaQuery.addListener) darkMediaQuery.addListener(onChange); // starsze przeglądarki
}

// ---------- Render dispatcher ----------

function render() {
  const main = document.getElementById('mainContent');
  const tabbar = document.getElementById('tabbar');

  const showTabbar = ui.route === 'app' && !ui.view;
  tabbar.classList.toggle('is-hidden', !showTabbar);
  if (showTabbar) renderTabbar();

  let html;
  if (ui.route === 'login') {
    html = renderLoginView();
  } else if (ui.view === 'konto') {
    html = renderAccountView();
  } else if (ui.view === 'categories') {
    html = renderCategoriesView();
  } else if (ui.tab === 'dashboard') {
    html = renderDashboardView();
  } else if (ui.tab === 'month') {
    html = renderMonthView();
  } else {
    html = renderChoresView();
  }
  main.innerHTML = html;
  renderModal();
}

function renderTabbar() {
  const tabbar = document.getElementById('tabbar');
  const tabs = [
    { key: 'dashboard', label: 'Start', icon: 'home' },
    { key: 'month', label: 'Kalendarz', icon: 'calendar' },
    { key: 'chores', label: 'Obowiązki', icon: 'list' },
  ];
  tabbar.innerHTML = tabs.map((t) => {
    const active = ui.tab === t.key;
    return `<button type="button" class="tabbar-btn ${active ? 'is-active' : ''}" data-tab="${t.key}">
      ${svgIcon(t.icon, { size: 20, strokeWidth: 1.8 })}
      <span>${t.label}</span>
    </button>`;
  }).join('');
}

// ---------- Wspólne: budowanie modelu wystąpień ----------

function buildOccurrenceEntries(occurrences) {
  return occurrences.map((occ) => {
    const key = dateKey(occ.date);
    const override = store.getOverride(occ.choreId, key);
    return { ...occ, key, status: override?.status || 'pending', override };
  });
}

function renderOccurrenceRow(entry, chores, members) {
  const chore = chores.find((c) => c.id === entry.choreId);
  if (!chore) return '';
  const assigneeId = entry.override?.assigneeId ?? chore.assigneeId;
  const member = members.find((m) => m.id === assigneeId);
  const isDone = entry.status === 'done';
  const isOverdue = !isDone && entry.date.getTime() < startOfToday().getTime();

  return `
    <button type="button" class="occ-row ${isDone ? 'is-done' : ''}" data-action="open-occurrence" data-choreid="${chore.id}" data-date="${entry.key}">
      <span class="occ-check">${isDone ? svgIcon('check', { size: 14, color: 'white', strokeWidth: 3 }) : ''}</span>
      <span class="spacer">
        <span class="occ-title">${escapeHtml(chore.title)}</span>
        <span class="occ-meta">
          ${isOverdue ? '<span class="badge-overdue">Zaległe</span>' : ''}
          ${member
            ? `<span class="row" style="gap:6px"><span class="occ-avatar" style="background:${member.colorHex}">${initials(member.name)}</span>${escapeHtml(member.name)} · ${chore.estimatedMinutes} min</span>`
            : `<span>Nieprzypisane · ${chore.estimatedMinutes} min</span>`}
        </span>
      </span>
      ${!isDone ? `<span class="occ-chevron">${svgIcon('chevron-right', { size: 16 })}</span>` : ''}
    </button>`;
}

function progressRing(done, total, size = 44) {
  const pct = total > 0 ? done / total : 0;
  const r = 18;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct);
  return `
    <div class="progress-ring" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 48 48">
        <circle class="track" cx="24" cy="24" r="${r}"></circle>
        <circle class="fill" cx="24" cy="24" r="${r}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle>
      </svg>
    </div>`;
}

// ---------- Widok: Logowanie ----------

function renderLoginView() {
  return `
    <div class="login-screen">
      <svg class="bg-decoration" width="220" height="220" viewBox="0 0 220 220" fill="none">
        <path d="M20 200 L200 20" stroke="#D9B865" stroke-width="1.5"/>
        <path d="M60 210 L210 60" stroke="#D9B865" stroke-width="1.5"/>
        <path d="M0 150 L150 0" stroke="#D9B865" stroke-width="1.5"/>
      </svg>

      <div class="login-logo">
        <div class="login-mark">${svgIcon('breeze', { size: 36, color: 'currentColor' })}</div>
        <div>
          <h1 class="login-title">Cleaner Planner</h1>
          <p class="login-tagline">Wspólne obowiązki domowe, bez chaosu i bez przypominania sobie nawzajem.</p>
        </div>
      </div>

      <div class="login-card">
        <div>
          <div class="login-card-heading">Połącz z Google</div>
          <p class="login-card-sub">Zaloguj się, żeby zsynchronizować obowiązki między domownikami przez Kalendarz Google.</p>
        </div>

        <button type="button" class="btn-google" data-action="continue-google" ${ui.googleSignInBusy ? 'disabled' : ''}>
          ${googleLogoSvg(18)}
          ${ui.googleSignInBusy ? 'Łączenie z Google…' : 'Kontynuuj z Google'}
        </button>
        <div class="login-google-note ${ui.loginGoogleNoteVisible ? 'is-visible' : ''}" id="loginGoogleNote">
          ${escapeHtml(ui.loginGoogleNoteText)}
        </div>

        <div class="login-divider"><div class="line"></div><div class="word">lub</div><div class="line"></div></div>

        <button type="button" class="btn btn-outline btn-block" data-action="continue-local">Kontynuuj lokalnie (bez logowania)</button>
      </div>

      <p class="login-footnote">Logowanie odbywa się bezpośrednio przez konto Google — appka nie ma własnego serwera i nie przechowuje Twojego hasła. Bez logowania obowiązki zapisują się tylko na tym urządzeniu.</p>
    </div>`;
}

// ---------- Widok: Dashboard (Start) ----------

function renderDashboardView() {
  const chores = store.getChores();
  const members = store.getMembers();

  if (chores.length === 0) return renderEmptyChoresState();

  const myMemberId = resolveMyMemberId(members);
  const overrides = store.getOverrides();
  const stats = computeDashboardStats(chores, overrides, store.getOverride, myMemberId);

  const today = startOfToday();
  const rangeStart = addUnits(today, 'day', -14);
  const rangeEnd = addUnits(today, 'day', 3);
  const occurrences = generateAllOccurrences(chores, rangeStart, rangeEnd);
  const entries = buildOccurrenceEntries(occurrences);

  const overdue = entries.filter((e) => e.date.getTime() < today.getTime() && e.status !== 'done');
  const todayList = entries.filter((e) => sameDay(e.date, today));
  const upcoming = entries.filter((e) => e.date.getTime() > today.getTime());
  const todayDoneCount = todayList.filter((e) => e.status === 'done').length;

  const weekPct = stats.weekTotal > 0 ? Math.round((stats.weekDone / stats.weekTotal) * 100) : 100;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Dzień dobry' : hour < 18 ? 'Cześć' : 'Dobry wieczór';

  const meMember = members.find((m) => m.id === myMemberId);
  const meLabel = initials(meMember?.name || 'JA');

  const level = stats.level;
  const nextMin = level.next ? level.next.min : null;
  const levelPct = nextMin ? Math.max(4, Math.min(100, Math.round(((stats.points - level.min) / (nextMin - level.min)) * 100))) : 100;
  const levelPointsLabel = nextMin ? `${stats.points} / ${nextMin} pkt` : `${stats.points} pkt · najwyższy poziom!`;

  let html = `
    <div class="view">
      <div class="hero-row">
        <div>
          <h1 class="hero-title">${greeting}!</h1>
          <p class="hero-sub">${formatFullDate(today)}</p>
        </div>
        <button type="button" class="account-fab" data-action="open-account" aria-label="Konto">${meLabel}</button>
      </div>

      <div class="level-banner">
        <div class="level-banner-icon">${svgIcon(level.icon, { size: 24, color: 'currentColor' })}</div>
        <div class="level-banner-body">
          <div class="level-banner-top">
            <div class="level-banner-title">${escapeHtml(level.title)}</div>
            <div class="level-banner-points">${levelPointsLabel}</div>
          </div>
          <div class="level-banner-track"><div class="level-banner-fill" style="width:${levelPct}%"></div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-label">Statystyki</div>
        <div class="stats-grid">
          <div class="stat-card stat-card--today">
            ${progressRing(todayDoneCount, todayList.length)}
            <div><div class="stat-value">${todayDoneCount}/${todayList.length}</div><div class="stat-label">Dziś wykonane</div></div>
          </div>
          <div class="stat-card stat-card--streak">
            <div class="stat-card-icon stat-icon-streak">${svgIcon('flame', { size: 22, color: 'currentColor' })}</div>
            <div><div class="stat-value">${stats.streak}</div><div class="stat-label">${stats.streak === 1 ? 'dzień passy' : 'dni passy'}</div></div>
          </div>
          <div class="stat-card stat-card--points">
            <div class="stat-card-icon stat-icon-points">${svgIcon('starburst', { size: 22, color: 'currentColor' })}</div>
            <div><div class="stat-value">${stats.points}</div><div class="stat-label">Twoje punkty</div></div>
          </div>
          <div class="stat-card stat-card--week">
            <div class="stat-card-icon stat-icon-week">${svgIcon('trending-up', { size: 22, color: 'currentColor' })}</div>
            <div><div class="stat-value">${weekPct}%</div><div class="stat-label">tydzień na bieżąco</div></div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-label">Zaplanuj zadania</div>
        <div class="quick-actions">
          <button type="button" class="btn-quick btn-quick-primary" data-action="new-chore">${svgIcon('plus', { size: 18 })}Obowiązek</button>
          <button type="button" class="btn-quick btn-quick-secondary" data-action="new-once">${svgIcon('flash', { size: 18, color: 'var(--cp-accent)' })}Jednorazowe</button>
        </div>
      </div>
  `;

  if (overdue.length > 0) {
    html += `<div class="section">
      <div class="row-between"><div class="section-label" style="color:var(--cp-danger)">Zaległe</div><span class="text-secondary text-sm">${overdue.length}</span></div>
      <div class="stack">${overdue.map((e) => renderOccurrenceRow(e, chores, members)).join('')}</div>
    </div>`;
  }

  html += `<div class="section">
    <div class="row-between"><div class="section-label">Dziś</div><div style="font-size:12.5px;font-weight:700;color:var(--cp-accent)">${todayDoneCount} z ${todayList.length}</div></div>
    <div class="stack">${
      todayList.length
        ? todayList.map((e) => renderOccurrenceRow(e, chores, members)).join('')
        : '<p class="empty-note">Brak obowiązków zaplanowanych na dziś.</p>'
    }</div>
  </div>`;

  if (upcoming.length > 0) {
    html += `<div class="section">
      <div class="section-label">Najbliższe dni</div>
      <div class="stack">${upcoming.slice(0, 6).map((e) => renderOccurrenceRow(e, chores, members)).join('')}</div>
    </div>`;
  }

  html += `</div>`;
  return html;
}

function renderEmptyChoresState() {
  return `<div class="view">
    <div class="empty-state">
      <div class="icon-chip icon-chip--md" style="width:64px;height:64px;border-radius:20px;background:var(--cp-accent-tint);margin:0 auto 16px;color:var(--cp-accent)">${svgIcon('breeze', { size: 28, color: 'currentColor' })}</div>
      <h2>Brak obowiązków</h2>
      <p class="text-secondary" style="margin-top:8px">Dodaj pierwszy obowiązek, żeby zacząć budować nawyk sprzątania.</p>
      <button type="button" class="btn btn-primary" style="margin-top:16px" data-action="new-chore">${svgIcon('plus', { size: 18 })}Dodaj obowiązek</button>
    </div>
  </div>`;
}

// ---------- Widok: Kalendarz (miesiąc) ----------

function renderMonthView() {
  const cursor = ui.monthCursor;
  const { start: gridStart, end: gridEnd } = monthGridRange(cursor);
  const { start: monthStart } = monthRange(cursor);
  const chores = store.getChores();
  const members = store.getMembers();
  const today = startOfToday();
  const occurrences = generateAllOccurrences(chores, gridStart, gridEnd);

  const byDay = new Map();
  for (const occ of occurrences) {
    const key = dateKey(occ.date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(occ);
  }

  let cells = '';
  const cursorDate = new Date(gridStart);
  while (cursorDate.getTime() <= gridEnd.getTime()) {
    const key = dateKey(cursorDate);
    const dayOccs = byDay.get(key) || [];
    const isOutside = cursorDate.getMonth() !== monthStart.getMonth();
    const isToday = sameDay(cursorDate, today);
    const isSelected = ui.selectedDay === key;
    const dots = dayOccs.slice(0, 4).map((occ) => {
      const chore = chores.find((c) => c.id === occ.choreId);
      const category = chore ? getCategoryOrFallback(chore.categoryId) : null;
      const color = category ? category.colorHex : '#B0A697';
      return `<span class="month-dot" style="background:${categoryFg(color)}"></span>`;
    }).join('');

    cells += `<button type="button" class="month-cell ${isOutside ? 'is-outside' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}"
        data-action="select-day" data-date="${key}" ${isOutside ? 'disabled' : ''}>
      <span class="date-num">${cursorDate.getDate()}</span>
      <span class="month-dots">${dots}</span>
    </button>`;
    cursorDate.setDate(cursorDate.getDate() + 1);
  }

  let dayPanel = '';
  if (ui.selectedDay) {
    const date = parseDateKey(ui.selectedDay);
    const dayOccs = buildOccurrenceEntries(byDay.get(ui.selectedDay) || []);
    dayPanel = `<div class="section">
      <div class="row-between"><div class="section-label">${formatDayHeading(date, today)}, ${date.getDate()} ${MONTHS_GEN[date.getMonth()]}</div><div style="font-size:12.5px;font-weight:700;color:var(--cp-accent)">${dayOccs.length} ${dayOccs.length === 1 ? 'zadanie' : 'zadania'}</div></div>
      <div class="stack">${
        dayOccs.length
          ? dayOccs.map((e) => renderOccurrenceRow(e, chores, members)).join('')
          : '<p class="empty-note">Brak obowiązków tego dnia.</p>'
      }</div>
    </div>`;
  }

  return `
    <div class="view">
      <div class="row-between">
        <h1 style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Kalendarz</h1>
        <div class="month-nav">
          <button type="button" class="icon-btn icon-btn--sm" data-action="prev-month" aria-label="Poprzedni miesiąc">${svgIcon('chevron-left', { size: 17, strokeWidth: 2 })}</button>
          <button type="button" class="btn btn-outline" style="height:36px;padding:0 14px;font-size:13px" data-action="today-month">Dziś</button>
          <button type="button" class="icon-btn icon-btn--sm" data-action="next-month" aria-label="Następny miesiąc">${svgIcon('chevron-right', { size: 17, strokeWidth: 2 })}</button>
        </div>
      </div>

      <div class="month-card">
        <div class="month-title">${MONTHS_NOM[cursor.getMonth()].toLowerCase()} ${cursor.getFullYear()}</div>
        <div class="month-weekdays">${WEEKDAYS_SHORT.map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="month-grid">${cells}</div>
      </div>

      ${dayPanel}
    </div>
  `;
}

// ---------- Widok: Obowiązki ----------

function renderChoresView() {
  const chores = store.getChores();
  const categories = store.getCategories();

  const filtered = chores.filter((c) => ui.choreFilter === 'all' || c.schedule.mode === ui.choreFilter);
  const grouped = { daily: [], frequent: [], rare: [], once: [] };
  for (const c of filtered) (grouped[c.frequencyTier] || grouped.frequent).push(c);

  let choresHtml = '';
  for (const tier of ['daily', 'frequent', 'rare', 'once']) {
    if (grouped[tier].length === 0) continue;
    choresHtml += `<div class="section">
      <div class="section-label">${FREQUENCY_LABEL[tier]}</div>
      <div class="stack">${grouped[tier].map((chore) => renderChoreCard(chore, categories)).join('')}</div>
    </div>`;
  }
  if (filtered.length === 0) choresHtml = '<p class="empty-note">Brak obowiązków spełniających ten filtr.</p>';

  const members = store.getMembers();
  const filters = [
    { key: 'all', label: 'Wszystkie' },
    { key: 'fixed', label: 'Stałe' },
    { key: 'rolling', label: 'Od wykonania' },
  ];

  return `
    <div class="view">
      <div class="view-header-fab">
        <div>
          <h1 style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Obowiązki</h1>
          <p class="text-sm text-secondary" style="margin-top:4px">${chores.length} ${chores.length === 1 ? 'obowiązek' : 'obowiązków'} · ${members.length} ${members.length === 1 ? 'domownik' : 'domowników'}</p>
        </div>
        <button type="button" class="fab-btn" data-action="new-chore" aria-label="Dodaj obowiązek">${svgIcon('plus', { size: 20, strokeWidth: 2.2 })}</button>
      </div>

      <div class="filter-pills">
        ${filters.map((f) => `<button type="button" class="filter-pill ${ui.choreFilter === f.key ? 'is-active' : ''}" data-action="set-chore-filter" data-filter="${f.key}">${f.label}</button>`).join('')}
      </div>

      ${choresHtml}

      <button type="button" class="btn btn-outline btn-block" style="color:var(--cp-danger)" data-action="reset-demo">Zresetuj dane demonstracyjne</button>
    </div>
  `;
}

function renderChoreCard(chore, categories) {
  const category = getCategoryOrFallback(chore.categoryId);
  return `
    <button type="button" class="chore-row ${chore.active ? '' : 'is-inactive'}" data-action="edit-chore" data-choreid="${chore.id}">
      ${categoryIconChip(category, 44)}
      <span class="spacer">
        <span class="chore-title">${escapeHtml(chore.title)}</span>
        <span class="chore-meta">
          ${categoryBadge(category, chore.schedule)}
          <span>${chore.estimatedMinutes} min</span>
        </span>
      </span>
      <span class="occ-chevron">${svgIcon('chevron-right', { size: 16 })}</span>
    </button>`;
}

// ---------- Widok: Kategorie (design system) ----------

function renderCategoriesView() {
  const categories = store.getCategories();
  const editing = !!ui.categoryEditId;
  if (!ui.categoryDraft) {
    ui.categoryDraft = editing
      ? { ...store.getCategory(ui.categoryEditId) }
      : { name: '', colorHex: CATEGORY_COLOR_PALETTE[6], icon: CATEGORY_ICON_CHOICES[5] };
  }
  const draft = ui.categoryDraft;

  const legendHtml = categories.map((cat) => `
    <button type="button" class="category-row" data-action="edit-category" data-catid="${cat.id}">
      ${categoryIconChip(cat, 40)}
      <span class="spacer category-row-name">${escapeHtml(cat.name)}</span>
      <span class="category-dot" style="background:${categoryFg(cat.colorHex)}"></span>
      ${svgIcon('chevron-right', { size: 15, color: 'var(--cp-chevron)' })}
    </button>`).join('');

  return `
    <div class="view view--sheet-like">
      <div class="row">
        <button type="button" class="icon-btn icon-btn--sm" data-action="back" aria-label="Wróć">${svgIcon('chevron-left', { size: 16, strokeWidth: 2 })}</button>
        <div>
          <h1 style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Kategorie</h1>
          <p class="text-sm text-secondary" style="margin-top:2px">Kolor i ikona rozpoznawalne w całej appce</p>
        </div>
      </div>

      <div class="section">
        <div class="section-label">${categories.length} ${categories.length === 1 ? 'kategoria' : 'kategorii'}</div>
        <div class="stack">${legendHtml}</div>
      </div>

      <div class="section">
        <div class="row-between">
          <div class="section-label">${editing ? 'Edycja kategorii' : 'Nowa kategoria'}</div>
          ${editing ? '<button type="button" class="link-btn" data-action="cancel-category-edit">Anuluj</button>' : ''}
        </div>

        <div class="category-creator">
          <div class="category-preview">
            ${categoryIconChip(draft, 36)}
            <div style="font-size:14px;font-weight:700">${escapeHtml(draft.name || 'Podgląd')}</div>
            <div class="category-preview-label">Podgląd</div>
          </div>

          <div class="field">
            <label>Nazwa</label>
            <input type="text" class="input" id="catName" value="${escapeHtml(draft.name)}" placeholder="np. Pranie" ${draft.builtIn ? 'disabled' : ''}>
          </div>

          <div class="field">
            <label>Kolor</label>
            <div class="swatch-grid" id="catColorGrid">
              ${CATEGORY_COLOR_PALETTE.map((c) => `<button type="button" class="swatch ${draft.colorHex === c ? 'is-selected' : ''}" style="background:${c};color:${c}" data-action="pick-category-color" data-color="${c}" aria-label="Kolor ${c}"></button>`).join('')}
            </div>
          </div>

          <div class="field">
            <label>Ikona</label>
            <div class="icon-grid" id="catIconGrid">
              ${CATEGORY_ICON_CHOICES.map((iconName) => {
                const selected = draft.icon === iconName;
                const fg = categoryFg(draft.colorHex);
                return `<button type="button" class="${selected ? 'is-selected' : ''}" style="${selected ? `background:${hexToRgba(draft.colorHex, tintAlpha())};color:${fg}` : ''}" data-action="pick-category-icon" data-icon="${iconName}">${svgIcon(iconName, { size: 18, color: selected ? fg : 'var(--cp-text-secondary)' })}</button>`;
              }).join('')}
            </div>
          </div>

          <button type="button" class="btn btn-primary btn-block" data-action="save-category">${editing ? 'Zapisz zmiany' : 'Dodaj kategorię'}</button>
          ${editing && !draft.builtIn ? `<button type="button" class="btn btn-danger-ghost btn-block" data-action="delete-category" data-catid="${draft.id}">Usuń kategorię</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ---------- Widok: Konto ----------

function renderAccountView() {
  const session = store.getSession();
  const members = store.getMembers();
  const isGoogle = session?.mode === 'google';
  const myMemberId = resolveMyMemberId(members);
  const displayName = session?.name || members.find((m) => m.id === myMemberId)?.name || 'Ty';
  const themePref = store.getThemePreference();

  const membersHtml = members.map((m, i) => `
    <div class="member-row-editable row">
      <span class="occ-avatar" style="width:34px;height:34px;font-size:12px;background:${m.colorHex}">${initials(m.name)}</span>
      <input value="${escapeHtml(m.name)}" data-action="rename-member" data-memberid="${m.id}" />
      ${members.length > 1 ? `<button type="button" class="icon-btn icon-btn--sm" style="border:none;background:none;flex-shrink:0" data-action="delete-member" data-memberid="${m.id}" aria-label="Usuń domownika">${svgIcon('close', { size: 15, color: 'var(--cp-text-tertiary)' })}</button>` : ''}
      <div class="member-color-row">
        ${MEMBER_COLORS.map((c) => `<button type="button" class="member-color-dot ${c === m.colorHex ? 'is-selected' : ''}" style="background:${c}" data-action="recolor-member" data-memberid="${m.id}" data-color="${c}" aria-label="Kolor"></button>`).join('')}
      </div>
    </div>`).join('');

  return `
    <div class="view view--sheet-like">
      <div class="row">
        <button type="button" class="icon-btn icon-btn--sm" data-action="back" aria-label="Wróć">${svgIcon('chevron-left', { size: 16, strokeWidth: 2 })}</button>
        <h1 style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Konto</h1>
      </div>

      <div class="profile-card">
        <div class="profile-avatar" style="position:relative;overflow:hidden">${initials(displayName)}${isGoogle && session.picture ? `<img src="${escapeHtml(session.picture)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit" onerror="this.remove()">` : ''}</div>
        <div class="spacer">
          <div class="profile-name">${escapeHtml(displayName)}</div>
          ${isGoogle
            ? `<div class="row" style="gap:6px">${googleLogoSvg(13)}<span class="profile-email">${escapeHtml(session.email || '')}</span></div>`
            : '<div class="profile-email">Tryb lokalny — dane tylko na tym urządzeniu</div>'}
        </div>
      </div>

      ${members.length > 1 ? `
      <div class="section">
        <div class="section-label">Kim jesteś?</div>
        <p class="hint" style="margin-top:-8px">Decyduje, czyje są Twoje punkty i poziom na dashboardzie. Gdy odhaczysz zadanie przypisane komuś innemu, przejmiesz je na siebie.</p>
        <div class="chip-group">
          ${members.map((m) => `<button type="button" class="assignee-chip ${m.id === myMemberId ? 'is-selected' : ''}" data-action="set-my-member" data-id="${m.id}"><span class="occ-avatar" style="background:${m.colorHex}">${initials(m.name)}</span>${escapeHtml(m.name)}</button>`).join('')}
        </div>
      </div>` : ''}

      <div class="section">
        <div class="section-label">Kalendarz</div>
        <div class="status-row">
          ${categoryIconChip({ colorHex: '#4C6B57', icon: 'calendar' }, 40)}
          <div class="spacer">
            <div style="font-size:14.5px;font-weight:700">Sprzątanie — dom</div>
            <div class="row" style="gap:6px;margin-top:2px">
              <span class="status-dot is-pending"></span>
              <span class="text-sm text-secondary">${isGoogle ? 'Zalogowano przez Google — synchronizacja z Kalendarzem to kolejny krok' : 'Brak połączenia — dostępne od Fazy 2'}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-label">Domownicy</div>
        <div class="stack">
          ${membersHtml}
          <button type="button" class="dashed-row" data-action="add-member">
            <span class="dashed-avatar">${svgIcon('plus', { size: 14, color: 'var(--cp-text-secondary)' })}</span>
            Dodaj domownika
          </button>
        </div>
      </div>

      <div class="section">
        <div class="section-label">Wygląd</div>
        <div class="segmented-3">
          <button type="button" class="${themePref === 'light' ? 'is-active' : ''}" data-action="set-theme" data-value="light">Jasny</button>
          <button type="button" class="${themePref === 'dark' ? 'is-active' : ''}" data-action="set-theme" data-value="dark">Ciemny</button>
          <button type="button" class="${themePref === 'auto' ? 'is-active' : ''}" data-action="set-theme" data-value="auto">System</button>
        </div>
      </div>

      <button type="button" class="status-row" style="cursor:pointer;text-align:left;width:100%;border:1px solid var(--cp-surface-border);font-family:inherit" data-action="open-categories">
        ${categoryIconChip({ colorHex: '#A6862F', icon: 'tag' }, 40)}
        <span class="spacer" style="font-size:14.5px;font-weight:700">Kategorie obowiązków</span>
        ${svgIcon('chevron-right', { size: 15, color: 'var(--cp-chevron)' })}
      </button>

      <button type="button" class="btn btn-danger-ghost btn-block" data-action="logout" style="margin-top:4px">
        ${svgIcon('logout', { size: 17 })}Wyloguj się
      </button>

      <p class="login-footnote" style="margin-top:-8px">Wylogowanie nie usuwa zapisanych obowiązków — po ponownym zalogowaniu wrócą tak, jak je zostawiono.</p>
    </div>
  `;
}

// ---------- Modal: szczegóły wystąpienia ----------

function renderOccurrenceModalContent(choreId, dateKeyStr) {
  const chore = store.getChore(choreId);
  if (!chore) return '';
  const members = store.getMembers();
  const category = getCategoryOrFallback(chore.categoryId);
  const override = store.getOverride(choreId, dateKeyStr);
  const status = override?.status || 'pending';
  const assigneeId = override?.assigneeId ?? chore.assigneeId;
  const date = parseDateKey(dateKeyStr);
  const isDone = status === 'done';
  const isOverdue = !isDone && date.getTime() < startOfToday().getTime();
  const isToday = sameDay(date, startOfToday());
  const member = members.find((m) => m.id === assigneeId);

  return `
    <div class="modal-handle"></div>
    <div class="modal-header">
      <div class="stack" style="gap:6px">
        ${category ? (() => { const fg = categoryFg(category.colorHex); return `<span class="sheet-badge" style="background:${hexToRgba(category.colorHex, tintAlpha())};color:${fg}">${svgIcon(category.icon, { size: 12, color: fg, strokeWidth: 2.4 })}${escapeHtml(category.name)} · ${describeScheduleShort(chore.schedule)}</span>`; })() : ''}
        <div class="row" style="gap:8px;flex-wrap:wrap">
          ${isOverdue ? '<span class="badge-overdue">Zaległe</span>' : ''}
          ${isToday ? '<span class="badge-today">Dziś</span>' : ''}
          ${isDone ? '<span class="badge-done">Wykonane</span>' : ''}
        </div>
        <h1 class="modal-title">${escapeHtml(chore.title)}</h1>
      </div>
      <button type="button" class="icon-btn icon-btn--sm" data-action="close-modal" aria-label="Zamknij">${svgIcon('close', { size: 16, strokeWidth: 1.8 })}</button>
    </div>

    ${chore.notes || chore.checklist?.length ? `
    <div class="section" style="gap:14px">
      ${chore.notes ? `<p class="modal-body-text">${escapeHtml(chore.notes)}</p>` : ''}
      ${chore.checklist?.length ? `<div class="stack" style="gap:10px">${chore.checklist.map((item) => `<div class="checklist-view-item"><span class="check-mini">${svgIcon('check', { size: 11, color: 'var(--cp-on-accent)', strokeWidth: 3.2 })}</span><span>${escapeHtml(item)}</span></div>`).join('')}</div>` : ''}
    </div>` : ''}

    <div class="meta-card">
      <div class="meta-row">
        ${svgIcon('calendar', { size: 18, color: 'var(--cp-text-secondary)' })}
        <div class="spacer"><div class="meta-label">Termin</div><div class="meta-value">${formatFullDate(date)}${chore.schedule.time ? ', ' + chore.schedule.time : ''}</div></div>
      </div>
      <div class="meta-divider"></div>
      <div class="meta-row">
        ${member ? `<span class="occ-avatar" style="width:18px;height:18px;background:${member.colorHex}">${initials(member.name)}</span>` : svgIcon('users', { size: 18, color: 'var(--cp-text-secondary)' })}
        <div class="spacer">
          <div class="meta-label">Wykonawca</div>
          <select class="select" style="height:auto;border:none;padding:0 20px 0 0;font-size:14px;font-weight:600;color:var(--cp-text);background-color:transparent;background-position:right center" data-action="reassign" data-choreid="${choreId}" data-date="${dateKeyStr}">
            <option value="" ${!assigneeId ? 'selected' : ''}>Nieprzypisane</option>
            ${members.map((m) => `<option value="${m.id}" ${assigneeId === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="meta-divider"></div>
      <div class="meta-row">
        ${svgIcon('clock', { size: 18, color: 'var(--cp-text-secondary)' })}
        <div class="spacer"><div class="meta-label">Szacowany czas</div><div class="meta-value">${chore.estimatedMinutes} minut</div></div>
      </div>
    </div>

    <button type="button" class="btn btn-primary btn-block" data-action="toggle-occurrence" data-choreid="${choreId}" data-date="${dateKeyStr}">
      ${svgIcon(isDone ? 'close' : 'check', { size: 19, strokeWidth: 2.2 })}
      ${isDone ? 'Cofnij wykonanie' : 'Oznacz jako wykonane'}
    </button>
    <button type="button" class="link-btn" style="justify-content:center" data-action="edit-chore" data-choreid="${choreId}">Edytuj obowiązek</button>
  `;
}

// ---------- Modal: formularz obowiązku ----------

function renderChoreFormContent(choreId, presetMode) {
  const chore = choreId ? store.getChore(choreId) : null;
  const members = store.getMembers();
  const categories = store.getCategories();
  const draft = ui.modal.draft;
  const showIntervalFields = draft.scheduleMode !== 'once';

  const modeButtons = [
    { key: 'fixed', label: 'Stały' },
    { key: 'rolling', label: 'Wykonanie' },
    { key: 'once', label: 'Raz' },
  ];

  return `
    <div class="modal-header" style="align-items:center">
      <button type="button" class="icon-btn icon-btn--sm" data-action="close-modal" aria-label="Zamknij">${svgIcon('close', { size: 16 })}</button>
      <h2 class="modal-title-sm" style="text-align:center;flex:1">${chore ? 'Edytuj obowiązek' : presetMode === 'once' ? 'Nowe zdarzenie jednorazowe' : 'Nowy obowiązek'}</h2>
      <button type="button" class="modal-save-link" data-action="submit-chore-form">Zapisz</button>
    </div>
    <form id="choreForm" data-choreid="${chore?.id || ''}" class="stack" style="gap:24px">
      <div class="field">
        <label for="f-title">Nazwa</label>
        <input class="input" id="f-title" name="title" required value="${escapeHtml(draft.title)}" placeholder="np. Odkurzanie salonu" />
      </div>

      <div class="field">
        <label>Kategoria</label>
        <div class="chip-group">
          ${categories.map((cat) => {
            const selected = draft.categoryId === cat.id;
            return `<button type="button" class="chip ${selected ? 'is-selected' : ''}" style="${selected ? `background:${cat.colorHex}` : ''}" data-action="select-category" data-catid="${cat.id}">${svgIcon(cat.icon, { size: 14, color: selected ? 'currentColor' : categoryFg(cat.colorHex) })}${escapeHtml(cat.name)}</button>`;
          }).join('')}
          <button type="button" class="chip is-dashed" data-action="new-category-link">${svgIcon('plus', { size: 14, color: 'var(--cp-text-secondary)', strokeWidth: 2 })}Nowa</button>
        </div>
      </div>

      <div class="field">
        <label>Harmonogram</label>
        <div class="segmented-3">
          ${modeButtons.map((m) => `<button type="button" class="${draft.scheduleMode === m.key ? 'is-active' : ''}" data-action="set-schedule-mode" data-mode="${m.key}">${m.label}</button>`).join('')}
        </div>
        <p class="hint">${scheduleHintText(draft.scheduleMode)}</p>
      </div>

      ${showIntervalFields ? `
      <div class="field-row">
        <div class="field">
          <label for="f-interval">Co ile</label>
          <input class="input" id="f-interval" name="interval" type="number" min="1" value="${draft.interval}" style="text-align:center" />
        </div>
        <div class="field">
          <label for="f-unit">Jednostka</label>
          <select class="select" id="f-unit">
            <option value="day" ${draft.unit === 'day' ? 'selected' : ''}>dni</option>
            <option value="week" ${draft.unit === 'week' ? 'selected' : ''}>tygodni</option>
            <option value="month" ${draft.unit === 'month' ? 'selected' : ''}>miesięcy</option>
          </select>
        </div>
      </div>` : ''}

      <div class="field-row">
        <div class="field">
          <label for="f-anchor">${draft.scheduleMode === 'once' ? 'Data' : 'Data początkowa'}</label>
          <input class="input" id="f-anchor" name="anchorDate" type="date" value="${draft.anchorDate}" />
        </div>
        <div class="field">
          <label for="f-time">Godzina (opcjonalnie)</label>
          <input class="input" id="f-time" name="time" type="time" value="${draft.time || ''}" />
        </div>
      </div>

      <div class="field">
        <label for="f-notes">Notatka</label>
        <textarea class="textarea" id="f-notes" name="notes" placeholder="Dodatkowe informacje, wskazówki...">${escapeHtml(draft.notes)}</textarea>
      </div>

      <div class="field">
        <label>Lista punktów (opcjonalnie)</label>
        <div class="checklist-editor" id="checklistEditor">
          ${draft.checklist.map((item, i) => renderChecklistItem(item, i)).join('')}
        </div>
        <button type="button" class="link-btn" style="margin-top:8px" data-action="add-checklist-item">${svgIcon('plus', { size: 16, strokeWidth: 2.2 })}Dodaj punkt checklisty</button>
      </div>

      <div class="field">
        <label>Szac. czas</label>
        <div class="stepper">
          <button type="button" data-action="adjust-minutes" data-delta="-5">–</button>
          <span>${draft.estimatedMinutes} min</span>
          <button type="button" data-action="adjust-minutes" data-delta="5">+</button>
        </div>
      </div>

      <div class="field">
        <label>Wykonawca</label>
        <div class="chip-group">
          ${members.map((m) => {
            const selected = draft.assigneeId === m.id;
            return `<button type="button" class="assignee-chip ${selected ? 'is-selected' : ''}" data-action="select-assignee-chip" data-id="${m.id}"><span class="occ-avatar" style="background:${m.colorHex}">${initials(m.name)}</span>${escapeHtml(m.name)}</button>`;
          }).join('')}
          <button type="button" class="assignee-chip is-unassigned ${!draft.assigneeId ? 'is-selected' : ''}" data-action="select-assignee-chip" data-id="">Nieprzypisane</button>
        </div>
      </div>

      <div class="stack" style="gap:12px">
        <button type="submit" class="btn btn-primary btn-block">Zapisz obowiązek</button>
        ${chore ? `<button type="button" class="btn btn-danger-ghost btn-block" data-action="delete-chore" data-choreid="${chore.id}">Usuń obowiązek</button>` : ''}
      </div>
    </form>
  `;
}

function renderChecklistItem(value, index) {
  return `<div class="checklist-editor-item" data-index="${index}">
    <input class="input" value="${escapeHtml(value)}" data-role="checklist-value" />
    <button type="button" class="icon-btn icon-btn--sm" style="border:none;background:none" data-action="remove-checklist-item" data-index="${index}" aria-label="Usuń punkt">${svgIcon('close', { size: 15, color: 'var(--cp-text-tertiary)' })}</button>
  </div>`;
}

function makeChoreDraft(chore, presetMode) {
  const schedule = chore?.schedule || {
    mode: presetMode || 'fixed', unit: 'day', interval: 1, weekdays: null, anchorDate: dateKey(startOfToday()), time: '',
  };
  return {
    title: chore?.title || '',
    notes: chore?.notes || '',
    scheduleMode: schedule.mode,
    unit: schedule.unit,
    interval: schedule.interval,
    anchorDate: schedule.anchorDate,
    time: schedule.time || '',
    categoryId: chore?.categoryId ?? null,
    assigneeId: chore?.assigneeId ?? null,
    estimatedMinutes: chore?.estimatedMinutes ?? 15,
    checklist: chore?.checklist ? [...chore.checklist] : [],
  };
}

/** Zgrywa bieżące wartości pól tekstowych formularza obowiązku do ui.modal.draft
 * PRZED każdym częściowym re-renderem (klik chipa/segmentu/steppera) — inaczej
 * właśnie wpisywany tekst przepadłby przy regeneracji HTML z draftu. */
function captureChoreFormInputs() {
  if (!ui.modal || ui.modal.type !== 'chore') return;
  const d = ui.modal.draft;
  const title = document.getElementById('f-title');
  const notes = document.getElementById('f-notes');
  const interval = document.getElementById('f-interval');
  const unit = document.getElementById('f-unit');
  const anchor = document.getElementById('f-anchor');
  const time = document.getElementById('f-time');
  const editor = document.getElementById('checklistEditor');
  if (title) d.title = title.value;
  if (notes) d.notes = notes.value;
  if (interval) d.interval = Number(interval.value) || d.interval;
  if (unit) d.unit = unit.value;
  if (anchor) d.anchorDate = anchor.value;
  if (time) d.time = time.value;
  if (editor) d.checklist = [...editor.querySelectorAll('[data-role="checklist-value"]')].map((i) => i.value);
}

// ---------- Modal root ----------

function renderModal() {
  const root = document.getElementById('modalRoot');
  if (!ui.modal) { root.innerHTML = ''; return; }
  let content = '';
  if (ui.modal.type === 'occurrence') content = renderOccurrenceModalContent(ui.modal.choreId, ui.modal.date);
  else if (ui.modal.type === 'chore') content = renderChoreFormContent(ui.modal.choreId, ui.modal.presetMode);
  root.innerHTML = `<div class="modal-overlay" data-action="overlay"><div class="modal">${content}</div></div>`;
}

function openOccurrenceModal(choreId, date) {
  ui.modal = { type: 'occurrence', choreId, date };
  renderModal();
}
function openChoreModal(choreId, presetMode) {
  const chore = choreId ? store.getChore(choreId) : null;
  ui.modal = { type: 'chore', choreId: choreId || null, presetMode, draft: makeChoreDraft(chore, presetMode) };
  renderModal();
}
function closeModal() {
  ui.modal = null;
  renderModal();
}

// ---------- Obsługa zdarzeń (delegacja) ----------

function handleClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  switch (action) {
    case 'overlay':
      if (e.target === el) closeModal();
      return;
    case 'close-modal':
      closeModal();
      return;
    case 'back':
      ui.view = null;
      ui.categoryEditId = null;
      ui.categoryDraft = null;
      render();
      scrollContentTop();
      return;

    // ---- Logowanie ----
    case 'continue-local':
      store.setSession({ mode: 'local' });
      ui.route = 'app';
      render();
      scrollContentTop();
      return;
    case 'continue-google': {
      if (!isGoogleSignInConfigured()) {
        ui.loginGoogleNoteText = 'Logowanie Google wymaga jeszcze skonfigurowania projektu w Google Cloud Console (Faza 2 — patrz README). Na razie kontynuuj lokalnie — dane zostaną na tym urządzeniu.';
        ui.loginGoogleNoteVisible = true;
        render();
        return;
      }
      ui.googleSignInBusy = true;
      ui.loginGoogleNoteVisible = false;
      render();
      signInWithGoogle()
        .then((profile) => {
          store.setSession({ mode: 'google', name: profile.name, email: profile.email, picture: profile.picture });
          linkGoogleIdentityToMember(profile);
          ui.googleSignInBusy = false;
          ui.route = 'app';
          render();
          scrollContentTop();
        })
        .catch((err) => {
          ui.googleSignInBusy = false;
          const code = err?.message || '';
          ui.loginGoogleNoteText = code === 'popup_closed' || code === 'popup_closed_by_user'
            ? 'Okno logowania Google zostało zamknięte przed zakończeniem. Spróbuj ponownie albo kontynuuj lokalnie.'
            : code === 'access_denied'
              ? 'Logowanie Google zostało odrzucone. Spróbuj ponownie albo kontynuuj lokalnie.'
              : 'Nie udało się połączyć z Google (sprawdź internet i czy adres strony jest dodany w Google Cloud Console jako Authorized JavaScript origin). Kontynuuj lokalnie w międzyczasie.';
          ui.loginGoogleNoteVisible = true;
          render();
        });
      return;
    }

    // ---- Konto ----
    case 'open-account':
      ui.view = 'konto';
      render();
      scrollContentTop();
      return;
    case 'open-categories':
      ui.view = 'categories';
      ui.categoryEditId = null;
      ui.categoryDraft = null;
      render();
      scrollContentTop();
      return;
    case 'set-theme':
      store.setThemePreference(el.dataset.value);
      applyTheme();
      render();
      return;
    case 'logout':
      if (confirm('Wylogować się z aplikacji? Zapisane obowiązki zostaną nietknięte.')) {
        store.clearSession();
        ui.route = 'login';
        ui.view = null;
        ui.loginGoogleNoteVisible = false;
        render();
        scrollContentTop();
      }
      return;

    // ---- Kategorie ----
    case 'edit-category':
      ui.categoryEditId = el.dataset.catid;
      ui.categoryDraft = { ...store.getCategory(el.dataset.catid) };
      render();
      return;
    case 'cancel-category-edit':
      ui.categoryEditId = null;
      ui.categoryDraft = null;
      render();
      return;
    case 'pick-category-color':
      captureCategoryNameInput();
      ui.categoryDraft.colorHex = el.dataset.color;
      render();
      return;
    case 'pick-category-icon':
      captureCategoryNameInput();
      ui.categoryDraft.icon = el.dataset.icon;
      render();
      return;
    case 'save-category': {
      captureCategoryNameInput();
      const name = ui.categoryDraft.name.trim();
      if (!name) return;
      store.saveCategory({
        id: ui.categoryEditId || undefined,
        name,
        colorHex: ui.categoryDraft.colorHex,
        icon: ui.categoryDraft.icon,
      });
      ui.categoryEditId = null;
      ui.categoryDraft = null;
      render();
      return;
    }
    case 'delete-category':
      if (confirm('Usunąć tę kategorię? Obowiązki, które jej używają, staną się bez kategorii.')) {
        store.deleteCategory(el.dataset.catid);
        ui.categoryEditId = null;
        ui.categoryDraft = null;
        render();
      }
      return;

    // ---- Obowiązki: filtr ----
    case 'set-chore-filter':
      ui.choreFilter = el.dataset.filter;
      render();
      return;

    // ---- Wystąpienia ----
    case 'open-occurrence':
      openOccurrenceModal(el.dataset.choreid, el.dataset.date);
      return;
    case 'select-day':
      ui.selectedDay = ui.selectedDay === el.dataset.date ? null : el.dataset.date;
      render();
      return;
    case 'toggle-occurrence': {
      const { choreid, date } = el.dataset;
      const chore = store.getChore(choreid);
      const existingOverride = store.getOverride(choreid, date);
      const current = existingOverride?.status || 'pending';
      const newStatus = current === 'done' ? 'pending' : 'done';
      const extra = {};
      // Odhaczasz zadanie przypisane komuś innemu → "przejmujesz" je: liczy się od
      // teraz jako Twoje (i Twoje punkty), zamiast cichego przypisania do wcześniejszej osoby.
      if (newStatus === 'done') {
        const myMemberId = resolveMyMemberId(store.getMembers());
        const effectiveAssignee = existingOverride?.assigneeId ?? chore?.assigneeId ?? null;
        if (myMemberId && effectiveAssignee !== myMemberId) {
          extra.assigneeId = myMemberId;
        }
      }
      store.setOccurrenceStatus(choreid, date, newStatus, extra);
      if (ui.modal?.type === 'occurrence') renderModal();
      render();
      return;
    }
    case 'set-my-member':
      store.setMyMemberId(el.dataset.id);
      render();
      return;
    case 'prev-month':
      ui.monthCursor = addUnits(ui.monthCursor, 'month', -1);
      render();
      return;
    case 'next-month':
      ui.monthCursor = addUnits(ui.monthCursor, 'month', 1);
      render();
      return;
    case 'today-month':
      ui.monthCursor = startOfToday();
      ui.selectedDay = dateKey(startOfToday());
      render();
      return;

    // ---- Formularz obowiązku ----
    case 'new-chore':
      openChoreModal(null);
      return;
    case 'new-once':
      openChoreModal(null, 'once');
      return;
    case 'edit-chore':
      closeModal();
      openChoreModal(el.dataset.choreid);
      return;
    case 'delete-chore':
      if (confirm('Usunąć ten obowiązek na stałe?')) {
        store.deleteChore(el.dataset.choreid);
        closeModal();
        render();
      }
      return;
    case 'select-category':
      captureChoreFormInputs();
      ui.modal.draft.categoryId = el.dataset.catid;
      renderModal();
      return;
    case 'new-category-link':
      closeModal();
      ui.view = 'categories';
      ui.categoryEditId = null;
      ui.categoryDraft = null;
      render();
      scrollContentTop();
      return;
    case 'set-schedule-mode':
      captureChoreFormInputs();
      ui.modal.draft.scheduleMode = el.dataset.mode;
      renderModal();
      return;
    case 'select-assignee-chip':
      captureChoreFormInputs();
      ui.modal.draft.assigneeId = el.dataset.id || null;
      renderModal();
      return;
    case 'adjust-minutes': {
      captureChoreFormInputs();
      const delta = Number(el.dataset.delta);
      ui.modal.draft.estimatedMinutes = Math.max(1, (ui.modal.draft.estimatedMinutes || 15) + delta);
      renderModal();
      return;
    }
    case 'add-checklist-item':
      captureChoreFormInputs();
      ui.modal.draft.checklist.push('');
      renderModal();
      return;
    case 'remove-checklist-item':
      captureChoreFormInputs();
      ui.modal.draft.checklist.splice(Number(el.dataset.index), 1);
      renderModal();
      return;
    case 'submit-chore-form':
      document.getElementById('choreForm').requestSubmit();
      return;

    // ---- Domownicy (przeniesione do ekranu Konto) ----
    case 'add-member':
      store.saveMember({ name: 'Nowy domownik', colorHex: MEMBER_COLORS[store.getMembers().length % MEMBER_COLORS.length] });
      render();
      return;
    case 'recolor-member':
      store.saveMember({ id: el.dataset.memberid, colorHex: el.dataset.color });
      render();
      return;
    case 'delete-member':
      if (confirm('Usunąć tego domownika? Przypisane obowiązki staną się nieprzypisane.')) {
        store.deleteMember(el.dataset.memberid);
        render();
      }
      return;

    case 'reset-demo':
      if (confirm('To usunie wszystkie obecne dane i przywróci przykładowe obowiązki. Kontynuować?')) {
        store.resetAllData();
        render();
      }
      return;
  }
}

/** Zachowuje wpisaną właśnie nazwę kategorii w ui.categoryDraft przed re-renderem
 * wywołanym kliknięciem koloru/ikony (inaczej wpisany tekst by przepadł). */
function captureCategoryNameInput() {
  const nameInput = document.getElementById('catName');
  if (nameInput && ui.categoryDraft) ui.categoryDraft.name = nameInput.value;
}

function handleChange(e) {
  if (e.target.dataset.action === 'rename-member') {
    store.saveMember({ id: e.target.dataset.memberid, name: e.target.value });
  }
  if (e.target.dataset.action === 'reassign') {
    const { choreid, date } = e.target.dataset;
    const status = store.getOverride(choreid, date)?.status || 'pending';
    store.setOccurrenceStatus(choreid, date, status, { assigneeId: e.target.value || null });
    render();
  }
}

function handleSubmit(e) {
  if (e.target.id !== 'choreForm') return;
  e.preventDefault();
  const form = e.target;
  const draft = ui.modal.draft;
  const checklist = [...form.querySelectorAll('[data-role="checklist-value"]')]
    .map((i) => i.value.trim())
    .filter(Boolean);

  const unitField = document.getElementById('f-unit');
  const chore = {
    id: form.dataset.choreid || undefined,
    title: document.getElementById('f-title').value.trim(),
    notes: document.getElementById('f-notes').value.trim(),
    checklist,
    estimatedMinutes: draft.estimatedMinutes,
    categoryId: draft.categoryId || null,
    assigneeId: draft.assigneeId || null,
    frequencyTier: inferFrequencyTier(draft),
    schedule: {
      mode: draft.scheduleMode,
      unit: unitField ? unitField.value : draft.unit,
      interval: Math.max(1, Number(document.getElementById('f-interval')?.value) || draft.interval || 1),
      weekdays: null,
      anchorDate: document.getElementById('f-anchor').value || dateKey(startOfToday()),
      time: document.getElementById('f-time').value || null,
    },
  };
  if (!chore.title) return;
  const existing = form.dataset.choreid ? store.getChore(form.dataset.choreid) : null;
  // Nie zmieniamy kubełka Codzienne/Częste/Rzadkie przy zwykłej edycji istniejącego
  // obowiązku (żeby drobna korekta interwału nie przerzucała go między sekcjami) —
  // chyba że tryb harmonogramu przechodzi w/z "Raz", co zawsze wymusza "once".
  if (draft.scheduleMode === 'once') chore.frequencyTier = 'once';
  else if (existing && existing.frequencyTier && existing.frequencyTier !== 'once') chore.frequencyTier = existing.frequencyTier;
  store.saveChore(chore);
  closeModal();
  render();
}

/** Dla nowych obowiązków: sensowne domyślne "wiaderko" (Codzienne/Częste/Rzadkie) na
 * podstawie trybu harmonogramu — użytkownik może to później dostroić edytując interwał. */
function inferFrequencyTier(draft) {
  if (draft.scheduleMode === 'once') return 'once';
  if (draft.scheduleMode === 'rolling') return 'rare';
  if (draft.unit === 'day' && draft.interval <= 1) return 'daily';
  return 'frequent';
}

// ---------- Init ----------

function init() {
  store.ensureDemoData();
  applyTheme();
  watchSystemTheme();

  ui.route = store.getSession() ? 'app' : 'login';

  document.getElementById('tabbar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    ui.tab = btn.dataset.tab;
    ui.selectedDay = null;
    render();
    scrollContentTop();
  });

  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  document.addEventListener('submit', handleSubmit);

  render();
}

init();
