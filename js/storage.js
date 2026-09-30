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
  calendarId: 'cp_calendar_id', // ID współdzielonego kalendarza Google (Faza 2, krok 2)
  occurrenceEvents: 'cp_occurrence_events', // { "choreId|YYYY-MM-DD": googleEventId } — mapa lokalna, patrz calendar-sync.js
  catalogRemoteVersion: 'cp_catalog_remote_version', // ostatnio pobrany znacznik wersji katalogu z kalendarza
  templates: 'cp_templates', // biblioteka szablonów obowiązków (patrz "Szablony" niżej)
  templatesSeeded: 'cp_templates_seeded_v1',
  household: 'cp_household', // ustawienia wspólne dla całego domu, np. { vacations: [{ from, until }] }
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

// ---------- Hook zapisu (dla calendar-sync.js) ----------
// storage.js celowo NIC nie wie o Google Calendar — zamiast importować calendar-sync.js
// tutaj (co dałoby cykliczny import: calendar-sync.js i tak musi czytać dane STĄD),
// wystawia prosty rejestr callbacków wywoływanych po każdym lokalnym zapisie. app.js
// przy starcie rejestruje w tym miejscu funkcję z calendar-sync.js, jeśli konto jest
// zalogowane przez Google i ma ustawiony kalendarz (patrz init() w app.js).

const writeHooks = [];

export function onWrite(fn) {
  writeHooks.push(fn);
}

function notifyWrite(type, payload) {
  for (const fn of writeHooks) {
    try {
      fn(type, payload);
    } catch (err) {
      console.error('storage write hook error', err);
    }
  }
}

// ---------- Kategorie obowiązków = POMIESZCZENIA (zmienione 28.09.2026) ----------
// Osobny byt od trybu harmonogramu — patrz "System kategorii" w architekturze projektu.
// Do 28.09.2026 kategorie opisywały TYP czynności (Mycie/Odkurzanie/Śmieci/...).
// Na wyraźną prośbę użytkownika appka przeszła na POMIESZCZENIA (Kuchnia/Łazienka/
// Salon/Sypialnia/Klatka schodowa + "Inne" jako furtka dla obowiązków bez jednego
// konkretnego pomieszczenia) — to naturalniejszy sposób grupowania przy korzystaniu
// z biblioteki Szablonów (patrz niżej), gdzie obowiązki i tak są organizowane per
// pokój. Kształt danych (id/name/colorHex/icon/builtIn) się nie zmienił — tylko to,
// CO te 6 wbudowanych wpisów reprezentuje — więc reszta appki (categoryId na
// obowiązku, CRUD kategorii) działa bez zmian. `kuchnia`/`lazienka`/`inne` celowo
// zachowują swoje stare ID i kolory (już wcześniej były pomieszczeniami/miały
// dostrojony kontrast w dark mode) — patrz `migrateToV3()` niżej za to, jak appka
// przenosi obowiązki istniejących użytkowników z usuniętych kategorii (mycie/
// odkurzanie/smieci) na te nowe.
const BUILTIN_CATEGORIES = [
  { id: 'kuchnia', name: 'Kuchnia', colorHex: '#4C6B57', icon: 'utensils', builtIn: true },
  { id: 'lazienka', name: 'Łazienka', colorHex: '#7A5C9E', icon: 'sparkle', builtIn: true },
  { id: 'salon', name: 'Salon', colorHex: '#3B7DD8', icon: 'sofa', builtIn: true },
  { id: 'sypialnia', name: 'Sypialnia', colorHex: '#A6862F', icon: 'bed', builtIn: true },
  { id: 'klatka', name: 'Klatka schodowa', colorHex: '#6B7280', icon: 'stairs', builtIn: true },
  { id: 'inne', name: 'Inne', colorHex: '#C0703A', icon: 'tag', builtIn: true },
];

/** Migracja z kategorii-typu-czynności na kategorie-pomieszczenia (28.09.2026).
 * Wołana bezwarunkowo z `ensureDemoData()` (jak `migrateToV2()`) — sama wykrywa,
 * czy jest jeszcze co migrować (obecność starych wbudowanych ID), więc jest
 * bezpieczna do wołania przy każdym starcie appki. Obowiązki wskazujące usunięte
 * kategorie 'mycie'/'odkurzanie'/'smieci' dostają 'inne' zamiast zostać osierocone
 * (bez pomieszczenia) — użytkownik może im ręcznie przypisać właściwy pokój.
 * Własne kategorie dodane wcześniej przez użytkownika (builtIn: false) zostają
 * nietknięte. */
