// calendar-sync.js — Faza 2, krok 2: Google Calendar jako współdzielony backend danych.
//
// PROJEKT: appka nie ma backendu (patrz architektura), więc "serwerem" jest sam
// kalendarz Google, do którego oboje domownicy mają dostęp. Żeby uniknąć najbardziej
// skomplikowanej części (mapowania własnych trybów harmonogramu — zwłaszcza 'rolling',
// które nie ma odpowiednika w RRULE Google — na natywną powtarzalność Kalendarza),
// przyjęte podejście jest prostsze i solidniejsze:
//
// 1. KATALOG (domownicy, kategorie, definicje obowiązków) — trzymany jako JEDNO
//    "metadane" wydarzenie w kalendarzu, daleko w przeszłości (żeby nigdy nie było
//    widoczne w normalnym widoku), z pełnym stanem zakodowanym w extendedProperties
//    (pociętym na kawałki ≤1024 znaków — takie jest ograniczenie API na wartość
//    pojedynczej właściwości, patrz `encodeChunks`/`decodeChunks`). To ten sam JSON,
//    który dotąd żył tylko w localStorage — teraz jest to jego zapis "w chmurze".
//
// 2. WYSTĄPIENIA (occurrences) — każde wystąpienie obowiązku w oknie
//    [dziś − PAST_WINDOW_DAYS, dziś + FUTURE_WINDOW_DAYS] dostaje WŁASNE, prawdziwe
//    wydarzenie w Kalendarzu (widoczne obok innych spraw domowych — to była wyraźna
//    prośba: obowiązki mają być widoczne w normalnym widoku Kalendarza, nie ukryte).
//    Silnik powtarzalności (`recurrence.js`) działa dokładnie tak jak w Fazie 1 —
//    tu tylko doszło tworzenie/aktualizowanie/usuwanie odpowiadających wydarzeń.
//
// SYNCHRONIZACJA: brak backendu = brak jednego źródła prawdy poza samym Kalendarzem.
// Przyjęty model to "ostatni zapis wygrywa" — appka NIE scala konfliktów bit po bicie.
// Dla appki na 2 osoby, używanej asynchronicznie (nie edytujecie tego samego zadania
// w tej samej sekundzie), to rozsądny kompromis zamiast budowania pełnego CRDT/mergingu.
//
// Wywołania Google Calendar API v3 idą bezpośrednio przez fetch() (bez biblioteki
// gapi client — appka i tak minimalizuje zależności od CDN, patrz architektura).

import * as store from './storage.js';
import { getAccessToken } from './google-auth.js';
import { generateAllOccurrences, dateKey, addUnits } from './recurrence.js';

const API_BASE = 'https://www.googleapis.com/calendar/v3';
const PAST_WINDOW_DAYS = 14;
const FUTURE_WINDOW_DAYS = 45;
const CATALOG_ANCHOR_DATE = '2000-01-01'; // sentinel — nigdy nie wpada w normalny widok appki/Kalendarza
const CHUNK_SIZE = 900; // margines poniżej limitu API (1024 znaków na wartość właściwości)

// Przybliżona paleta colorId Google Calendar (11 stałych kolorów) — używana tylko
// żeby wystąpienia w Kalendarzu miały kolor zbliżony do koloru kategorii w appce.
const CALENDAR_COLOR_PALETTE = {
  '1': '7986CB', '2': '33B679', '3': '8E24AA', '4': 'E67C73', '5': 'F6BF26',
  '6': 'F4511E', '7': '039BE5', '8': '616161', '9': '3F51B5', '10': '0B8043', '11': 'D50000',
};

