// app.js — kontroler aplikacji: routing widoków, render, obsługa zdarzeń.
// Vanilla JS. Ionic (web components) zostaje tylko jako <ion-app>/<ion-content>
// (przewijalny kontener) — cały pozostały chrome (tab bar, karty, formularze,
// modal) to własny markup, przeniesiony 1:1 ze statycznego podglądu wizualnego
// (Claude Design canvas, Kierunek A — patrz architektura projektu).

import * as store from './storage.js';
import {
  dateKey, parseDateKey, addUnits, generateAllOccurrences, generateOccurrencesInRange, monthGridRange, monthRange,
  nextOccurrenceDate,
} from './recurrence.js';
import { computeDashboardStats, isVacationDay } from './gamification.js';
import { svgIcon, googleLogoSvg, CATEGORY_ICON_CHOICES } from './icons.js';
import { signInWithGoogle, isGoogleSignInConfigured } from './google-auth.js';
import * as calendarSync from './calendar-sync.js';

// ---------- Stałe i pomocnicze formatery ----------

const WEEKDAYS_SHORT = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const WEEKDAYS_LONG = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const MONTHS_NOM = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
// Numery dni jak Date.getDay() (0 = niedziela), w kolejności wyświetlania od poniedziałku.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS_PLURAL = { 1: 'poniedziałki', 2: 'wtorki', 3: 'środy', 4: 'czwartki', 5: 'piątki', 6: 'soboty', 0: 'niedziele' };
const WEEKDAYS_ABBR = { 1: 'pn', 2: 'wt', 3: 'śr', 4: 'cz', 5: 'pt', 6: 'sb', 0: 'nd' };
// Presety częstotliwości w formularzu obowiązku — "Własne…" odsłania pola liczba + jednostka.
const SCHEDULE_PRESETS = [
  { key: 'daily', label: 'Codziennie', unit: 'day', interval: 1 },
  { key: 'weekly', label: 'Co tydzień', unit: 'week', interval: 1 },
  { key: 'biweekly', label: 'Co 2 tygodnie', unit: 'week', interval: 2 },
  { key: 'monthly', label: 'Co miesiąc', unit: 'month', interval: 1 },
  { key: 'once', label: 'Raz' },
  { key: 'custom', label: 'Własne…' },
];
const MINUTE_CHOICES = [5, 10, 15, 30, 45, 60];
// Jak daleko wstecz szukamy niewykonanych wystąpień. Zaległości są grupowane per
// obowiązek, więc dłuższe okno nie zaśmieca listy — jedynie "od ilu dni" jest dokładniejsze.
const OVERDUE_LOOKBACK_DAYS = 90;
const RESET_CONFIRM_WORD = 'USUŃ';
const MEMBER_COLORS = ['#4C6B57', '#B45309', '#3B7DD8', '#7A5C9E', '#C0703A', '#6B7280'];
const CATEGORY_COLOR_PALETTE = ['#3B7DD8', '#6B7280', '#C0703A', '#7A5C9E', '#4C6B57', '#A6862F', '#2D9CB0', '#C97A9E'];

/** Polska odmiana liczebników: plural(5, 'zadanie', 'zadania', 'zadań') → "zadań". */
function plural(n, one, few, many) {
  if (n === 1) return one;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
  return many;
}

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

// Dopasowanie zalogowanego konta Google do konkretnego domownika (store.claimMemberForIdentity)
// — logika przeniesiona do storage.js, bo calendar-sync.js musi móc wywołać ją PONOWNIE
// po ściągnięciu współdzielonego katalogu z kalendarza (patrz komentarz przy tej funkcji
// w storage.js), a nie tylko raz, zaraz po zalogowaniu.

function formatDayHeading(date, today) {
  if (sameDay(date, today)) return 'Dziś';
  if (sameDay(date, addUnits(today, 'day', 1))) return 'Jutro';
  return `${WEEKDAYS_LONG[(date.getDay() + 6) % 7]}, ${date.getDate()} ${MONTHS_GEN[date.getMonth()]}`;
}

function formatFullDate(date) {
  return `${WEEKDAYS_LONG[(date.getDay() + 6) % 7]}, ${date.getDate()} ${MONTHS_GEN[date.getMonth()]} ${date.getFullYear()}`;
}