function migrateToV3() {
  const existing = getCategories();
  const hasOldBuiltins = existing.some((c) => c.builtIn && ['mycie', 'odkurzanie', 'smieci'].includes(c.id));
  if (!hasOldBuiltins) return;

  const remap = { mycie: 'inne', odkurzanie: 'inne', smieci: 'inne' };
  let changed = false;
  const chores = getChores().map((c) => {
    if (c.categoryId && remap[c.categoryId]) {
      changed = true;
      return { ...c, categoryId: remap[c.categoryId] };
    }
    return c;
  });
  if (changed) write(KEYS.chores, chores);

  const customCategories = existing.filter((c) => !c.builtIn);
  write(KEYS.categories, [...BUILTIN_CATEGORIES, ...customCategories]);
}

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
  notifyWrite('category', category);
  return category;
}

/** Usuwa kategorię (nie da się usunąć wbudowanej) i odpina ją od obowiązków, które jej używały. */
export function deleteCategory(id) {
  const category = getCategory(id);
  if (!category || category.builtIn) return false;
  write(KEYS.categories, getCategories().filter((c) => c.id !== id));
  const chores = getChores().map((c) => (c.categoryId === id ? { ...c, categoryId: null } : c));
  write(KEYS.chores, chores);
  notifyWrite('category-delete', { id });
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
  notifyWrite('member', member);
  return member;
}

export function deleteMember(id) {
  write(KEYS.members, getMembers().filter((m) => m.id !== id));
  notifyWrite('member-delete', { id });
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
  notifyWrite('chore', chore);
  return chore;
}

export function deleteChore(id) {
  write(KEYS.chores, getChores().filter((c) => c.id !== id));
  const overrides = read(KEYS.overrides, {});
  for (const key of Object.keys(overrides)) {
    if (key.startsWith(`${id}|`)) delete overrides[key];
  }
  write(KEYS.overrides, overrides);
  notifyWrite('chore-delete', { id });
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
 * Ustawia status wystąpienia: 'pending' | 'done' | 'skipped'. "Pominięte" zamyka
 * wystąpienie bez punktów, ale nie przerywa passy (patrz gamification.js).
 * Jeśli obowiązek jest w trybie 'rolling', 'done' i 'skipped' aktualizują też
 * lastCompletedAt, żeby przesunąć kolejny termin; powrót do 'pending' go cofa.
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
  notifyWrite('occurrence', { choreId, dateKey, override: overrides[key] });

  const chore = getChore(choreId);
  if (chore && chore.schedule.mode === 'rolling') {
    if (status === 'done' || status === 'skipped') {
      saveChore({ ...chore, lastCompletedAt: dateKey });
    } else if (chore.lastCompletedAt === dateKey) {
      saveChore({ ...chore, lastCompletedAt: null });
    }
  }
}

/** Stan wystąpienia sprzed zmiany — do "Cofnij" w toaście. Obejmuje też
 * lastCompletedAt obowiązku, bo dla trybu 'rolling' zmiana statusu go przesuwa, a
 * zwykłe ustawienie 'pending' nie przywróciłoby wcześniejszej daty wykonania. */
export function getOccurrenceSnapshot(choreId, dateKey) {
  const override = getOverride(choreId, dateKey);
  return {
    choreId,
    dateKey,
    override: override ? { ...override } : null,
    lastCompletedAt: getChore(choreId)?.lastCompletedAt ?? null,
  };
}

export function restoreOccurrenceSnapshot(snapshot) {
  const { choreId, dateKey } = snapshot;
  const overrides = getOverrides();
  const key = overrideKey(choreId, dateKey);
  if (snapshot.override) overrides[key] = snapshot.override;
  else delete overrides[key];
  write(KEYS.overrides, overrides);
  notifyWrite('occurrence', { choreId, dateKey, override: overrides[key] || null });

  const chore = getChore(choreId);
  if (chore && chore.schedule.mode === 'rolling' && chore.lastCompletedAt !== snapshot.lastCompletedAt) {
    saveChore({ ...chore, lastCompletedAt: snapshot.lastCompletedAt });
  }
}

// ---------- Ustawienia domu (tryb urlopowy) ----------
// Wspólne dla wszystkich domowników — dlatego jadą w katalogu synchronizowanym z
// kalendarzem (patrz pushCatalog w calendar-sync.js), a nie w sesji tego urządzenia.
// Urlopy to lista okresów { from, until } ('YYYY-MM-DD', until === null = do odwołania):
// zakończone zostają w historii, żeby dni z dawnego urlopu nie wróciły jako zaległe
// ani nie przerwały passy po włączeniu kolejnego.

