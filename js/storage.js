// storage.js
// Jedyne miejsce, które wie o mechanizmie przechowywania danych (dziś: localStorage).
// W Fazie 2 ten plik zostanie podmieniony na adapter Google Calendar API —
// reszta aplikacji korzysta wyłącznie z funkcji eksportowanych stąd i nie zmieni się.

const KEYS = {
  members: 'cp_members',
  chores: 'cp_chores',
  overrides: 'cp_overrides', // { "choreId|YYYY-MM-DD": {status, completedAt, completedBy, assigneeId, notes} }
  categories: 'cp_categories',
  theme: 'cp_theme',
  session: 'cp_session', // null (niezalogowany) albo { mode: 'local'|'google', name?, email? }
  seeded: 'cp_seeded_v2',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- Kategorie obowiązków ----------
// Osobny byt od trybu harmonogramu — patrz "System kategorii" w architekturze projektu.
// 6 wbudowanych + dowolne dodane przez użytkownika (design system: nazwa + kolor + ikona).

const BUILTIN_CATEGORIES = [
  { id: 'mycie', name: 'Mycie', colorHex: '#3B7DD8', icon: 'droplet', builtIn: true },
  { id: 'odkurzanie', name: 'Odkurzanie', colorHex: '#6B7280', icon: 'broom', builtIn: true },
  { id: 'smieci', name: 'Śmieci', colorHex: '#C0703A', icon: 'trash-2', builtIn: true },
  { id: 'lazienka', name: 'Łazienka', colorHex: '#7A5C9E', icon: 'sparkle', builtIn: true },
  { id: 'kuchnia', name: 'Kuchnia', colorHex: '#4C6B57', icon: 'utensils', builtIn: true },
  { id: 'inne', name: 'Inne', colorHex: '#A6862F', icon: 'tag', builtIn: true },
];

export function getCategories() {
  return read(KEYS.categories, []);
}

export function getCategory(id) {
  return getCategories().find((c) => c.id === id) || null;
}

export function saveCategory(category) {
  const categories = getCategories();
  if (category.id) {
    const idx = categories.findIndex((c) => c.id === category.id);
    if (idx >= 0) {
      // Kategorii wbudowanych nie da się przemianować — tylko kolor/ikona.
      const existing = categories[idx];
      categories[idx] = { ...existing, ...category, name: existing.builtIn ? existing.name : (category.name || existing.name) };
    } else {
      categories.push(category);
    }
  } else {
    category.id = uid('cat');
    category.builtIn = false;
    categories.push(category);
  }
  write(KEYS.categories, categories);
  return category;
}

/** Usuwa kategorię (nie da się usunąć wbudowanej) i odpina ją od obowiązków, które jej używały. */
export function deleteCategory(id) {
  const category = getCategory(id);
  if (!category || category.builtIn) return false;
  write(KEYS.categories, getCategories().filter((c) => c.id !== id));
  const chores = getChores().map((c) => (c.categoryId === id ? { ...c, categoryId: null } : c));
  write(KEYS.chores, chores);
  return true;
}

// ---------- Domownicy ----------

export function getMembers() {
  return read(KEYS.members, []);
}

export function saveMember(member) {
  const members = getMembers();
  if (member.id) {
    const idx = members.findIndex((m) => m.id === member.id);
    if (idx >= 0) members[idx] = { ...members[idx], ...member };
    else members.push(member);
  } else {
    member.id = uid('member');
    members.push(member);
  }
  write(KEYS.members, members);
  return member;
}

export function deleteMember(id) {
  write(KEYS.members, getMembers().filter((m) => m.id !== id));
}

// ---------- Obowiązki (chores) ----------

export function getChores() {
  return read(KEYS.chores, []);
}

export function getChore(id) {
  return getChores().find((c) => c.id === id) || null;
}

export function saveChore(chore) {
  const chores = getChores();
  const now = new Date().toISOString();
  if (chore.id) {
    const idx = chores.findIndex((c) => c.id === chore.id);
    if (idx >= 0) {
      chores[idx] = { ...chores[idx], ...chore, updatedAt: now };
    } else {
      chores.push({ ...chore, updatedAt: now });
    }
  } else {
    chore.id = uid('chore');
    chore.createdAt = now;
    chore.updatedAt = now;
    chore.active = chore.active !== false;
    chore.lastCompletedAt = chore.lastCompletedAt || null;
    chores.push(chore);
  }
  write(KEYS.chores, chores);
  return chore;
}

export function deleteChore(id) {
  write(KEYS.chores, getChores().filter((c) => c.id !== id));
  const overrides = read(KEYS.overrides, {});
  for (const key of Object.keys(overrides)) {
    if (key.startsWith(`${id}|`)) delete overrides[key];
  }
  write(KEYS.overrides, overrides);
}

// ---------- Wystąpienia / statusy wykonania ----------

function overrideKey(choreId, dateKey) {
  return `${choreId}|${dateKey}`;
}

export function getOverrides() {
  return read(KEYS.overrides, {});
}

export function getOverride(choreId, dateKey) {
  return getOverrides()[overrideKey(choreId, dateKey)] || null;
}

/**
 * Ustawia status wystąpienia. Jeśli status === 'done' i obowiązek jest w trybie
 * 'rolling', aktualizuje też lastCompletedAt na obowiązku, żeby przesunąć kolejny termin.
 */
export function setOccurrenceStatus(choreId, dateKey, status, extra = {}) {
  const overrides = getOverrides();
  const key = overrideKey(choreId, dateKey);
  const existing = overrides[key] || {};
  overrides[key] = {
    ...existing, // zachowaj np. wcześniejszy override assigneeId/notes, jeśli `extra` go nie nadpisuje
    status,
    completedAt: status === 'done' ? new Date().toISOString() : null,
    ...extra,
  };
  write(KEYS.overrides, overrides);

  const chore = getChore(choreId);
  if (chore && chore.schedule.mode === 'rolling') {
    if (status === 'done') {
      saveChore({ ...chore, lastCompletedAt: dateKey });
    } else if (chore.lastCompletedAt === dateKey) {
      saveChore({ ...chore, lastCompletedAt: null });
    }
  }
}

// ---------- Motyw ----------

export function getThemePreference() {
  return read(KEYS.theme, 'auto'); // 'auto' | 'light' | 'dark'
}

export function setThemePreference(value) {
  write(KEYS.theme, value);
}

// ---------- Sesja / konto ----------
// Faza 1: brak prawdziwego backendu. "google" jest tu wyłącznie UI-przygotowaniem pod
// Fazę 2 (Google Identity Services, w pełni po stronie klienta) — patrz app.js, ekran
// Logowania nie wykonuje jeszcze prawdziwego OAuth, bo wymaga Client ID z Google Cloud
// Console, którego appka jeszcze nie ma skonfigurowanego.

export function getSession() {
  return read(KEYS.session, null);
}

export function setSession(session) {
  write(KEYS.session, session);
}

export function clearSession() {
  localStorage.removeItem(KEYS.session);
}

/** Które z "Domowników" to Ty na tym urządzeniu — decyduje, czyje punkty/poziom
 * liczą się jako "Twoje" (patrz gamification.js) i kogo automatycznie przypisujemy
 * jako wykonawcę, gdy odhaczasz cudze zadanie ("przejęcie" zadania). */
export function getMyMemberId() {
  return getSession()?.memberId || null;
}

export function setMyMemberId(memberId) {
  const session = getSession() || { mode: 'local' };
  setSession({ ...session, memberId });
}

// ---------- Migracja starszego modelu danych ----------
// Do wersji "v1" pole `chore.category` trzymało tryb częstotliwości (daily/frequent/
// rare/once). Od "v2" to `chore.frequencyTier`, a `category` odnosi się do nowego bytu
// Category (kolor + ikona, patrz "System kategorii" w architekturze projektu).

function migrateToV2() {
  let changed = false;
  const chores = getChores().map((c) => {
    if (c.category !== undefined && c.frequencyTier === undefined) {
      changed = true;
      const { category, ...rest } = c;
      return { ...rest, frequencyTier: category, categoryId: c.categoryId ?? null };
    }
    return c;
  });
  if (changed) write(KEYS.chores, chores);
  if (getCategories().length === 0) write(KEYS.categories, BUILTIN_CATEGORIES);
}

// ---------- Dane demonstracyjne ----------

export function ensureDemoData() {
  migrateToV2();
  if (read(KEYS.seeded, false)) return;

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const members = [
    { id: 'member_a', name: 'Domownik A', colorHex: '#4C6B57' },
    { id: 'member_b', name: 'Domownik B', colorHex: '#B45309' },
  ];
  write(KEYS.members, members);
  write(KEYS.categories, BUILTIN_CATEGORIES);

  const chores = [
    {
      id: 'chore_dishwasher',
      title: 'Zmywarka — rozładuj i załaduj',
      notes: '',
      checklist: ['Wyjmij czyste naczynia', 'Załaduj brudne naczynia', 'Uruchom program'],
      estimatedMinutes: 5,
      assigneeId: 'member_a',
      categoryId: 'kuchnia',
      frequencyTier: 'daily',
      schedule: { mode: 'fixed', unit: 'day', interval: 1, weekdays: null, anchorDate: todayKey, time: '19:00' },
      active: true,
      lastCompletedAt: null,
      createdAt: today.toISOString(),
      updatedAt: today.toISOString(),
    },
    {
      id: 'chore_vacuum',
      title: 'Odkurzanie mieszkania',
      notes: '',
      checklist: [],
      estimatedMinutes: 20,
      assigneeId: 'member_b',
      categoryId: 'odkurzanie',
      frequencyTier: 'frequent',
      schedule: { mode: 'fixed', unit: 'day', interval: 2, weekdays: null, anchorDate: todayKey, time: null },
      active: true,
      lastCompletedAt: null,
      createdAt: today.toISOString(),
      updatedAt: today.toISOString(),
    },
    {
      id: 'chore_toilet',
      title: 'Dezynfekcja toalety',
      notes: '',
      checklist: [],
      estimatedMinutes: 10,
      assigneeId: null,
      categoryId: 'lazienka',
      frequencyTier: 'frequent',
      schedule: { mode: 'fixed', unit: 'day', interval: 3, weekdays: null, anchorDate: todayKey, time: null },
      active: true,
      lastCompletedAt: null,
      createdAt: today.toISOString(),
      updatedAt: today.toISOString(),
    },
    {
      id: 'chore_windows',
      title: 'Mycie okien',
      notes: 'Pamiętaj o parapetach i ramach.',
      checklist: [],
      estimatedMinutes: 60,
      assigneeId: null,
      categoryId: 'mycie',
      frequencyTier: 'rare',
      schedule: { mode: 'rolling', unit: 'month', interval: 3, weekdays: null, anchorDate: todayKey, time: null },
      active: true,
      lastCompletedAt: null,
      createdAt: today.toISOString(),
      updatedAt: today.toISOString(),
    },
  ];
  write(KEYS.chores, chores);
  write(KEYS.overrides, {});
  write(KEYS.seeded, true);
}

export function resetAllData() {
  localStorage.removeItem(KEYS.members);
  localStorage.removeItem(KEYS.chores);
  localStorage.removeItem(KEYS.overrides);
  localStorage.removeItem(KEYS.categories);
  localStorage.removeItem(KEYS.seeded);
  ensureDemoData();
}