/** Krótki opis harmonogramu do plakietki, np. "codz.", "co 2 dni", "pn, cz", "raz, 20 września". */
function describeScheduleShort(schedule) {
  if (schedule.mode === 'once') {
    const d = parseDateKey(schedule.anchorDate);
    return `raz, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
  }
  const n = schedule.interval;
  if (schedule.unit === 'week' && schedule.weekdays?.length && schedule.mode !== 'rolling') {
    const days = WEEKDAY_ORDER.filter((d) => schedule.weekdays.includes(d)).map((d) => WEEKDAYS_ABBR[d]).join(', ');
    return n === 1 ? days : `${days} co ${n} tyg.`;
  }
  if (n === 1) {
    if (schedule.unit === 'day') return 'codz.';
    if (schedule.unit === 'week') return 'co tydz.';
    if (schedule.unit === 'month') return 'co mies.';
  }
  const unitShort = { day: 'dni', week: 'tyg.', month: 'mies.' }[schedule.unit];
  return `co ${n} ${unitShort}`;
}

/** "co 2 tygodnie", "co 5 dni", "codziennie", "co miesiąc". */
function describeInterval(unit, n) {
  if (n === 1) return { day: 'codziennie', week: 'co tydzień', month: 'co miesiąc' }[unit];
  const words = {
    day: ['dzień', 'dni', 'dni'],
    week: ['tydzień', 'tygodnie', 'tygodni'],
    month: ['miesiąc', 'miesiące', 'miesięcy'],
  }[unit];
  return `co ${n} ${plural(n, ...words)}`;
}

/** Odstęp "po wykonaniu": "3 miesiące", "2 tygodnie", "1 dzień". */
function describeSpan(unit, n) {
  const words = {
    day: ['dzień', 'dni', 'dni'],
    week: ['tydzień', 'tygodnie', 'tygodni'],
    month: ['miesiąc', 'miesiące', 'miesięcy'],
  }[unit];
  return `${n} ${plural(n, ...words)}`;
}

function joinWithAnd(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} i ${items[items.length - 1]}`;
}

/** "dziś", "jutro", "czwartek, 2 października" — do zdań w tekście. */
function formatDateInline(date, today) {
  if (sameDay(date, today)) return 'dziś';
  if (sameDay(date, addUnits(today, 'day', 1))) return 'jutro';
  const year = date.getFullYear() !== today.getFullYear() ? ` ${date.getFullYear()}` : '';
  return `${WEEKDAYS_LONG[(date.getDay() + 6) % 7]}, ${date.getDate()} ${MONTHS_GEN[date.getMonth()]}${year}`;
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

function categoryBadge(category, schedule, { withName = true } = {}) {
  const scheduleText = describeScheduleShort(schedule);
  if (!category) {
    return `<span class="cat-badge-uncategorized">${withName ? 'Bez pomieszczenia · ' : ''}${scheduleText}</span>`;
  }
  const fg = categoryFg(category.colorHex);
  return `<span class="cat-badge" style="background:${hexToRgba(category.colorHex, tintAlpha())};color:${fg}">${withName ? `${escapeHtml(category.name)} · ` : ''}${scheduleText}</span>`;
}

// ---------- Stan UI (nie dane — te zawsze czytane ze storage) ----------

const ui = {
  route: 'login', // 'login' | 'app' — ustalane w init() na podstawie store.getSession()
  tab: 'dashboard', // dashboard | month | chores (zakładki dolnego paska)
  view: null, // null | 'categories' | 'templates' | 'konto' — pełnoekranowe widoki "pushed" (bez tab bara)
  monthCursor: startOfToday(),
  selectedDay: null,
  modal: null, // { type: 'occurrence'|'chore', ..., draft: {...} }
  categoryEditId: null, // id edytowanego pomieszczenia w widoku Kategorie/Pomieszczenia (null = tryb "nowa")
  categoryDraft: null, // { name, colorHex, icon, builtIn? } — stan roboczy kreatora/edytora pomieszczenia
  templateEditId: null, // id edytowanego szablonu w widoku Szablony (null = tryb "nowy")
  templateDraft: null, // stan roboczy kreatora/edytora szablonu — patrz makeTemplateDraft()
  loginGoogleNoteVisible: false,
  loginGoogleNoteText: 'Logowanie Google wymaga jeszcze skonfigurowania projektu w Google Cloud Console (Faza 2 — patrz README). Na razie kontynuuj lokalnie — dane zostaną na tym urządzeniu.',
  googleSignInBusy: false, // true w trakcie okna zgody Google (blokuje podwójne kliknięcie)
  choreFilter: 'all', // 'all' | 'mine' | 'unassigned' | <id domownika> (filtr wykonawcy w Obowiązkach)
  statsExpanded: false, // rozwinięty panel statystyk/poziomu na Start
  justResolvedKey: null, // "choreId|YYYY-MM-DD" właśnie odhaczonego wystąpienia — jednorazowa animacja
  toastUndo: null, // funkcja cofająca ostatnią akcję z toastu
  resetConfirmOpen: false, // rozwinięte potwierdzenie "Usuń wszystkie dane" w Koncie
  syncStatus: 'idle', // 'idle' | 'syncing' | 'ok' | 'error' (synchronizacja z Google Calendar, Faza 2 krok 2)
  syncMessage: '',
  syncedAt: null,
  calendarIdDraft: null, // stan roboczy pola "ID kalendarza" w Koncie, dopóki nieedytowane: null
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
  } else if (ui.view === 'templates') {
    html = renderTemplatesView();
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

/** Wiersz wystąpienia: kółko po lewej to osobny przycisk (odhacza jednym tapnięciem),
 * reszta wiersza otwiera szczegóły. `overdueSince` (Date) — gdy wiersz reprezentuje
 * zgrupowane zaległości obowiązku, od najstarszego niewykonanego terminu. */
function renderOccurrenceRow(entry, chores, members, { overdueSince = null } = {}) {
  const chore = chores.find((c) => c.id === entry.choreId);
  if (!chore) return '';
  const assigneeId = entry.override?.assigneeId ?? chore.assigneeId;
  const member = members.find((m) => m.id === assigneeId);
  const isDone = entry.status === 'done';
  const isSkipped = entry.status === 'skipped';
  const isClosed = isDone || isSkipped;
  const today = startOfToday();
  const isOverdue = !isClosed && entry.date.getTime() < today.getTime();
  const justResolved = ui.justResolvedKey === `${chore.id}|${entry.key}`;

  let overdueBadge = '';
  if (isOverdue) {
    const since = overdueSince || entry.date;
    const days = Math.round((today - since) / 86400000);
    overdueBadge = `<span class="badge-overdue">Zaległe ${days <= 1 ? 'od wczoraj' : `od ${days} dni`}</span>`;
  }

  const checkLabel = isDone
    ? `Cofnij wykonanie: ${chore.title}`
    : isSkipped ? `Przywróć pominięte: ${chore.title}` : `Oznacz jako wykonane: ${chore.title}`;
  const checkIcon = isDone
    ? svgIcon('check', { size: 14, color: 'currentColor', strokeWidth: 3 })
    : isSkipped ? svgIcon('skip', { size: 12, color: 'currentColor', strokeWidth: 2.4 }) : '';

  return `
    <div class="occ-row ${isDone ? 'is-done' : ''} ${isSkipped ? 'is-skipped' : ''} ${justResolved ? 'is-just-resolved' : ''}">
      <button type="button" class="occ-check-btn" data-action="quick-toggle" data-choreid="${chore.id}" data-date="${entry.key}" aria-label="${escapeHtml(checkLabel)}" aria-pressed="${isClosed}">
        <span class="occ-check">${checkIcon}</span>
      </button>
      <button type="button" class="occ-main" data-action="open-occurrence" data-choreid="${chore.id}" data-date="${entry.key}">
        <span class="spacer">
          <span class="occ-title">${escapeHtml(chore.title)}</span>
          <span class="occ-meta">
            ${overdueBadge}
            ${isSkipped ? '<span class="badge-skipped">Pominięte</span>' : ''}
            ${member
              ? `<span class="row" style="gap:6px"><span class="occ-avatar" style="background:${member.colorHex}">${initials(member.name)}</span>${escapeHtml(member.name)} · ${chore.estimatedMinutes} min</span>`
              : `<span>Nieprzypisane · ${chore.estimatedMinutes} min</span>`}
          </span>
        </span>
        ${!isClosed ? `<span class="occ-chevron">${svgIcon('chevron-right', { size: 16 })}</span>` : ''}
      </button>
    </div>`;
}

/** Zaległe wystąpienia pogrupowane per obowiązek: jeden wpis na obowiązek, z najnowszym
 * zaległym terminem (to on jest odhaczany) i datą najstarszego niewykonanego. */
function groupOverdue(entries, today, vacations) {
  const groups = new Map();
  for (const e of entries) {
    if (e.date.getTime() >= today.getTime() || e.status !== 'pending' || isVacationDay(e.date, vacations)) continue;
    const g = groups.get(e.choreId);
    if (!g) groups.set(e.choreId, { latest: e, since: e.date, count: 1 });
    else {
      g.count++;
      if (e.date > g.latest.date) g.latest = e;
      if (e.date < g.since) g.since = e.date;
    }
  }
  return [...groups.values()].sort((a, b) => a.since - b.since);
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
  const vacations = store.getVacations();
  const stats = computeDashboardStats(chores, overrides, store.getOverride, myMemberId, vacations);

  const today = startOfToday();
  const rangeStart = addUnits(today, 'day', -OVERDUE_LOOKBACK_DAYS);
  const rangeEnd = addUnits(today, 'day', 3);
  const occurrences = generateAllOccurrences(chores, rangeStart, rangeEnd);
  const entries = buildOccurrenceEntries(occurrences);

  const overdueGroups = groupOverdue(entries, today, vacations);
  const todayList = entries.filter((e) => sameDay(e.date, today));
  const upcoming = entries.filter((e) => e.date.getTime() > today.getTime());
  const todayCounted = todayList.filter((e) => e.status !== 'skipped');
  const todayDoneCount = todayCounted.filter((e) => e.status === 'done').length;
  const activeVacation = store.getActiveVacation(dateKey(today));

  const weekPct = stats.weekTotal > 0 ? Math.round((stats.weekDone / stats.weekTotal) * 100) : 100;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Dzień dobry' : hour < 18 ? 'Cześć' : 'Dobry wieczór';

  const meMember = members.find((m) => m.id === myMemberId);
  const meLabel = initials(meMember?.name || 'JA');

  const level = stats.level;
  const nextMin = level.next ? level.next.min : null;
  const levelPct = nextMin ? Math.max(4, Math.min(100, Math.round(((stats.points - level.min) / (nextMin - level.min)) * 100))) : 100;
  const levelPointsLabel = nextMin ? `${stats.points} / ${nextMin} pkt` : `${stats.points} pkt · najwyższy poziom!`;
  const streakDays = `${stats.streak} ${plural(stats.streak, 'dzień', 'dni', 'dni')}`;

  let html = `
    <div class="view">
      <div class="hero-row">
        <div>
          <h1 class="hero-title">${greeting}!</h1>
          <p class="hero-sub">${formatFullDate(today)}</p>
        </div>
        <div class="row" style="gap:10px">
          <button type="button" class="fab-btn" data-action="new-chore" aria-label="Dodaj obowiązek">${svgIcon('plus', { size: 20, strokeWidth: 2.2 })}</button>
          <button type="button" class="account-fab" data-action="open-account" aria-label="Konto">${meLabel}</button>
        </div>
      </div>

      ${activeVacation ? `
      <div class="vacation-banner">
        ${svgIcon('sun', { size: 20, color: 'currentColor' })}
        <span class="spacer">Tryb urlopowy${activeVacation.until ? ` do ${formatDateInline(parseDateKey(activeVacation.until), today)}` : ''} — zaległości i passa czekają.</span>
        <button type="button" class="link-btn" data-action="end-vacation">Wyłącz</button>
      </div>` : ''}

      <div class="stats-summary">
        <button type="button" class="stats-bar" data-action="toggle-stats" aria-expanded="${ui.statsExpanded}" aria-controls="statsPanel">
          <span class="stats-bar-item">${progressRing(todayDoneCount, todayCounted.length, 22)}<b>${todayDoneCount}/${todayCounted.length}</b> dziś</span>
          <span class="stats-bar-item stat-icon-streak-fg">${svgIcon('flame', { size: 16, color: 'currentColor' })}<b>${streakDays}</b></span>
          <span class="stats-bar-item stat-icon-points-fg">${svgIcon('starburst', { size: 16, color: 'currentColor' })}<b>${stats.points}</b> pkt</span>
          <span class="stats-bar-chevron">${svgIcon('chevron-down', { size: 16 })}</span>
        </button>
        <div id="statsPanel" class="stats-panel" ${ui.statsExpanded ? '' : 'hidden'}>
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
          <div class="stats-grid">
            <div class="stat-card stat-card--today">
              ${progressRing(todayDoneCount, todayCounted.length)}
              <div><div class="stat-value">${todayDoneCount}/${todayCounted.length}</div><div class="stat-label">wykonane dziś</div></div>
            </div>
            <div class="stat-card stat-card--streak">
              <div class="stat-card-icon stat-icon-streak">${svgIcon('flame', { size: 22, color: 'currentColor' })}</div>
              <div><div class="stat-value">${stats.streak}</div><div class="stat-label">${plural(stats.streak, 'dzień', 'dni', 'dni')} passy domu</div></div>
            </div>
            <div class="stat-card stat-card--points">
              <div class="stat-card-icon stat-icon-points">${svgIcon('starburst', { size: 22, color: 'currentColor' })}</div>
              <div><div class="stat-value">${stats.points}</div><div class="stat-label">Twoje punkty</div></div>
            </div>
            <div class="stat-card stat-card--week">
              <div class="stat-card-icon stat-icon-week">${svgIcon('trending-up', { size: 22, color: 'currentColor' })}</div>
              <div><div class="stat-value">${weekPct}%</div><div class="stat-label">wykonane w tym tygodniu</div></div>
            </div>
          </div>
        </div>
      </div>
  `;

  if (overdueGroups.length > 0) {
    html += `<div class="section">
      <div class="row-between"><h2 class="section-label" style="color:var(--cp-danger)">Zaległe</h2><span class="text-secondary text-sm">${overdueGroups.length}</span></div>
      <div class="stack">${overdueGroups.map((g) => renderOccurrenceRow(g.latest, chores, members, { overdueSince: g.since })).join('')}</div>
    </div>`;
  }

  let todayEmpty = '';
  if (todayList.length === 0) {
    const next = upcoming.find((e) => e.status === 'pending');
    const nextChore = next && chores.find((c) => c.id === next.choreId);
    todayEmpty = nextChore
      ? `<p class="empty-note">Wolne. Następne: ${escapeHtml(nextChore.title.toLowerCase())}, ${formatDateInline(next.date, today)}.</p>`
      : '<p class="empty-note">Wolne — na dziś nic nie zaplanowano.</p>';
  } else if (todayList.every((e) => e.status !== 'pending')) {
    todayEmpty = '<p class="empty-note">Wszystko na dziś zrobione.</p>';
  }

  html += `<div class="section">
    <div class="row-between"><h2 class="section-label">Dziś</h2><div style="font-size:12.5px;font-weight:700;color:var(--cp-accent)">${todayCounted.length ? `${todayDoneCount} z ${todayCounted.length}` : ''}</div></div>
    <div class="stack">${todayList.map((e) => renderOccurrenceRow(e, chores, members)).join('')}${todayEmpty}</div>
  </div>`;

  if (upcoming.length > 0) {
    html += `<div class="section">
      <h2 class="section-label">Najbliższe dni</h2>
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
      <p class="text-secondary" style="margin-top:8px">Wybierz kilka gotowych obowiązków dla swoich pomieszczeń albo dodaj własny.</p>
      <div class="stack" style="margin-top:20px">
        <button type="button" class="btn btn-primary btn-block" data-action="open-template-picker" data-multi="1">${svgIcon('list', { size: 18 })}Zacznij od gotowego zestawu</button>
        <button type="button" class="btn btn-outline btn-block" data-action="new-chore-blank">${svgIcon('plus', { size: 18 })}Dodaj własny obowiązek</button>
      </div>
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
      <div class="row-between"><div class="section-label">${formatDayHeading(date, today)}, ${date.getDate()} ${MONTHS_GEN[date.getMonth()]}</div><div style="font-size:12.5px;font-weight:700;color:var(--cp-accent)">${dayOccs.length} ${plural(dayOccs.length, 'zadanie', 'zadania', 'zadań')}</div></div>
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
  const members = store.getMembers();
  const myMemberId = resolveMyMemberId(members);

  // Filtr po wykonawcy — pojęcia z życia ("Moje", imię domownika), nie z modelu danych.
  const filters = [{ key: 'all', label: 'Wszystkie' }];
  if (myMemberId) filters.push({ key: 'mine', label: 'Moje' });
  for (const m of members) if (m.id !== myMemberId) filters.push({ key: m.id, label: m.name });
  filters.push({ key: 'unassigned', label: 'Nieprzypisane' });
  if (!filters.some((f) => f.key === ui.choreFilter)) ui.choreFilter = 'all';

  const matchesFilter = (c) => {
    if (ui.choreFilter === 'all') return true;
    if (ui.choreFilter === 'mine') return c.assigneeId === myMemberId;
    if (ui.choreFilter === 'unassigned') return !c.assigneeId || !members.some((m) => m.id === c.assigneeId);
    return c.assigneeId === ui.choreFilter;
  };
  const filtered = chores.filter(matchesFilter);
  const active = filtered.filter((c) => c.active !== false);
  const paused = filtered.filter((c) => c.active === false);

  // Grupy wg pomieszczeń, w kolejności z listy Pomieszczeń; na końcu obowiązki bez
  // pomieszczenia (także te wskazujące na usunięte) i wstrzymane.
  const groups = categories
    .map((cat) => ({ category: cat, label: cat.name, items: active.filter((c) => c.categoryId === cat.id) }))
    .filter((g) => g.items.length);
  const noRoom = active.filter((c) => !categories.some((cat) => cat.id === c.categoryId));
  if (noRoom.length) groups.push({ category: null, label: 'Bez pomieszczenia', items: noRoom });

  let choresHtml = groups.map((g) => `<div class="section">
      <h2 class="section-label">${escapeHtml(g.label)}</h2>
      <div class="stack">${g.items.map((chore) => renderChoreCard(chore, members)).join('')}</div>
    </div>`).join('');
  if (paused.length) {
    choresHtml += `<div class="section">
      <h2 class="section-label">Wstrzymane</h2>
      <div class="stack">${paused.map((chore) => renderChoreCard(chore, members)).join('')}</div>
    </div>`;
  }
  if (filtered.length === 0) {
    choresHtml = chores.length === 0
      ? '<p class="empty-note">Brak obowiązków — dodaj pierwszy przyciskiem „+”.</p>'
      : '<p class="empty-note">Nikt nie ma tu przypisanych obowiązków.</p>';
  }

  return `
    <div class="view">
      <div class="view-header-fab">
        <div>
          <h1 style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Obowiązki</h1>
          <p class="text-sm text-secondary" style="margin-top:4px">${chores.length} ${plural(chores.length, 'obowiązek', 'obowiązki', 'obowiązków')} · ${members.length} ${plural(members.length, 'domownik', 'domowników', 'domowników')}</p>
        </div>
        <button type="button" class="fab-btn" data-action="new-chore" aria-label="Dodaj obowiązek">${svgIcon('plus', { size: 20, strokeWidth: 2.2 })}</button>
      </div>

      <div class="filter-pills" role="group" aria-label="Pokaż obowiązki">
        ${filters.map((f) => `<button type="button" class="filter-pill ${ui.choreFilter === f.key ? 'is-active' : ''}" aria-pressed="${ui.choreFilter === f.key}" data-action="set-chore-filter" data-filter="${escapeHtml(f.key)}">${escapeHtml(f.label)}</button>`).join('')}
      </div>

      ${choresHtml}
    </div>
  `;
}

function renderChoreCard(chore, members) {
  const category = getCategoryOrFallback(chore.categoryId);
  const member = members.find((m) => m.id === chore.assigneeId);
  const isPaused = chore.active === false;
  return `
    <button type="button" class="chore-row ${isPaused ? 'is-inactive' : ''}" data-action="edit-chore" data-choreid="${chore.id}">
      ${categoryIconChip(category, 44)}
      <span class="spacer">
        <span class="chore-title">${escapeHtml(chore.title)}</span>
        <span class="chore-meta">
          ${isPaused ? '<span class="badge-paused">Wstrzymany</span>' : categoryBadge(category, chore.schedule, { withName: false })}
          ${member ? `<span class="row" style="gap:5px"><span class="occ-avatar" style="background:${member.colorHex}">${initials(member.name)}</span>${escapeHtml(member.name)}</span>` : ''}
          <span>${chore.estimatedMinutes} min</span>
        </span>
      </span>
      <span class="occ-chevron">${svgIcon('chevron-right', { size: 16 })}</span>
    </button>`;
}

// ---------- Widok: Pomieszczenia (dawniej "Kategorie" — patrz storage.js, 28.09.2026) ----------

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
          <h1 style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Pomieszczenia</h1>
          <p class="text-sm text-secondary" style="margin-top:2px">Kolor i ikona rozpoznawalne w całej appce</p>
        </div>
      </div>

      <div class="section">
        <div class="section-label">${categories.length} ${categories.length === 1 ? 'pomieszczenie' : 'pomieszczeń'}</div>
        <div class="stack">${legendHtml}</div>
      </div>

      <div class="section">
        <div class="row-between">
          <div class="section-label">${editing ? 'Edycja pomieszczenia' : 'Nowe pomieszczenie'}</div>
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
            <input type="text" class="input" id="catName" value="${escapeHtml(draft.name)}" placeholder="np. Balkon" ${draft.builtIn ? 'disabled' : ''}>
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

          <button type="button" class="btn btn-primary btn-block" data-action="save-category">${editing ? 'Zapisz zmiany' : 'Dodaj pomieszczenie'}</button>
          ${editing && !draft.builtIn ? `<button type="button" class="btn btn-danger-ghost btn-block" data-action="delete-category" data-catid="${draft.id}">Usuń pomieszczenie</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ---------- Widok: Szablony obowiązków (dodane 28.09.2026, na życzenie użytkownika) ----------
// Biblioteka gotowych, wstępnie skonfigurowanych obowiązków pogrupowana wg pomieszczenia
// (patrz storage.js) — "Zastosuj" otwiera zwykły formularz dodawania obowiązku
// (renderChoreFormContent), wstępnie wypełniony danymi szablonu, żeby użytkownik mógł
// dostosować wykonawcę/datę startową przed zapisaniem (patrz makeDraftFromTemplate niżej;
// to była jego wyraźna preferencja — szablon nie tworzy obowiązku "w ciemno").

function renderTemplatesView() {
  const templates = store.getTemplates();
  const categories = store.getCategories();
  const editing = !!ui.templateEditId;
  if (!ui.templateDraft) {
    ui.templateDraft = editing
      ? makeTemplateDraft(templates.find((t) => t.id === ui.templateEditId))
      : makeTemplateDraft(null);
  }
  const draft = ui.templateDraft;

  const groups = categories
    .map((cat) => ({ category: cat, items: templates.filter((t) => t.categoryId === cat.id) }))
    .filter((g) => g.items.length > 0);
  const orphaned = templates.filter((t) => !categories.some((c) => c.id === t.categoryId));
  if (orphaned.length) groups.push({ category: null, items: orphaned });

  const groupsHtml = groups.map((g) => `
    <div class="section-label" style="margin-top:4px">${g.category ? escapeHtml(g.category.name) : 'Bez pomieszczenia'}</div>
    <div class="stack" style="margin-bottom:16px">
      ${g.items.map((t) => templateRow(t, g.category)).join('')}
    </div>`).join('');

  return `
    <div class="view view--sheet-like">
      <div class="row">
        <button type="button" class="icon-btn icon-btn--sm" data-action="back" aria-label="Wróć">${svgIcon('chevron-left', { size: 16, strokeWidth: 2 })}</button>
        <div>
          <h1 style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Szablony obowiązków</h1>
          <p class="text-sm text-secondary" style="margin-top:2px">Gotowe obowiązki do szybkiego dodania, wg pomieszczeń</p>
        </div>
      </div>

      <div class="section">
        ${templates.length ? groupsHtml : '<p class="hint">Brak szablonów — dodaj pierwszy poniżej.</p>'}
      </div>

      <div class="section">
        <div class="row-between">
          <div class="section-label">${editing ? 'Edycja szablonu' : 'Nowy szablon'}</div>
          ${editing ? '<button type="button" class="link-btn" data-action="cancel-template-edit">Anuluj</button>' : ''}
        </div>

        <div class="category-creator">
          <div class="field">
            <label for="tplTitle">Nazwa</label>
            <input type="text" class="input" id="tplTitle" value="${escapeHtml(draft.title)}" placeholder="np. Mycie podłogi">
          </div>

          <div class="field">
            <label>Pomieszczenie</label>
            <div class="chip-group">
              ${categories.map((cat) => {
                const selected = draft.categoryId === cat.id;
                return `<button type="button" class="chip ${selected ? 'is-selected' : ''}" style="${selected ? `background:${cat.colorHex}` : ''}" data-action="select-template-category" data-catid="${cat.id}">${svgIcon(cat.icon, { size: 14, color: selected ? 'currentColor' : categoryFg(cat.colorHex) })}${escapeHtml(cat.name)}</button>`;
              }).join('')}
            </div>
          </div>

          <div class="field">
            <label>Częstotliwość</label>
            <div class="segmented-3">
              <button type="button" class="${draft.scheduleMode === 'fixed' ? 'is-active' : ''}" data-action="set-template-mode" data-mode="fixed">Stały rytm</button>
              <button type="button" class="${draft.scheduleMode === 'rolling' ? 'is-active' : ''}" data-action="set-template-mode" data-mode="rolling">Od wykonania</button>
            </div>
            <p class="hint">${draft.scheduleMode === 'rolling' ? 'Kolejny termin liczony od dnia oznaczenia jako wykonane — dobre dla rzadkich obowiązków.' : 'Stały rytm kalendarzowy, niezależny od wykonania.'}</p>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="tplInterval">Co ile</label>
              <input class="input" id="tplInterval" type="number" min="1" value="${draft.interval}" style="text-align:center">
            </div>
            <div class="field">
              <label for="tplUnit">Jednostka</label>
              <select class="select" id="tplUnit">
                <option value="day" ${draft.unit === 'day' ? 'selected' : ''}>dni</option>
                <option value="week" ${draft.unit === 'week' ? 'selected' : ''}>tygodni</option>
                <option value="month" ${draft.unit === 'month' ? 'selected' : ''}>miesięcy</option>
              </select>
            </div>
          </div>

          <div class="field">
            <label>Szac. czas</label>
            ${minuteChips(draft.estimatedMinutes, 'set-template-minutes')}
          </div>

          <div class="field">
            <label for="tplNotes">Notatka (opcjonalnie)</label>
            <textarea class="textarea" id="tplNotes" placeholder="Wskazówki widoczne po zastosowaniu szablonu...">${escapeHtml(draft.notes)}</textarea>
          </div>

          <button type="button" class="btn btn-primary btn-block" data-action="save-template">${editing ? 'Zapisz zmiany' : 'Dodaj szablon'}</button>
          ${editing ? `<button type="button" class="btn btn-danger-ghost btn-block" data-action="delete-template" data-tplid="${draft.id}">Usuń szablon</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

/** Chipy szacowanego czasu (5 · 10 · 15 · 30 · 45 · 60+ min). Wartość spoza listy
 * (np. 20 min z szablonu) dostaje własny, zaznaczony chip, żeby nie zginęła po cichu. */
function minuteChips(value, action) {
  const choices = MINUTE_CHOICES.includes(value) || !value ? MINUTE_CHOICES : [...MINUTE_CHOICES, value].sort((a, b) => a - b);
  return `<div class="chip-group" role="group" aria-label="Szacowany czas">
    ${choices.map((m) => {
      const label = m === 60 ? '60+ min' : `${m} min`;
      return `<button type="button" class="chip ${m === value ? 'is-selected is-accent' : ''}" aria-pressed="${m === value}" data-action="${action}" data-minutes="${m}">${label}</button>`;
    }).join('')}
  </div>`;
}

function templateRow(t, category) {
  return `
    <div class="chore-row">
      <button type="button" class="row spacer" style="border:none;background:none;text-align:left;padding:0;cursor:pointer;color:inherit;font-family:inherit" data-action="edit-template" data-tplid="${t.id}">
        ${categoryIconChip(category, 44)}
        <span class="spacer">
          <span class="chore-title">${escapeHtml(t.title)}</span>
          <span class="chore-meta"><span>${describeScheduleShort(t.schedule)}</span><span>${t.estimatedMinutes} min</span></span>
        </span>
      </button>
      <button type="button" class="btn btn-outline" style="flex-shrink:0;padding:8px 14px;font-size:13px;white-space:nowrap" data-action="apply-template" data-tplid="${t.id}">Zastosuj</button>
    </div>`;
}

function makeTemplateDraft(template) {
  return {
    id: template?.id || null,
    title: template?.title || '',
    categoryId: template?.categoryId || store.getCategories()[0]?.id || null,
    scheduleMode: template?.schedule?.mode || 'fixed',
    unit: template?.schedule?.unit || 'day',
    interval: template?.schedule?.interval || 1,
    estimatedMinutes: template?.estimatedMinutes ?? 15,
    notes: template?.notes || '',
  };
}

/** Jak captureChoreFormInputs, ale dla formularza szablonu (patrz ten komentarz przy
 * captureChoreFormInputs — ten sam powód: zachować właśnie wpisywany tekst przed
 * częściowym re-renderem wywołanym kliknięciem chipa/segmentu/steppera). */
function captureTemplateFormInputs() {
  if (!ui.templateDraft) return;
  const d = ui.templateDraft;
  const title = document.getElementById('tplTitle');
  const interval = document.getElementById('tplInterval');
  const unit = document.getElementById('tplUnit');
  const notes = document.getElementById('tplNotes');
  if (title) d.title = title.value;
  if (interval) d.interval = Number(interval.value) || d.interval;
  if (unit) d.unit = unit.value;
  if (notes) d.notes = notes.value;
}

/** Buduje draft formularza obowiązku z szablonu — patrz makeChoreDraft(). Data
 * początkowa jest zawsze "dziś" (szablon sam z siebie nie ma jednej konkretnej daty)
 * i wykonawca zaczyna jako "Nieprzypisane", żeby użytkownik świadomie go wybrał. */
function makeDraftFromTemplate(template) {
  const chore = {
    title: template.title,
    notes: template.notes,
    categoryId: template.categoryId,
    assigneeId: null,
    estimatedMinutes: template.estimatedMinutes,
    checklist: template.checklist || [],
    schedule: { ...template.schedule, anchorDate: dateKey(startOfToday()), time: '' },
  };
  return makeChoreDraft(chore, null);
}

function openChoreModalFromTemplate(templateId) {
  const template = store.getTemplates().find((t) => t.id === templateId);
  if (!template) return;
  ui.modal = { type: 'chore', choreId: null, presetMode: null, draft: makeDraftFromTemplate(template) };
  renderModal();
}

// ---------- Widok: Konto ----------

/** Sekcja "Kalendarz" w Koncie — konfiguracja ID współdzielonego kalendarza Google
 * i status synchronizacji (Faza 2, krok 2). Bez logowania przez Google nieaktywna —
 * synchronizacja wymaga zakresu Calendar, który appka prosi dopiero przy logowaniu
 * Google (patrz google-auth.js). */
function renderCalendarSyncSection(isGoogle) {
  if (!isGoogle) {
    return `
      <div class="status-row">
        ${categoryIconChip({ colorHex: '#6B7280', icon: 'calendar' }, 40)}
        <div class="spacer">
          <div style="font-size:14.5px;font-weight:700">Brak połączenia</div>
          <div class="row" style="gap:6px;margin-top:2px">
            <span class="status-dot is-pending"></span>
            <span class="text-sm text-secondary">Zaloguj się przez Google, żeby podłączyć wspólny kalendarz</span>
          </div>
        </div>
      </div>`;
  }

  const calendarId = store.getCalendarId();
  const editing = ui.calendarIdDraft !== null;

  if (!calendarId || editing) {
    return `
      <div class="stack" style="gap:8px">
        <label class="field-label" for="calendarIdInput">ID kalendarza Google</label>
        <input id="calendarIdInput" type="text" placeholder="np. abc123@group.calendar.google.com"
          value="${escapeHtml(ui.calendarIdDraft ?? '')}" data-action="save-calendar-id" />
        <p class="hint" style="margin:0">Znajdziesz je w Google Calendar: Ustawienia → wybierz kalendarz (np. "cleaner") → "Identyfikator kalendarza". Musisz mieć do niego dostęp z prawem edycji.</p>
        ${calendarId ? `<button type="button" class="btn btn-outline btn-block" data-action="cancel-calendar-edit">Anuluj</button>` : ''}
      </div>`;
  }

  const dotClass = ui.syncStatus === 'error' ? 'is-error' : ui.syncStatus === 'syncing' ? 'is-syncing' : 'is-connected';
  const statusText = ui.syncStatus === 'error'
    ? (ui.syncMessage || 'Błąd synchronizacji')
    : ui.syncStatus === 'syncing'
      ? 'Synchronizuję…'
      : ui.syncedAt
        ? `Zsynchronizowano o ${new Date(ui.syncedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`
        : 'Podłączono — czekam na pierwszą synchronizację';

  return `
    <div class="status-row">
      ${categoryIconChip({ colorHex: '#4C6B57', icon: 'calendar' }, 40)}
      <div class="spacer">
        <div style="font-size:14.5px;font-weight:700">${escapeHtml(calendarId)}</div>
        <div class="row" style="gap:6px;margin-top:2px">
          <span class="status-dot ${dotClass}"></span>
          <span class="text-sm text-secondary">${escapeHtml(statusText)}</span>
        </div>
      </div>
    </div>
    <div class="row" style="gap:8px;margin-top:10px">
      <button type="button" class="btn btn-outline" style="flex:1" data-action="sync-now" ${ui.syncStatus === 'syncing' ? 'disabled' : ''}>Synchronizuj teraz</button>
      <button type="button" class="btn btn-outline" data-action="edit-calendar-id">Zmień</button>
    </div>`;
}

function renderVacationSection() {
  const today = startOfToday();
  const active = store.getActiveVacation(dateKey(today));
  if (active) {
    return `
      <div class="status-row">
        ${categoryIconChip({ colorHex: '#A6862F', icon: 'sun' }, 40)}
        <div class="spacer">
          <div style="font-size:14.5px;font-weight:700">Włączony${active.until ? ` do ${formatDateInline(parseDateKey(active.until), today)}` : ' do odwołania'}</div>
          <div class="text-sm text-secondary" style="margin-top:2px">Zaległości z tych dni nie przerwą passy domu.</div>
        </div>
        <button type="button" class="btn btn-outline" style="height:44px;padding:0 14px" data-action="end-vacation">Wyłącz</button>
      </div>`;
  }
  return `
    <div class="stack" style="gap:12px">
      <p class="hint" style="margin:0">Na czas wyjazdu: obowiązki z tych dni nie staną się zaległe i nie przerwą passy. Działa dla całego domu.</p>
      <div class="field">
        <label for="vacationUntil">Do kiedy</label>
        <input class="input" id="vacationUntil" type="date" min="${dateKey(today)}" value="${dateKey(addUnits(today, 'day', 7))}" />
      </div>
      <button type="button" class="btn btn-outline btn-block" data-action="start-vacation">${svgIcon('sun', { size: 18 })}Włącz tryb urlopowy</button>
    </div>`;
}

/** Reset danych — celowo schowany tutaj (a nie na liście obowiązków) i zabezpieczony
 * wpisaniem słowa. W trybie Google dane są wspólne z domownikami przez kalendarz, więc
 * reset jest wyłączony: wypchnąłby dane przykładowe wszystkim. */
function renderDataSection(isGoogle) {
  if (isGoogle) {
    return '<p class="hint" style="margin:0">Dane są współdzielone z domownikami przez Kalendarz Google, dlatego usuwanie wszystkiego naraz jest tu wyłączone.</p>';
  }
  if (!ui.resetConfirmOpen) {
    return `<button type="button" class="btn btn-danger-ghost btn-block" data-action="open-reset-confirm">${svgIcon('trash-2', { size: 17 })}Usuń wszystkie dane i wczytaj przykładowe</button>`;
  }
  return `
    <div class="danger-box stack" style="gap:12px">
      <p class="text-sm" style="line-height:1.5">Zostaną usunięte obowiązki, historia wykonań, pomieszczenia i domownicy z tego urządzenia, a w ich miejsce pojawią się dane przykładowe. Szablony zostaną. Tego nie da się cofnąć.</p>
      <div class="field">
        <label for="resetConfirmInput">Wpisz ${RESET_CONFIRM_WORD}, żeby potwierdzić</label>
        <input class="input" id="resetConfirmInput" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
      </div>
      <div class="row" style="gap:8px">
        <button type="button" class="btn btn-outline" style="flex:1" data-action="cancel-reset">Anuluj</button>
        <button type="button" class="btn btn-danger" style="flex:1" id="resetConfirmBtn" data-action="confirm-reset" disabled>Usuń dane</button>
      </div>
    </div>`;
}

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
        ${renderCalendarSyncSection(isGoogle)}
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
        ${categoryIconChip({ colorHex: '#3B7DD8', icon: 'sofa' }, 40)}
        <span class="spacer" style="font-size:14.5px;font-weight:700">Pomieszczenia</span>
        ${svgIcon('chevron-right', { size: 15, color: 'var(--cp-chevron)' })}
      </button>

      <button type="button" class="status-row" style="cursor:pointer;text-align:left;width:100%;border:1px solid var(--cp-surface-border);font-family:inherit;margin-top:8px" data-action="open-templates">
        ${categoryIconChip({ colorHex: '#A6862F', icon: 'tag' }, 40)}
        <span class="spacer" style="font-size:14.5px;font-weight:700">Szablony obowiązków</span>
        ${svgIcon('chevron-right', { size: 15, color: 'var(--cp-chevron)' })}
      </button>

      <div class="section">
        <h2 class="section-label">Tryb urlopowy</h2>
        ${renderVacationSection()}
      </div>

      <div class="section">
        <h2 class="section-label">Dane</h2>
        ${renderDataSection(isGoogle)}
      </div>

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
  const isSkipped = status === 'skipped';
  const isOverdue = status === 'pending' && date.getTime() < startOfToday().getTime();
  const isToday = sameDay(date, startOfToday());
  const member = members.find((m) => m.id === assigneeId);
  const earlierMissed = isOverdue || isToday ? earlierPendingOverdue(chore, dateKeyStr).length : 0;

  return `
    <div class="modal-handle"></div>
    <div class="modal-header">
      <div class="stack" style="gap:6px">
        ${category ? (() => { const fg = categoryFg(category.colorHex); return `<span class="sheet-badge" style="background:${hexToRgba(category.colorHex, tintAlpha())};color:${fg}">${svgIcon(category.icon, { size: 12, color: fg, strokeWidth: 2.4 })}${escapeHtml(category.name)} · ${describeScheduleShort(chore.schedule)}</span>`; })() : ''}
        <div class="row" style="gap:8px;flex-wrap:wrap">
          ${isOverdue ? '<span class="badge-overdue">Zaległe</span>' : ''}
          ${isToday ? '<span class="badge-today">Dziś</span>' : ''}
          ${isDone ? '<span class="badge-done">Wykonane</span>' : ''}
          ${isSkipped ? '<span class="badge-skipped">Pominięte</span>' : ''}
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

    ${earlierMissed ? `<p class="hint" style="margin:0">${earlierMissed === 1
      ? 'Wcześniejszy niewykonany termin tego obowiązku zostanie przy tym oznaczony jako pominięty.'
      : `Wcześniejsze niewykonane terminy tego obowiązku (${earlierMissed}) zostaną przy tym oznaczone jako pominięte.`}</p>` : ''}

    ${status === 'pending' ? `
    <div class="stack" style="gap:10px">
      <button type="button" class="btn btn-primary btn-block" data-action="set-occurrence" data-status="done" data-choreid="${choreId}" data-date="${dateKeyStr}">
        ${svgIcon('check', { size: 19, strokeWidth: 2.2 })}Oznacz jako wykonane
      </button>
      <button type="button" class="btn btn-outline btn-block" data-action="set-occurrence" data-status="skipped" data-choreid="${choreId}" data-date="${dateKeyStr}">
        ${svgIcon('skip', { size: 16, strokeWidth: 2 })}Pomiń ten termin
      </button>
      <p class="hint" style="margin:0;text-align:center">Pominięte nie daje punktów, ale nie przerywa passy.</p>
    </div>` : `
    <button type="button" class="btn btn-outline btn-block" data-action="set-occurrence" data-status="pending" data-choreid="${choreId}" data-date="${dateKeyStr}">
      ${svgIcon('close', { size: 18, strokeWidth: 2.2 })}${isDone ? 'Cofnij wykonanie' : 'Przywróć do zrobienia'}
    </button>`}
    <button type="button" class="link-btn" style="justify-content:center;min-height:44px" data-action="edit-chore" data-choreid="${choreId}">Edytuj obowiązek</button>
  `;
}

// ---------- Modal: formularz obowiązku ----------
// Widoczne od razu tylko to, czego potrzebuje większość obowiązków domowych: nazwa,
// pomieszczenie, jak często i kto. Reszta (data startu, godzina, notatka, checklista,
// szacowany czas) siedzi w zwijanej sekcji "Więcej szczegółów".

function renderChoreFormContent(choreId, presetMode) {
  const chore = choreId ? store.getChore(choreId) : null;
  const members = store.getMembers();
  const categories = store.getCategories();
  const draft = ui.modal.draft;
  const isOnce = draft.preset === 'once';
  const showWeekdays = !isOnce && !draft.rolling && draft.unit === 'week';

  const detailsSummary = [
    `${draft.estimatedMinutes} min`,
    draft.time ? `godz. ${draft.time}` : '',
    draft.notes.trim() ? 'notatka' : '',
    draft.checklist.filter((i) => i.trim()).length ? `${draft.checklist.filter((i) => i.trim()).length} ${plural(draft.checklist.filter((i) => i.trim()).length, 'punkt', 'punkty', 'punktów')}` : '',
  ].filter(Boolean).join(' · ');

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
        <label>Pomieszczenie</label>
        <div class="chip-group">
          ${categories.map((cat) => {
            const selected = draft.categoryId === cat.id;
            return `<button type="button" class="chip ${selected ? 'is-selected' : ''}" style="${selected ? `background:${cat.colorHex}` : ''}" aria-pressed="${selected}" data-action="select-category" data-catid="${cat.id}">${svgIcon(cat.icon, { size: 14, color: selected ? 'currentColor' : categoryFg(cat.colorHex) })}${escapeHtml(cat.name)}</button>`;
          }).join('')}
          <button type="button" class="chip is-dashed" data-action="new-category-link">${svgIcon('plus', { size: 14, color: 'var(--cp-text-secondary)', strokeWidth: 2 })}Nowe</button>
        </div>
      </div>

      <div class="field">
        <label>Jak często</label>
        <div class="chip-group" role="group" aria-label="Jak często">
          ${SCHEDULE_PRESETS.map((p) => `<button type="button" class="chip ${draft.preset === p.key ? 'is-selected is-accent' : ''}" aria-pressed="${draft.preset === p.key}" data-action="set-preset" data-preset="${p.key}">${p.label}</button>`).join('')}
        </div>

        ${draft.preset === 'custom' ? `
        <div class="field-row field-row--inline" style="margin-top:4px">
          <span class="field-inline-label">co</span>
          <input class="input" id="f-interval" name="interval" type="number" min="1" inputmode="numeric" value="${draft.interval}" style="text-align:center;max-width:88px" aria-label="Co ile" />
          <select class="select" id="f-unit" aria-label="Jednostka">
            <option value="day" ${draft.unit === 'day' ? 'selected' : ''}>${plural(draft.interval, 'dzień', 'dni', 'dni')}</option>
            <option value="week" ${draft.unit === 'week' ? 'selected' : ''}>${plural(draft.interval, 'tydzień', 'tygodnie', 'tygodni')}</option>
            <option value="month" ${draft.unit === 'month' ? 'selected' : ''}>${plural(draft.interval, 'miesiąc', 'miesiące', 'miesięcy')}</option>
          </select>
        </div>` : ''}

        ${showWeekdays ? `
        <div class="weekday-row" role="group" aria-label="W które dni tygodnia">
          ${WEEKDAY_ORDER.map((d, i) => {
            const on = draft.weekdays.includes(d);
            return `<button type="button" class="weekday-btn ${on ? 'is-selected' : ''}" aria-pressed="${on}" aria-label="${WEEKDAYS_LONG[i]}" data-action="toggle-weekday" data-day="${d}">${WEEKDAYS_SHORT[i]}</button>`;
          }).join('')}
        </div>` : ''}

        ${isOnce ? `
        <div class="field" style="margin-top:4px">
          <label for="f-anchor">Kiedy</label>
          <input class="input" id="f-anchor" name="anchorDate" type="date" value="${draft.anchorDate}" />
        </div>` : `
        <button type="button" class="switch-row" role="switch" aria-checked="${draft.rolling}" data-action="toggle-rolling">
          <span class="spacer">
            <span class="switch-row-title">Licz od ostatniego wykonania</span>
            <span class="switch-row-hint">Np. okna: 3 miesiące po tym, jak ostatnio umyte — a nie w stałe dni.</span>
          </span>
          <span class="switch" aria-hidden="true"></span>
        </button>`}

        <p class="schedule-preview" id="schedulePreview" aria-live="polite">${escapeHtml(schedulePreviewText(draft, chore))}</p>
      </div>

      <div class="field">
        <label>Kto</label>
        <div class="chip-group">
          ${members.map((m) => {
            const selected = draft.assigneeId === m.id;
            return `<button type="button" class="assignee-chip ${selected ? 'is-selected' : ''}" aria-pressed="${selected}" data-action="select-assignee-chip" data-id="${m.id}"><span class="occ-avatar" style="background:${m.colorHex}">${initials(m.name)}</span>${escapeHtml(m.name)}</button>`;
          }).join('')}
          <button type="button" class="assignee-chip is-unassigned ${!draft.assigneeId ? 'is-selected' : ''}" aria-pressed="${!draft.assigneeId}" data-action="select-assignee-chip" data-id="">Nieprzypisane</button>
        </div>
      </div>

      <div class="details-block">
        <button type="button" class="details-toggle" data-action="toggle-more" aria-expanded="${draft.showMore}" aria-controls="choreMore">
          <span class="spacer">
            <span class="details-toggle-title">Więcej szczegółów</span>
            <span class="details-toggle-summary">${escapeHtml(detailsSummary)}</span>
          </span>
          <span class="details-chevron">${svgIcon('chevron-down', { size: 18 })}</span>
        </button>

        <div id="choreMore" class="stack" style="gap:24px" ${draft.showMore ? '' : 'hidden'}>
          <div class="field">
            <label>Szacowany czas</label>
            ${minuteChips(draft.estimatedMinutes, 'set-minutes')}
          </div>

          <div class="field-row">
            ${isOnce ? '' : `
            <div class="field">
              <label for="f-anchor">Zaczyna się od</label>
              <input class="input" id="f-anchor" name="anchorDate" type="date" value="${draft.anchorDate}" />
            </div>`}
            <div class="field">
              <label for="f-time">Godzina</label>
              <input class="input" id="f-time" name="time" type="time" value="${draft.time || ''}" />
            </div>
          </div>

          <div class="field">
            <label for="f-notes">Notatka</label>
            <textarea class="textarea" id="f-notes" name="notes" placeholder="Dodatkowe informacje, wskazówki...">${escapeHtml(draft.notes)}</textarea>
          </div>

          <div class="field">
            <label>Lista punktów</label>
            <div class="checklist-editor" id="checklistEditor">
              ${draft.checklist.map((item, i) => renderChecklistItem(item, i)).join('')}
            </div>
            <button type="button" class="link-btn" style="margin-top:8px;min-height:44px" data-action="add-checklist-item">${svgIcon('plus', { size: 16, strokeWidth: 2.2 })}Dodaj punkt</button>
          </div>
        </div>
      </div>

      ${chore ? `
      <button type="button" class="switch-row" role="switch" aria-checked="${!draft.active}" data-action="toggle-active">
        <span class="spacer">
          <span class="switch-row-title">Wstrzymaj</span>
          <span class="switch-row-hint">Obowiązek zniknie z planu, dopóki go nie wznowisz — np. podlewanie kwiatów zimą.</span>
        </span>
        <span class="switch" aria-hidden="true"></span>
      </button>` : ''}

      <div class="stack" style="gap:12px">
        <button type="submit" class="btn btn-primary btn-block">Zapisz obowiązek</button>
        ${chore ? `<button type="button" class="btn btn-danger-ghost btn-block" data-action="delete-chore" data-choreid="${chore.id}">Usuń obowiązek</button>` : ''}
      </div>
    </form>
  `;
}

function renderChecklistItem(value, index) {
  return `<div class="checklist-editor-item" data-index="${index}">
    <input class="input" value="${escapeHtml(value)}" data-role="checklist-value" aria-label="Punkt ${index + 1}" />
    <button type="button" class="icon-btn icon-btn--sm" style="border:none;background:none" data-action="remove-checklist-item" data-index="${index}" aria-label="Usuń punkt">${svgIcon('close', { size: 15, color: 'var(--cp-text-tertiary)' })}</button>
  </div>`;
}

/** Który preset częstotliwości odpowiada zapisanemu harmonogramowi. */
function presetForSchedule(schedule) {
  if (schedule.mode === 'once') return 'once';
  const { unit, interval } = schedule;
  if (unit === 'day' && interval === 1) return 'daily';
  if (unit === 'week' && interval === 1) return 'weekly';
  if (unit === 'week' && interval === 2) return 'biweekly';
  if (unit === 'month' && interval === 1) return 'monthly';
  return 'custom';
}

function makeChoreDraft(chore, presetMode) {
  const schedule = chore?.schedule || {
    mode: presetMode || 'fixed', unit: 'day', interval: 1, weekdays: null, anchorDate: dateKey(startOfToday()), time: '',
  };
  return {
    title: chore?.title || '',
    notes: chore?.notes || '',
    preset: presetForSchedule(schedule),
    rolling: schedule.mode === 'rolling',
    unit: schedule.unit || 'day',
    interval: schedule.interval || 1,
    weekdays: schedule.weekdays ? [...schedule.weekdays] : [],
    anchorDate: schedule.anchorDate,
    time: schedule.time || '',
    categoryId: chore?.categoryId ?? null,
    assigneeId: chore?.assigneeId ?? null,
    estimatedMinutes: chore?.estimatedMinutes ?? 15,
    checklist: chore?.checklist ? [...chore.checklist] : [],
    active: chore ? chore.active !== false : true,
    showMore: false,
  };
}

/** Harmonogram zapisywany na obowiązku, zbudowany z draftu formularza. */
function scheduleFromDraft(draft) {
  if (draft.preset === 'once') {
    return { mode: 'once', unit: 'day', interval: 1, weekdays: null, anchorDate: draft.anchorDate || dateKey(startOfToday()), time: draft.time || null };
  }
  const useWeekdays = !draft.rolling && draft.unit === 'week' && draft.weekdays.length > 0;
  return {
    mode: draft.rolling ? 'rolling' : 'fixed',
    unit: draft.unit,
    interval: Math.max(1, Number(draft.interval) || 1),
    weekdays: useWeekdays ? WEEKDAY_ORDER.filter((d) => draft.weekdays.includes(d)) : null,
    anchorDate: draft.anchorDate || dateKey(startOfToday()),
    time: draft.time || null,
  };
}

/** Zdanie pod harmonogramem, które pokazuje, co wybrane ustawienia znaczą w praktyce:
 * "Następnym razem: czwartek, 2 października. Potem co 2 tygodnie." */
function schedulePreviewText(draft, chore) {
  const today = startOfToday();
  const schedule = scheduleFromDraft(draft);
  if (!draft.anchorDate) return '';

  if (schedule.mode === 'once') {
    return `Jednorazowo: ${formatDateInline(parseDateKey(schedule.anchorDate), today)}.`;
  }

  if (schedule.mode === 'rolling') {
    const lastCompletedAt = chore?.schedule?.mode === 'rolling' ? chore.lastCompletedAt : null;
    const due = nextOccurrenceDate({ schedule, lastCompletedAt }, today);
    const when = due < today ? `${formatDateInline(due, today)} (już zaległe)` : formatDateInline(due, today);
    return `Najbliżej: ${when}. Kolejne terminy ${describeSpan(schedule.unit, schedule.interval)} po każdym wykonaniu.`;
  }

  const next = nextOccurrenceDate({ schedule }, today);
  if (!next) return '';
  let rhythm;
  if (schedule.weekdays) {
    const days = joinWithAnd(schedule.weekdays.map((d) => WEEKDAYS_PLURAL[d]));
    rhythm = schedule.interval === 1 ? `w ${days}` : `co ${schedule.interval} ${plural(schedule.interval, 'tydzień', 'tygodnie', 'tygodni')}, w ${days}`;
  } else {
    rhythm = describeInterval(schedule.unit, schedule.interval);
  }
  return `Następnym razem: ${formatDateInline(next, today)}. Potem ${rhythm}.`;
}

/** Odświeża samo zdanie-podgląd (bez re-renderu formularza — żeby nie zgubić fokusu
 * w trakcie wpisywania liczby czy wybierania daty). */
function updateSchedulePreview() {
  const el = document.getElementById('schedulePreview');
  if (!el || ui.modal?.type !== 'chore') return;
  const chore = ui.modal.choreId ? store.getChore(ui.modal.choreId) : null;
  el.textContent = schedulePreviewText(ui.modal.draft, chore);
}

/** Zgrywa bieżące wartości pól tekstowych formularza obowiązku do ui.modal.draft
 * PRZED każdym częściowym re-renderem (klik chipa/przełącznika) — inaczej
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
  if (interval) d.interval = Math.max(1, Number(interval.value) || d.interval);
  if (unit) d.unit = unit.value;
  if (anchor) d.anchorDate = anchor.value;
  if (time) d.time = time.value;
  if (editor) d.checklist = [...editor.querySelectorAll('[data-role="checklist-value"]')].map((i) => i.value);
}

// ---------- Modal: wybór sposobu dodania + biblioteka szablonów ----------

function renderAddChoiceContent() {
  const options = [
    { action: 'open-template-picker', icon: 'list', title: 'Z szablonu', sub: 'Gotowe obowiązki dla pomieszczeń — najszybciej' },
    { action: 'new-chore-blank', icon: 'plus', title: 'Od zera', sub: 'Własna nazwa i harmonogram' },
    { action: 'new-once', icon: 'flash', title: 'Jednorazowe zdarzenie', sub: 'Jeden termin, bez powtórzeń' },
  ];
  return `
    <div class="modal-handle"></div>
    <div class="modal-header" style="align-items:center">
      <h2 class="modal-title-sm">Dodaj obowiązek</h2>
      <button type="button" class="icon-btn icon-btn--sm" data-action="close-modal" aria-label="Zamknij">${svgIcon('close', { size: 16 })}</button>
    </div>
    <div class="stack">
      ${options.map((o) => `
      <button type="button" class="choice-row" data-action="${o.action}">
        <span class="icon-chip icon-chip--md" style="background:var(--cp-accent-tint);color:var(--cp-accent)">${svgIcon(o.icon, { size: 20, color: 'currentColor' })}</span>
        <span class="spacer">
          <span class="choice-row-title">${o.title}</span>
          <span class="choice-row-sub">${o.sub}</span>
        </span>
        ${svgIcon('chevron-right', { size: 16, color: 'var(--cp-chevron)' })}
      </button>`).join('')}
    </div>`;
}

function normalizeForSearch(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
}

/** Biblioteka szablonów w głównym przepływie dodawania. Tryb pojedynczy: tapnięcie
 * otwiera formularz wypełniony szablonem (do dostosowania przed zapisem). Tryb
 * wielokrotny: zaznaczasz kilka i dodajesz je naraz, z domyślnymi ustawieniami. */
function renderTemplatePickerContent() {
  const { multi, selected } = ui.modal;
  const templates = store.getTemplates();
  const categories = store.getCategories();
  const groups = categories
    .map((cat) => ({ category: cat, label: cat.name, items: templates.filter((t) => t.categoryId === cat.id) }))
    .filter((g) => g.items.length);
  const orphaned = templates.filter((t) => !categories.some((c) => c.id === t.categoryId));
  if (orphaned.length) groups.push({ category: null, label: 'Bez pomieszczenia', items: orphaned });

  const rowsHtml = groups.map((g) => `
    <div class="picker-group" data-group>
      <h3 class="section-label">${escapeHtml(g.label)}</h3>
      <div class="stack">
        ${g.items.map((t) => {
          const on = selected.includes(t.id);
          return `<button type="button" class="picker-row ${on ? 'is-selected' : ''}" data-search="${escapeHtml(normalizeForSearch(`${t.title} ${g.label}`))}"
              data-action="${multi ? 'toggle-template-pick' : 'apply-template'}" data-tplid="${t.id}" ${multi ? `aria-pressed="${on}"` : ''}>
            ${multi ? `<span class="picker-check">${on ? svgIcon('check', { size: 13, color: 'currentColor', strokeWidth: 3 }) : ''}</span>` : categoryIconChip(g.category, 40)}
            <span class="spacer">
              <span class="chore-title">${escapeHtml(t.title)}</span>
              <span class="chore-meta"><span>${describeScheduleShort(t.schedule)}${t.schedule.mode === 'rolling' ? ' od wykonania' : ''} · ${t.estimatedMinutes} min</span></span>
            </span>
            ${multi ? '' : svgIcon('chevron-right', { size: 16, color: 'var(--cp-chevron)' })}
          </button>`;
        }).join('')}
      </div>
    </div>`).join('');

  return `
    <div class="modal-header" style="align-items:center">
      <button type="button" class="icon-btn icon-btn--sm" data-action="close-modal" aria-label="Zamknij">${svgIcon('close', { size: 16 })}</button>
      <h2 class="modal-title-sm" style="text-align:center;flex:1">${multi ? 'Wybierz obowiązki' : 'Z szablonu'}</h2>
      <button type="button" class="modal-save-link" data-action="toggle-picker-mode">${multi ? 'Pojedynczo' : 'Zaznacz kilka'}</button>
    </div>
    <div class="search-field">
      ${svgIcon('search', { size: 18, color: 'var(--cp-text-tertiary)' })}
      <input class="input" id="tplSearch" type="search" placeholder="Szukaj, np. okna" value="${escapeHtml(ui.modal.query)}" aria-label="Szukaj szablonu" autocomplete="off" />
    </div>
    ${templates.length ? rowsHtml : '<p class="empty-note">Biblioteka szablonów jest pusta — dodaj szablony w Konto → Szablony obowiązków.</p>'}
    <p class="empty-note" id="tplNoResults" hidden>Nic nie pasuje. Spróbuj innego słowa albo dodaj obowiązek od zera.</p>
    ${multi ? `
    <div class="sheet-footer">
      <button type="button" class="btn btn-primary btn-block" data-action="add-picked-templates" ${selected.length ? '' : 'disabled'}>
        ${selected.length ? `Dodaj ${selected.length} ${plural(selected.length, 'obowiązek', 'obowiązki', 'obowiązków')}` : 'Zaznacz obowiązki do dodania'}
      </button>
    </div>` : `
    <button type="button" class="link-btn" style="justify-content:center;min-height:44px" data-action="manage-templates">Zarządzaj szablonami</button>`}
  `;
}

/** Filtruje wiersze biblioteki szablonów w miejscu (bez re-renderu — fokus zostaje w polu). */
function applyTemplateSearch() {
  const q = normalizeForSearch(ui.modal?.query || '').trim();
  let visible = 0;
  document.querySelectorAll('#modalRoot .picker-group').forEach((group) => {
    let groupVisible = 0;
    group.querySelectorAll('.picker-row').forEach((row) => {
      const match = !q || row.dataset.search.includes(q);
      row.hidden = !match;
      if (match) groupVisible++;
    });
    group.hidden = groupVisible === 0;
    visible += groupVisible;
  });
  const none = document.getElementById('tplNoResults');
  if (none) none.hidden = visible > 0 || !q;
}

function choreFromTemplate(template) {
  const schedule = { ...template.schedule, anchorDate: dateKey(startOfToday()), time: null };
  return {
    title: template.title,
    notes: template.notes || '',
    checklist: template.checklist || [],
    estimatedMinutes: template.estimatedMinutes,
    categoryId: template.categoryId,
    assigneeId: null,
    frequencyTier: inferFrequencyTier(schedule),
    schedule,
  };
}

// ---------- Modal root ----------

function renderModal() {
  const root = document.getElementById('modalRoot');
  if (!ui.modal) { root.innerHTML = ''; syncToastPosition(); return; }
  let content = '';
  if (ui.modal.type === 'occurrence') content = renderOccurrenceModalContent(ui.modal.choreId, ui.modal.date);
  else if (ui.modal.type === 'chore') content = renderChoreFormContent(ui.modal.choreId, ui.modal.presetMode);
  else if (ui.modal.type === 'add-choice') content = renderAddChoiceContent();
  else if (ui.modal.type === 'template-picker') content = renderTemplatePickerContent();
  root.innerHTML = `<div class="modal-overlay" data-action="overlay"><div class="modal">${content}</div></div>`;
  if (ui.modal.type === 'template-picker') applyTemplateSearch();
  syncToastPosition();
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
function openTemplatePicker(multi) {
  ui.modal = { type: 'template-picker', multi, selected: [], query: '' };
  renderModal();
}
function closeModal() {
  ui.modal = null;
  renderModal();
}

// ---------- Odhaczanie: wykonane / pominięte / cofnij ----------

/** Niewykonane (pending) wystąpienia obowiązku w trybie 'fixed' sprzed `dateKeyStr`
 * i sprzed dziś — to one "przepadają" jako pominięte, gdy nowszy termin zostaje
 * zamknięty (codzienna zmywarka zrobiona dziś nadrabia wczorajszą). */
function earlierPendingOverdue(chore, dateKeyStr) {
  if (!chore || chore.schedule.mode !== 'fixed') return [];
  const today = startOfToday();
  const target = parseDateKey(dateKeyStr);
  const end = addUnits(target.getTime() < today.getTime() ? target : today, 'day', -1);
  const start = addUnits(today, 'day', -OVERDUE_LOOKBACK_DAYS);
  if (end < start) return [];
  const vacations = store.getVacations();
  return generateOccurrencesInRange(chore, start, end)
    .map((o) => dateKey(o.date))
    .filter((key) => key !== dateKeyStr && (store.getOverride(chore.id, key)?.status || 'pending') === 'pending'
      && !isVacationDay(parseDateKey(key), vacations));
}

/** Zmienia status wystąpienia i pokazuje toast z "Cofnij". Wspólne dla kółka na
 * liście i przycisków w szczegółach. */
function setOccurrence(choreId, dateKeyStr, newStatus) {
  const chore = store.getChore(choreId);
  if (!chore) return;
  const members = store.getMembers();
  const existing = store.getOverride(choreId, dateKeyStr);
  const snapshots = [store.getOccurrenceSnapshot(choreId, dateKeyStr)];
  const extra = {};
  let takenFrom = null;

  // Odhaczasz zadanie przypisane komuś innemu → "przejmujesz" je: liczy się od
  // teraz jako Twoje (i Twoje punkty) — i toast mówi to wprost.
  if (newStatus === 'done') {
    const myMemberId = resolveMyMemberId(members);
    const effectiveAssignee = existing?.assigneeId ?? chore.assigneeId ?? null;
    if (myMemberId && effectiveAssignee !== myMemberId) {
      extra.assigneeId = myMemberId;
      takenFrom = members.find((m) => m.id === effectiveAssignee) || null;
    }
  }

  const earlier = newStatus === 'pending' ? [] : earlierPendingOverdue(chore, dateKeyStr);
  for (const key of earlier) snapshots.push(store.getOccurrenceSnapshot(choreId, key));

  store.setOccurrenceStatus(choreId, dateKeyStr, newStatus, extra);
  for (const key of earlier) store.setOccurrenceStatus(choreId, key, 'skipped');

  const parts = [{ done: 'Wykonane', skipped: 'Pominięte', pending: existing?.status === 'skipped' ? 'Przywrócone' : 'Cofnięto wykonanie' }[newStatus]];
  if (takenFrom) parts.push(`przejęte od: ${takenFrom.name}`);
  if (earlier.length) parts.push(`${earlier.length} ${plural(earlier.length, 'wcześniejsze pominięte', 'wcześniejsze pominięte', 'wcześniejszych pominiętych')}`);

  ui.justResolvedKey = newStatus === 'pending' ? null : `${choreId}|${dateKeyStr}`;
  showToast(parts.join(' · '), () => {
    for (const snap of snapshots.reverse()) store.restoreOccurrenceSnapshot(snap);
  });
}

// ---------- Toast ----------

let toastTimer = null;

function showToast(message, undoFn = null) {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  ui.toastUndo = undoFn;
  root.innerHTML = `<div class="toast">
    <span class="toast-text">${escapeHtml(message)}</span>
    ${undoFn ? '<button type="button" class="toast-action" data-action="toast-undo">Cofnij</button>' : ''}
  </div>`;
  syncToastPosition();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  clearTimeout(toastTimer);
  ui.toastUndo = null;
  const root = document.getElementById('toastRoot');
  if (root) root.innerHTML = '';
}

/** Toast siedzi nad dolnym paskiem, gdy ten jest widoczny, a przy modalu i widokach
 * bez paska — przy samym dole ekranu. */
function syncToastPosition() {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const tabbarVisible = ui.route === 'app' && !ui.view && !ui.modal;
  root.classList.toggle('is-above-tabbar', tabbarVisible);
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
    case 'toast-undo': {
      const undo = ui.toastUndo;
      hideToast();
      if (undo) {
        undo();
        ui.justResolvedKey = null;
        if (ui.modal?.type === 'occurrence') renderModal();
        render();
      }
      return;
    }
    case 'back':
      ui.view = null;
      ui.resetConfirmOpen = false;
      ui.categoryEditId = null;
      ui.categoryDraft = null;
      ui.templateEditId = null;
      ui.templateDraft = null;
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
          store.claimMemberForIdentity(profile);
          maybeInitCalendarSync();
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
    case 'open-templates':
      ui.view = 'templates';
      ui.templateEditId = null;
      ui.templateDraft = null;
      render();
      scrollContentTop();
      return;
    case 'set-theme':
      store.setThemePreference(el.dataset.value);
      applyTheme();
      render();
      return;
    case 'edit-calendar-id':
      ui.calendarIdDraft = store.getCalendarId() || '';
      render();
      return;
    case 'cancel-calendar-edit':
      ui.calendarIdDraft = null;
      render();
      return;
    case 'sync-now':
      calendarSync.syncNow();
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
      if (confirm('Usunąć to pomieszczenie? Obowiązki, które go używają, staną się bez pomieszczenia.')) {
        store.deleteCategory(el.dataset.catid);
        ui.categoryEditId = null;
        ui.categoryDraft = null;
        render();
      }
      return;

    // ---- Szablony obowiązków ----
    case 'edit-template':
      ui.templateEditId = el.dataset.tplid;
      ui.templateDraft = makeTemplateDraft(store.getTemplates().find((t) => t.id === el.dataset.tplid));
      render();
      return;
    case 'cancel-template-edit':
      ui.templateEditId = null;
      ui.templateDraft = null;
      render();
      return;
    case 'select-template-category':
      captureTemplateFormInputs();
      ui.templateDraft.categoryId = el.dataset.catid;
      render();
      return;
    case 'set-template-mode':
      captureTemplateFormInputs();
      ui.templateDraft.scheduleMode = el.dataset.mode;
      render();
      return;
    case 'set-template-minutes':
      captureTemplateFormInputs();
      ui.templateDraft.estimatedMinutes = Number(el.dataset.minutes);
      render();
      return;
    case 'save-template': {
      captureTemplateFormInputs();
      const title = ui.templateDraft.title.trim();
      if (!title) return;
      store.saveTemplate({
        id: ui.templateEditId || undefined,
        title,
        categoryId: ui.templateDraft.categoryId,
        notes: ui.templateDraft.notes,
        estimatedMinutes: ui.templateDraft.estimatedMinutes,
        checklist: [],
        schedule: {
          mode: ui.templateDraft.scheduleMode,
          unit: ui.templateDraft.unit,
          interval: Math.max(1, Number(ui.templateDraft.interval) || 1),
          weekdays: null,
        },
      });
      ui.templateEditId = null;
      ui.templateDraft = null;
      render();
      return;
    }
    case 'delete-template':
      if (confirm('Usunąć ten szablon?')) {
        store.deleteTemplate(el.dataset.tplid);
        ui.templateEditId = null;
        ui.templateDraft = null;
        render();
      }
      return;
    case 'apply-template':
      openChoreModalFromTemplate(el.dataset.tplid);
      return;
    case 'open-template-picker':
      openTemplatePicker(el.dataset.multi === '1');
      return;
    case 'toggle-picker-mode':
      ui.modal.multi = !ui.modal.multi;
      ui.modal.selected = [];
      renderModal();
      return;
    case 'toggle-template-pick': {
      const { selected } = ui.modal;
      const idx = selected.indexOf(el.dataset.tplid);
      if (idx >= 0) selected.splice(idx, 1);
      else selected.push(el.dataset.tplid);
      renderModal();
      return;
    }
    case 'add-picked-templates': {
      const templates = store.getTemplates();
      const picked = ui.modal.selected.map((id) => templates.find((t) => t.id === id)).filter(Boolean);
      for (const t of picked) store.saveChore(choreFromTemplate(t));
      closeModal();
      render();
      if (picked.length) showToast(`Dodano ${picked.length} ${plural(picked.length, 'obowiązek', 'obowiązki', 'obowiązków')}`);
      return;
    }
    case 'manage-templates':
      closeModal();
      ui.view = 'templates';
      ui.templateEditId = null;
      ui.templateDraft = null;
      render();
      scrollContentTop();
      return;

    // ---- Obowiązki: filtr ----
    case 'set-chore-filter':
      ui.choreFilter = el.dataset.filter;
      render();
      return;
    case 'toggle-stats':
      ui.statsExpanded = !ui.statsExpanded;
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
    case 'quick-toggle': {
      const { choreid, date } = el.dataset;
      const current = store.getOverride(choreid, date)?.status || 'pending';
      setOccurrence(choreid, date, current === 'pending' ? 'done' : 'pending');
      render();
      ui.justResolvedKey = null;
      return;
    }
    case 'set-occurrence': {
      const { choreid, date, status } = el.dataset;
      setOccurrence(choreid, date, status);
      // Wykonane/pominięte zamyka szczegóły (toast i tak daje "Cofnij"); cofnięcie zostawia je otwarte.
      if (status === 'pending') renderModal();
      else closeModal();
      render();
      ui.justResolvedKey = null;
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
      ui.modal = { type: 'add-choice' };
      renderModal();
      return;
    case 'new-chore-blank':
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
    case 'set-preset': {
      captureChoreFormInputs();
      const d = ui.modal.draft;
      const preset = SCHEDULE_PRESETS.find((p) => p.key === el.dataset.preset);
      d.preset = preset.key;
      if (preset.unit) {
        d.unit = preset.unit;
        d.interval = preset.interval;
      }
      // "Co tydzień" od razu pokazuje, w jaki dzień wypada (dzień daty startu).
      if (d.unit === 'week' && d.weekdays.length === 0 && d.anchorDate) d.weekdays = [parseDateKey(d.anchorDate).getDay()];
      renderModal();
      return;
    }
    case 'toggle-rolling':
      captureChoreFormInputs();
      ui.modal.draft.rolling = !ui.modal.draft.rolling;
      renderModal();
      return;
    case 'toggle-weekday': {
      captureChoreFormInputs();
      const day = Number(el.dataset.day);
      const days = ui.modal.draft.weekdays;
      const idx = days.indexOf(day);
      if (idx >= 0) days.splice(idx, 1);
      else days.push(day);
      renderModal();
      return;
    }
    case 'toggle-more':
      captureChoreFormInputs();
      ui.modal.draft.showMore = !ui.modal.draft.showMore;
      renderModal();
      return;
    case 'toggle-active':
      captureChoreFormInputs();
      ui.modal.draft.active = !ui.modal.draft.active;
      renderModal();
      return;
    case 'select-assignee-chip':
      captureChoreFormInputs();
      ui.modal.draft.assigneeId = el.dataset.id || null;
      renderModal();
      return;
    case 'set-minutes':
      captureChoreFormInputs();
      ui.modal.draft.estimatedMinutes = Number(el.dataset.minutes);
      renderModal();
      return;
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

    // ---- Konto: tryb urlopowy i dane ----
    case 'start-vacation': {
      const today = dateKey(startOfToday());
      const until = document.getElementById('vacationUntil')?.value || null;
      store.startVacation(today, until && until >= today ? until : null);
      render();
      showToast('Tryb urlopowy włączony');
      return;
    }
    case 'end-vacation':
      store.endVacation(dateKey(startOfToday()), dateKey(addUnits(startOfToday(), 'day', -1)));
      render();
      showToast('Tryb urlopowy wyłączony');
      return;
    case 'open-reset-confirm':
      ui.resetConfirmOpen = true;
      render();
      document.getElementById('resetConfirmInput')?.focus();
      return;
    case 'cancel-reset':
      ui.resetConfirmOpen = false;
      render();
      return;
    case 'confirm-reset': {
      const typed = document.getElementById('resetConfirmInput')?.value.trim().toUpperCase();
      if (typed !== RESET_CONFIRM_WORD || store.getSession()?.mode === 'google') return;
      store.resetAllData();
      ui.resetConfirmOpen = false;
      ui.choreFilter = 'all';
      render();
      showToast('Dane usunięte — wczytano przykładowe');
      return;
    }
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
  if (e.target.id === 'f-unit' || e.target.id === 'f-interval') {
    // Jednostka zmienia widoczność dni tygodnia i odmianę etykiet — pełny re-render formularza.
    captureChoreFormInputs();
    const d = ui.modal.draft;
    if (d.unit === 'week' && d.weekdays.length === 0 && d.anchorDate) d.weekdays = [parseDateKey(d.anchorDate).getDay()];
    renderModal();
  }
  if (e.target.id === 'f-anchor') {
    captureChoreFormInputs();
    updateSchedulePreview();
  }
  if (e.target.dataset.action === 'save-calendar-id') {
    store.setCalendarId(e.target.value);
    ui.calendarIdDraft = null;
    if (store.getCalendarId()) calendarSync.connect();
    render();
  }
}

function handleInput(e) {
  const { id } = e.target;
  if (id === 'resetConfirmInput') {
    const btn = document.getElementById('resetConfirmBtn');
    if (btn) btn.disabled = e.target.value.trim().toUpperCase() !== RESET_CONFIRM_WORD;
  } else if (id === 'tplSearch' && ui.modal?.type === 'template-picker') {
    ui.modal.query = e.target.value;
    applyTemplateSearch();
  } else if (id === 'f-interval' || id === 'f-anchor') {
    captureChoreFormInputs();
    updateSchedulePreview();
  }
}

function handleSubmit(e) {
  if (e.target.id !== 'choreForm') return;
  e.preventDefault();
  const form = e.target;
  captureChoreFormInputs();
  const draft = ui.modal.draft;
  const title = draft.title.trim();
  if (!title) {
    document.getElementById('f-title')?.focus();
    return;
  }
  const schedule = scheduleFromDraft(draft);
  const existing = form.dataset.choreid ? store.getChore(form.dataset.choreid) : null;
  const chore = {
    id: form.dataset.choreid || undefined,
    title,
    notes: draft.notes.trim(),
    checklist: draft.checklist.map((i) => i.trim()).filter(Boolean),
    estimatedMinutes: draft.estimatedMinutes,
    categoryId: draft.categoryId || null,
    assigneeId: draft.assigneeId || null,
    // Pole zostaje dla zgodności danych (synchronizacja, starsze wersje), ale zawsze
    // liczone z harmonogramu — nic w UI już od niego nie zależy.
    frequencyTier: inferFrequencyTier(schedule),
    active: draft.active,
    schedule,
  };
  // Zmiana trybu z "od wykonania" na inny zeruje datę ostatniego wykonania, żeby po
  // powrocie do "od wykonania" nie wrócił nieaktualny termin.
  if (existing && existing.schedule.mode === 'rolling' && schedule.mode !== 'rolling') chore.lastCompletedAt = null;
  store.saveChore(chore);
  closeModal();
  render();
  showToast(existing ? (existing.active !== false && !draft.active ? 'Obowiązek wstrzymany' : 'Zapisano zmiany') : 'Dodano obowiązek');
}

/** "Wiaderko" częstotliwości zapisywane na obowiązku (daily/frequent/rare/once). */
function inferFrequencyTier(schedule) {
  if (schedule.mode === 'once') return 'once';
  if (schedule.mode === 'rolling') return 'rare';
  if (schedule.unit === 'day' && schedule.interval <= 1) return 'daily';
  if (schedule.unit === 'month') return 'rare';
  return 'frequent';
}

// ---------- Init ----------

/** Uruchamia synchronizację z Google Calendar (Faza 2, krok 2), jeśli konto jest
 * zalogowane przez Google i ma ustawione ID kalendarza w Koncie. Bezpieczne do
 * wołania wielokrotnie — calendarSync.init() samo pilnuje, żeby nie podpiąć się
 * dwa razy. */
function maybeInitCalendarSync() {
  const session = store.getSession();
  if (session?.mode === 'google' && calendarSync.isConfigured()) {
    calendarSync.init();
  }
}

function init() {
  store.ensureDemoData();
  applyTheme();
  watchSystemTheme();

  calendarSync.onSyncStatus((status, detail) => {
    ui.syncStatus = status;
    ui.syncMessage = detail?.message || '';
    if (status === 'ok') ui.syncedAt = detail?.at || new Date().toISOString();
    // Status synchronizacji jest widoczny wyłącznie w Koncie (renderCalendarSyncSection) —
    // re-renderowanie całej strony (a zwłaszcza renderModal(), które podmienia CAŁY DOM
    // modala) za każdym razem, gdy status się zmienia, i tak byłoby niewidoczne w innych
    // widokach, a przy otwartym modalu (np. w trakcie wypełniania formularza obowiązku)
    // realnie kasowało wpisywany tekst i przewijało ekran do góry. Stan `ui` i tak jest
    // czytany na bieżąco przy każdym kolejnym renderze, więc pominięcie renderu tutaj
    // niczego nie gubi — najwyżej wskaźnik statusu odświeży się dopiero przy najbliższej
    // innej akcji (otwarcie/zamknięcie Konta, zamknięcie modala itd.).
    if (!ui.modal) render();
  });
  maybeInitCalendarSync();

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
  document.addEventListener('input', handleInput);
  document.addEventListener('submit', handleSubmit);

  render();
}

init();