const MAX_VACATIONS = 12;

export function getHousehold() {
  return read(KEYS.household, {});
}

function saveHousehold(household) {
  write(KEYS.household, household);
  notifyWrite('household', household);
}

export function getVacations() {
  return getHousehold().vacations || [];
}

/** Urlop obejmujący dany dzień (albo null). */
export function getActiveVacation(todayKey) {
  return getVacations().find((v) => v.from <= todayKey && (!v.until || v.until >= todayKey)) || null;
}

export function startVacation(fromKey, untilKey) {
  const vacations = [...getVacations(), { from: fromKey, until: untilKey || null }].slice(-MAX_VACATIONS);
  saveHousehold({ ...getHousehold(), vacations });
}

/** Kończy urlop trwający w `todayKey`: zaczęty wcześniej kończy się wczoraj (dni
 * urlopu zostają usprawiedliwione), zaczęty dziś po prostu znika. */
export function endVacation(todayKey, yesterdayKey) {
  const vacations = getVacations()
    .map((v) => {
      const active = v.from <= todayKey && (!v.until || v.until >= todayKey);
      if (!active) return v;
      return v.from < todayKey ? { ...v, until: yesterdayKey } : null;
    })
    .filter(Boolean);
  saveHousehold({ ...getHousehold(), vacations });
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

// Po realnym zalogowaniu przez Google appka zna imię/e-mail konta — zamiast zostawiać
// "Kim jesteś" na generycznym domowniku (np. "Domownik A" z danych demo), podpina
// zalogowane konto pod konkretnego domownika. Wołane: (1) od razu po zalogowaniu,
// (2) PONOWNIE przez calendar-sync.js po każdym ściągnięciu współdzielonego katalogu
// z kalendarza — bo dopiero wtedy appka widzi PRAWDZIWĄ, wspólną listę domowników
// (np. gdy drugi domownik połączył się z kalendarzem wcześniej i to jego dane są tam
// od początku). Dlatego dopasowanie NIE może polegać na "pierwszy domownik na liście"
// (to zależy tylko od tego, co akurat wylosowały dane demo NA TYM urządzeniu) — jedyny
// pewny sygnał "ten domownik nie jest jeszcze niczyj" to brak przypisanego e-maila.
export function claimMemberForIdentity(profile) {
  const members = getMembers();
  const email = (profile.email || '').trim().toLowerCase();
  const name = (profile.name || '').trim();
  if (!email && !name) return null;

  // 1) Już wcześniej dopasowany po e-mailu (ponowne logowanie na tym samym
  //    urządzeniu, albo ta tożsamość była już dopasowana wcześniej) — użyj bez zmian.
  let match = email ? members.find((m) => (m.email || '').trim().toLowerCase() === email) : null;

  // 2) Jeszcze niczyj (brak e-maila) domownik o nazwie już zgadzającej się z Google —
  //    tylko wśród nieprzypisanych, żeby przypadkowa zgodność nazw nie podkradła
  //    slotu, który jest już czyjś.
  if (!match && name) {
    match = members.find((m) => !m.email && (m.name || '').trim().toLowerCase() === name.toLowerCase());
  }

  if (match) {
    const patch = { id: match.id };
    if (email && (match.email || '').trim().toLowerCase() !== email) patch.email = profile.email;
    if (name && !match.email) patch.name = name; // nadpisz nazwę tylko dopóki slot jest jeszcze niczyj
    if (Object.keys(patch).length > 1) saveMember(patch);
    setMyMemberId(match.id);
    return match.id;
  }

  // 3) Żaden domownik nie jest jeszcze Tobą — zajmij pierwszy NIEPRZYPISANY slot
  //    (bez e-maila). To naprawia sytuację, w której obaj domownicy startowali z
  //    identycznych lokalnych danych demo (te same ID "member_a"/"member_b" na
  //    każdym urządzeniu) i mogliby inaczej oboje "podpiąć się" pod tego samego
  //    (pierwszego) domownika.
  const unclaimed = members.find((m) => !m.email);
  if (unclaimed) {
    saveMember({ id: unclaimed.id, name: name || unclaimed.name, email: profile.email || undefined });
    setMyMemberId(unclaimed.id);
    return unclaimed.id;
  }

  // 4) Brak wolnych slotów (obaj już przypisani, do kogo innego) — dołóż nowego
  //    domownika zamiast przejmować cudzy.
  const created = saveMember({
    name: name || 'Nowy domownik',
    email: profile.email || undefined,
    colorHex: members.length % 2 === 0 ? '#4C6B57' : '#B45309',
  });
  setMyMemberId(created.id);
  return created.id;
}

// ---------- Szablony obowiązków (dodane 28.09.2026, na życzenie użytkownika) ----------
// Gotowe, wstępnie skonfigurowane definicje obowiązków (nazwa + pomieszczenie +
// harmonogram + szac. czas), pogrupowane wg pomieszczenia — punkt wyjścia do szybkiego
// "wdrożenia" typowego obowiązku zamiast konfigurowania go od zera za każdym razem.
// Kształt szablonu to podzbiór pól obowiązku (patrz "Chore" w architekturze) — BEZ
// `assigneeId` (kto wykonuje to decyzja przy każdym konkretnym obowiązku, nie część
// presetu) i BEZ `schedule.anchorDate`/`time` (data startowa nie ma sensu w oderwaniu
// od konkretnego zastosowania — appka wypełnia ją dopiero w formularzu, na dzień
// dzisiejszy, patrz `makeDraftFromTemplate()` w app.js). Szablony NIE są danymi demo:
// zostają nawet po "Usuń wszystkie dane i wczytaj przykładowe" (Konto → Dane) i są w pełni edytowalne/usuwalne,
// łącznie z tymi wbudowanymi (`builtIn` to tu tylko informacja, nie ochrona przed
// edycją/usunięciem — w odróżnieniu od wbudowanych Kategorii/Pomieszczeń).

export function getTemplates() {
  return read(KEYS.templates, []);
}

export function saveTemplate(template) {
  const templates = getTemplates();
  if (template.id) {
    const idx = templates.findIndex((t) => t.id === template.id);
    if (idx >= 0) templates[idx] = { ...templates[idx], ...template };
    else templates.push(template);
  } else {
    template.id = uid('tmpl');
    template.builtIn = false;
    templates.push(template);
  }
  write(KEYS.templates, templates);
  notifyWrite('template', template);
  return template;
}

export function deleteTemplate(id) {
  write(KEYS.templates, getTemplates().filter((t) => t.id !== id));
  notifyWrite('template-delete', { id });
}

function tmpl(title, categoryId, estimatedMinutes, schedule) {
  return {
    id: uid('tmpl'),
    title,
    notes: '',
    checklist: [],
    estimatedMinutes,
    categoryId,
    builtIn: true,
    schedule: { unit: 'day', interval: 1, weekdays: null, ...schedule },
  };
}

/** Zasiewa bibliotekę wbudowanych szablonów RAZ (flaga `templatesSeeded`) — potem
 * appka zostawia ją w spokoju, żeby nie nadpisywać edycji/usunięć użytkownika przy
 * każdym starcie. Wołane bezwarunkowo z `ensureDemoData()`, więc dotyczy też osób,
 * które już korzystają z appki (nie tylko świeżych instalacji). */
function ensureTemplateSeed() {
  if (read(KEYS.templatesSeeded, false)) return;
  const templates = [
    // Łazienka
    tmpl('Mycie toalety', 'lazienka', 5, { mode: 'fixed', interval: 2 }),
    tmpl('Mycie wanny / prysznica', 'lazienka', 10, { mode: 'fixed', interval: 7 }),
    tmpl('Mycie okien', 'lazienka', 20, { mode: 'rolling', unit: 'month', interval: 3 }),
    tmpl('Czyszczenie lustra i umywalki', 'lazienka', 5, { mode: 'fixed', interval: 3 }),
    // Kuchnia
    tmpl('Mycie podłogi', 'kuchnia', 10, { mode: 'fixed', interval: 3 }),
    tmpl('Czyszczenie blatów', 'kuchnia', 5, { mode: 'fixed', interval: 1 }),
    tmpl('Czyszczenie lodówki', 'kuchnia', 20, { mode: 'rolling', unit: 'month', interval: 1 }),
    tmpl('Wyniesienie śmieci', 'kuchnia', 3, { mode: 'fixed', interval: 2 }),
    tmpl('Odkamienianie czajnika', 'kuchnia', 10, { mode: 'rolling', unit: 'month', interval: 1 }),
    // Salon
    tmpl('Odkurzanie', 'salon', 15, { mode: 'fixed', interval: 3 }),
    tmpl('Wycieranie kurzu', 'salon', 10, { mode: 'fixed', interval: 7 }),
    tmpl('Mycie okien', 'salon', 25, { mode: 'rolling', unit: 'month', interval: 3 }),
    tmpl('Odkurzanie kanapy / tapicerki', 'salon', 15, { mode: 'rolling', unit: 'month', interval: 1 }),
    // Sypialnia
    tmpl('Zmiana pościeli', 'sypialnia', 10, { mode: 'fixed', interval: 14 }),
    tmpl('Odkurzanie', 'sypialnia', 10, { mode: 'fixed', interval: 7 }),
    tmpl('Wycieranie kurzu', 'sypialnia', 5, { mode: 'fixed', interval: 7 }),
    // Klatka schodowa
    tmpl('Mycie schodów / podłogi', 'klatka', 15, { mode: 'fixed', interval: 7 }),
    tmpl('Wycieranie poręczy i włączników', 'klatka', 5, { mode: 'fixed', interval: 7 }),
  ];
  write(KEYS.templates, templates);
  write(KEYS.templatesSeeded, true);
}

// ---------- Synchronizacja z Google Calendar (Faza 2, krok 2) ----------
// Ten blok to jedyne miejsce, które wie o ISTNIENIU synchronizacji z kalendarzem —
// ale nie o samym Google Calendar API (to wie tylko calendar-sync.js, patrz `onWrite`
// wyżej). Trzyma: ID kalendarza, do którego appka pisze/z którego czyta, lokalną
// mapę "który wpis w Kalendarzu odpowiada któremu wystąpieniu" (żeby przy kolejnej
// synchronizacji aktualizować istniejące wydarzenia zamiast tworzyć duplikaty) oraz
// znacznik ostatnio pobranej wersji katalogu (domownicy/kategorie/obowiązki), żeby
// rozstrzygać czy zdalna kopia jest nowsza od lokalnej.

export function getCalendarId() {
  return read(KEYS.calendarId, '');
}

export function setCalendarId(id) {
  write(KEYS.calendarId, (id || '').trim());
}

export function getOccurrenceEventMap() {
  return read(KEYS.occurrenceEvents, {});
}

export function setOccurrenceEventId(choreId, dateKey, googleEventId) {
  const map = getOccurrenceEventMap();
  map[overrideKey(choreId, dateKey)] = googleEventId;
  write(KEYS.occurrenceEvents, map);
}

export function deleteOccurrenceEventId(choreId, dateKey) {
  const map = getOccurrenceEventMap();
  delete map[overrideKey(choreId, dateKey)];
  write(KEYS.occurrenceEvents, map);
}

export function getCatalogRemoteVersion() {
  return read(KEYS.catalogRemoteVersion, null);
}

export function setCatalogRemoteVersion(version) {
  write(KEYS.catalogRemoteVersion, version);
}

/**
 * Nadpisuje lokalny katalog (domownicy/kategorie/obowiązki/szablony) danymi
 * ściągniętymi z kalendarza, BEZ wywoływania write hooków — to jest strona "pull",
 * więc nie może z powrotem wywołać push-u do kalendarza (pętla). Statusy wystąpień
 * (`overrides`) celowo zostają nietknięte — te przychodzą osobno, per wystąpienie,
 * przez `replaceOverridesForRange`. `templates` jest opcjonalne w payloadzie (starsze
 * urządzenia mogły wypchnąć katalog sprzed dodania szablonów) — brak klucza zostawia
 * lokalną bibliotekę szablonów nietkniętą zamiast ją czyścić.
 */
export function replaceCatalogFromRemote({ members, categories, chores, templates, household }) {
  if (members) write(KEYS.members, members);
  if (categories) write(KEYS.categories, categories);
  if (chores) write(KEYS.chores, chores);
  if (templates) write(KEYS.templates, templates);
  if (household) write(KEYS.household, household);
}

/** Jak wyżej, ale dla mapy statusów wystąpień w danym oknie dat (merge, nie replace
 * całości — appka trzyma tylko okno +/- kilkudziesięciu dni w Kalendarzu, starsze
 * lokalne overrides spoza okna zostają nietknięte). */
export function mergeOverridesFromRemote(partialOverrides) {
  const overrides = getOverrides();
  write(KEYS.overrides, { ...overrides, ...partialOverrides });
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
  migrateToV3();
  ensureTemplateSeed();
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
      categoryId: 'salon',
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
      categoryId: null, // dotyczy całego mieszkania, bez jednego konkretnego pomieszczenia
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
  localStorage.removeItem(KEYS.household);
  ensureDemoData();
}