function hexDistance(a, b) {
  const pa = [parseInt(a.slice(0, 2), 16), parseInt(a.slice(2, 4), 16), parseInt(a.slice(4, 6), 16)];
  const pb = [parseInt(b.slice(0, 2), 16), parseInt(b.slice(2, 4), 16), parseInt(b.slice(4, 6), 16)];
  return Math.sqrt((pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2);
}

function nearestColorId(hex) {
  const clean = (hex || '').replace('#', '');
  if (clean.length !== 6) return undefined;
  let best = null;
  let bestDist = Infinity;
  for (const [id, pal] of Object.entries(CALENDAR_COLOR_PALETTE)) {
    const d = hexDistance(clean, pal);
    if (d < bestDist) { bestDist = d; best = id; }
  }
  return best;
}

// ---------- Kodowanie/dekodowanie danych w extendedProperties ----------
// Klucz `k` mówi, czym jest wydarzenie ('cp_catalog' | 'cp_occurrence'), a `p0..pN`
// + `pn` (liczba kawałków) trzymają JSON pocięty na kawałki mieszczące się w limicie
// pojedynczej wartości właściwości (patrz nagłówek pliku).

function encodeChunks(obj) {
  const json = JSON.stringify(obj);
  const chunks = [];
  for (let i = 0; i < json.length; i += CHUNK_SIZE) chunks.push(json.slice(i, i + CHUNK_SIZE));
  const props = { pn: String(chunks.length) };
  chunks.forEach((c, i) => { props[`p${i}`] = c; });
  return props;
}

function decodeChunks(props) {
  if (!props) return null;
  const n = Number(props.pn || 0);
  if (!n) return null;
  let json = '';
  for (let i = 0; i < n; i++) json += props[`p${i}`] || '';
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ---------- Niskopoziomowe wywołania Calendar API ----------

// Limit czasu na POJEDYNCZE zapytanie sieciowe do Calendar API. Bez tego pojedynczy
// utknięty fetch (np. telefon w trybie doze, przełączenie WiFi/komórkowe w trakcie
// requestu) blokował całą synchronizację bez końca, bo fetch() sam z siebie nie ma
// żadnego wbudowanego limitu czasu (zweryfikowany realny problem po pierwszym
// wdrożeniu poprawki dla getAccessToken — ten sam rodzaj zawieszenia mógł wystąpić
// też tutaj, nie tylko przy cichej odnowie tokenu).
const REQUEST_TIMEOUT_MS = 15000;

async function apiFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`calendar-api-${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function eventsPath(calendarId, suffix = '') {
  return `/calendars/${encodeURIComponent(calendarId)}/events${suffix}`;
}

async function listAllPages(calendarId, params) {
  let pageToken;
  const items = [];
  do {
    const qs = new URLSearchParams({ ...params, ...(pageToken ? { pageToken } : {}) });
    const page = await apiFetch(`${eventsPath(calendarId)}?${qs.toString()}`);
    items.push(...(page.items || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

// ---------- Katalog (domownicy / kategorie / obowiązki) ----------

async function findCatalogEvent(calendarId) {
  const dayStart = new Date(`${CATALOG_ANCHOR_DATE}T00:00:00Z`);
  const dayEnd = addUnits(dayStart, 'day', 1);
  const items = await listAllPages(calendarId, {
    sharedExtendedProperty: 'k=cp_catalog',
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    showDeleted: 'false',
    fields: 'items(id,extendedProperties,updated)',
  });
  return items[0] || null;
}

/** Wysyła lokalny katalog do kalendarza (tworzy wydarzenie-metadane albo je aktualizuje). */
export async function pushCatalog() {
  const calendarId = store.getCalendarId();
  if (!calendarId) return;
  const payload = {
    members: store.getMembers(),
    categories: store.getCategories(),
    chores: store.getChores(),
    updatedAt: new Date().toISOString(),
  };
  const existing = await findCatalogEvent(calendarId);
  const body = {
    summary: '⚙️ Cleaner Planner — dane aplikacji (nie usuwaj)',
    description: 'To wydarzenie trzyma dane appki Cleaner Planner (domownicy, kategorie, obowiązki). Nie edytuj go ręcznie — appka nadpisze zmiany przy kolejnej synchronizacji.',
    start: { date: CATALOG_ANCHOR_DATE },
    end: { date: CATALOG_ANCHOR_DATE },
    transparency: 'transparent',
    visibility: 'private',
    extendedProperties: { shared: { k: 'cp_catalog', ...encodeChunks(payload) } },
  };
  if (existing) {
    await apiFetch(eventsPath(calendarId, `/${existing.id}`), { method: 'PATCH', body: JSON.stringify(body) });
  } else {
    await apiFetch(eventsPath(calendarId), { method: 'POST', body: JSON.stringify(body) });
  }
  store.setCatalogRemoteVersion(payload.updatedAt);
}

/** Ściąga katalog z kalendarza i podmienia lokalną kopię, jeśli zdalna jest nowsza. */
async function pullCatalog(calendarId) {
  const existing = await findCatalogEvent(calendarId);
  if (!existing) return false;
  const payload = decodeChunks(existing.extendedProperties?.shared);
  if (!payload) return false;
  const lastKnown = store.getCatalogRemoteVersion();
  if (lastKnown && payload.updatedAt && payload.updatedAt <= lastKnown) return false; // nic nowego
  store.replaceCatalogFromRemote(payload);
  store.setCatalogRemoteVersion(payload.updatedAt || new Date().toISOString());
  return true;
}

// ---------- Wystąpienia (occurrences) ----------

function syncWindow() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return {
    start: addUnits(today, 'day', -PAST_WINDOW_DAYS),
    end: addUnits(today, 'day', FUTURE_WINDOW_DAYS),
  };
}

function occurrenceEventBody(chore, date, category, member, override) {
  const key = dateKey(date);
  const status = override?.status || 'pending';
  const assigneeId = override?.assigneeId ?? chore.assigneeId ?? null;
  const isDone = status === 'done';
  const title = `${isDone ? '✓ ' : ''}${chore.title}`;
  const descLines = [
    chore.notes || '',
    member ? `Wykonawca: ${member.name}` : 'Wykonawca: ktokolwiek',
    `Szacowany czas: ${chore.estimatedMinutes || 5} min`,
    '',
    '(Zarządzane przez appkę Cleaner Planner — status zmieniaj w appce, nie tutaj.)',
  ].filter(Boolean);

  const body = {
    summary: title,
    description: descLines.join('\n'),
    transparency: isDone ? 'transparent' : 'opaque',
    colorId: isDone ? '8' : (category ? nearestColorId(category.colorHex) : undefined),
    extendedProperties: {
      shared: {
        k: 'cp_occurrence',
        choreId: chore.id,
        dateKey: key,
        status,
        assigneeId: assigneeId || '',
        completedAt: override?.completedAt || '',
      },
    },
  };

  if (chore.schedule.time) {
    const [h, m] = chore.schedule.time.split(':').map(Number);
    const start = new Date(date);
    start.setHours(h, m, 0, 0);
    const end = new Date(start.getTime() + (chore.estimatedMinutes || 15) * 60000);
    body.start = { dateTime: start.toISOString() };
    body.end = { dateTime: end.toISOString() };
  } else {
    const endDate = addUnits(date, 'day', 1);
    body.start = { date: key };
    body.end = { date: dateKey(endDate) };
  }
  return body;
}

/** Tworzy/aktualizuje/usuwa wydarzenia dla wystąpień w oknie synchronizacji, dla
 * wszystkich AKTYWNYCH obowiązków. Wołane po każdej lokalnej zmianie (patrz `pushLocal`)
 * i przy starcie/odświeżeniu appki. */
async function reconcileOccurrences() {
  const calendarId = store.getCalendarId();
  if (!calendarId) return;
  const { start, end } = syncWindow();
  const chores = store.getChores().filter((c) => c.active);
  const categories = store.getCategories();
  const members = store.getMembers();
  const occurrences = generateAllOccurrences(chores, start, end);
  const eventMap = store.getOccurrenceEventMap();
  const seenKeys = new Set();

  for (const occ of occurrences) {
    const chore = chores.find((c) => c.id === occ.choreId);
    if (!chore) continue;
    const key = `${chore.id}|${dateKey(occ.date)}`;
    seenKeys.add(key);
    const override = store.getOverride(chore.id, dateKey(occ.date));
    const category = categories.find((c) => c.id === chore.categoryId) || null;
    const assigneeId = override?.assigneeId ?? chore.assigneeId ?? null;
    const member = members.find((m) => m.id === assigneeId) || null;
    const body = occurrenceEventBody(chore, occ.date, category, member, override);
    const existingId = eventMap[key];
    try {
      if (existingId) {
        await apiFetch(eventsPath(calendarId, `/${existingId}`), { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        const created = await apiFetch(eventsPath(calendarId), { method: 'POST', body: JSON.stringify(body) });
        store.setOccurrenceEventId(chore.id, dateKey(occ.date), created.id);
      }
    } catch (err) {
      console.error('Nie udało się zsynchronizować wystąpienia', key, err);
    }
  }

  // Wydarzenia w mapie, których wystąpienie już nie istnieje w oknie (np. obowiązek
  // dezaktywowany/usunięty, albo dla 'rolling' termin przesunął się dalej) — usuwamy.
  for (const key of Object.keys(eventMap)) {
    if (seenKeys.has(key)) continue;
    const [choreId, dk] = key.split('|');
    try {
      await apiFetch(eventsPath(calendarId, `/${eventMap[key]}`), { method: 'DELETE' });
    } catch (err) {
      // 410/404 = już usunięte po drugiej stronie, to nie jest błąd
    }
    store.deleteOccurrenceEventId(choreId, dk);
  }
}

/** Ściąga z kalendarza statusy wystąpień w oknie synchronizacji (np. zmienione przez
 * drugiego domownika na jego urządzeniu) i scala je do lokalnych `overrides`. */
async function pullOccurrences(calendarId) {
  const { start, end } = syncWindow();
  const items = await listAllPages(calendarId, {
    sharedExtendedProperty: 'k=cp_occurrence',
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: 'true',
    showDeleted: 'false',
    fields: 'items(id,extendedProperties)',
  });
  const overridesPatch = {};
  for (const item of items) {
    const props = item.extendedProperties?.shared;
    if (!props?.choreId || !props?.dateKey) continue;
    overridesPatch[`${props.choreId}|${props.dateKey}`] = {
      status: props.status || 'pending',
      assigneeId: props.assigneeId || null,
      completedAt: props.completedAt || null,
    };
    store.setOccurrenceEventId(props.choreId, props.dateKey, item.id);
  }
  if (Object.keys(overridesPatch).length) store.mergeOverridesFromRemote(overridesPatch);
}

// ---------- Orkiestracja ----------

let pushTimer = null;
let syncing = false;
const listeners = new Set();

function notifyStatus(status, detail) {
  for (const fn of listeners) {
    try { fn(status, detail); } catch { /* noop */ }
  }
}

export function onSyncStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isConfigured() {
  return !!store.getCalendarId();
}

// Watchdog na CAŁĄ operację push/pull, niezależny od pojedynczych timeoutów fetchy
// (REQUEST_TIMEOUT_MS w apiFetch, timeout w getAccessToken). To ostatnia linia
// obrony: gdyby COKOLWIEK w łańcuchu wywołań utknęło w sposób, którego nie
// przewidzieliśmy (np. pętla paginacji, przeglądarka usypia kartę w trakcie
// requestu), ten watchdog i tak po pewnym czasie odda kontrolę z powrotem,
// zresetuje flagę `syncing` i pokaże błąd zamiast trzymać appkę w "Synchronizuję..."
// bez końca i bez możliwości ręcznego ponowienia (przycisk jest zablokowany,
// dopóki `syncing` jest true).
const OVERALL_SYNC_TIMEOUT_MS = 25000;

function withTimeout(promise, ms, code) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/** Pociągnięte po starcie appki / focusie okna / co jakiś czas — nigdy nie wypycha
 * lokalnych zmian, tylko sprowadza to, co zmieniło się po drugiej stronie. */
export async function pullRemote() {
  const calendarId = store.getCalendarId();
  if (!calendarId || syncing) return;
  syncing = true;
  notifyStatus('syncing');
  try {
    await withTimeout((async () => {
      await pullCatalog(calendarId);
      await pullOccurrences(calendarId);
      await reconcileOccurrences(); // domyka nowe/zmienione obowiązki z pociągniętego katalogu
    })(), OVERALL_SYNC_TIMEOUT_MS, 'sync-timeout');
    notifyStatus('ok', { at: new Date().toISOString() });
  } catch (err) {
    console.error('Synchronizacja (pull) nie powiodła się', err);
    notifyStatus('error', { message: describeError(err) });
  } finally {
    syncing = false;
  }
}

/** Wypycha katalog + przelicza wystąpienia w oknie synchronizacji. Używane zarówno
 * przez debounced `pushLocal` (po każdej lokalnej zmianie), jak i przez `connect()`
 * (pierwsze, natychmiastowe wypchnięcie zaraz po podaniu ID kalendarza). */
async function doPush() {
  const calendarId = store.getCalendarId();
  if (!calendarId || syncing) return;
  syncing = true;
  notifyStatus('syncing');
  try {
    await withTimeout((async () => {
      await pushCatalog();
      await reconcileOccurrences();
    })(), OVERALL_SYNC_TIMEOUT_MS, 'sync-timeout');
    notifyStatus('ok', { at: new Date().toISOString() });
  } catch (err) {
    console.error('Synchronizacja (push) nie powiodła się', err);
    notifyStatus('error', { message: describeError(err) });
  } finally {
    syncing = false;
  }
}

/** Wywoływane (z debounce) po każdej lokalnej zmianie. */
function pushLocal() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(doPush, 800);
}

function describeError(err) {
  const msg = err?.message || '';
  const name = err?.name || '';
  if (msg === 'reauth-required') return 'Sesja Google wygasła — zaloguj się ponownie w Koncie, żeby wznowić synchronizację.';
  if (msg === 'token-timeout') return 'Odświeżenie sesji Google nie odpowiedziało na czas — spróbuj "Synchronizuj teraz" jeszcze raz, a jeśli to nie pomoże, zaloguj się ponownie w Koncie.';
  if (msg === 'sync-timeout') return 'Synchronizacja trwała zbyt długo i została przerwana — sprawdź internet i spróbuj "Synchronizuj teraz" jeszcze raz.';
  if (name === 'TimeoutError' || name === 'AbortError' || msg.includes('aborted') || msg.includes('signal')) {
    return 'Połączenie z Google Calendar przerwane (za wolny internet) — spróbuj ponownie.';
  }
  if (msg.startsWith('calendar-api-404')) return 'Nie znaleziono kalendarza — sprawdź, czy ID kalendarza w Koncie jest poprawne.';
  if (msg.startsWith('calendar-api-403')) return 'Brak dostępu do kalendarza — sprawdź, czy jest udostępniony temu kontu Google z prawem edycji.';
  return 'Nie udało się zsynchronizować z Google Calendar. Sprawdź internet i spróbuj ponownie.';
}

let initialized = false;

/** Wołane raz przy starcie appki, jeśli sesja to Google i kalendarz jest skonfigurowany
 * (patrz app.js init()). Podpina push-na-każdą-zmianę i uruchamia pierwszy pull. */
export function init() {
  if (initialized) return;
  initialized = true;
  store.onWrite(() => pushLocal());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pullRemote();
  });
  window.addEventListener('focus', () => pullRemote());
  setInterval(() => pullRemote(), 60000); // co minutę, tylko gdy appka jest otwarta
  pullRemote();
}

/** Ręczna synchronizacja na żądanie (przycisk "Synchronizuj teraz" w Koncie). */
export async function syncNow() {
  await pullRemote();
}

/** Wołane raz, zaraz po tym jak użytkownik po raz pierwszy poda ID kalendarza
 * w Koncie. W odróżnieniu od `init()` (który tylko ciągnie dane z kalendarza),
 * najpierw NATYCHMIAST wypycha lokalny katalog i wystąpienia — bez tego świeżo
 * podłączony, pusty kalendarz nigdy nie dostałby danych, dopóki coś lokalnie się
 * nie zmieni (pull sam z siebie niczego nie tworzy). */
export async function connect() {
  await doPush();
  init();
}
