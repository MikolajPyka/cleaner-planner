// gamification.js — lekki system motywacyjny: passa dni, punkty, poziom.
// Celowo prosty (żadnej dodatkowej bazy/danych) — wszystko liczone na bieżąco
// z istniejących obowiązków i statusów wykonania.

import { dateKey, addUnits, generateAllOccurrences } from './recurrence.js';

// Nazwy ikon odnoszą się do biblioteki w js/icons.js (spójnej ze statycznym podglądem).
const LEVELS = [
  { min: 0, title: 'Nowicjusz sprzątania', icon: 'leaf' },
  { min: 50, title: 'Ogarnięty domownik', icon: 'medal' },
  { min: 150, title: 'Wojownik czystości', icon: 'shield-check' },
  { min: 300, title: 'Mistrz odkurzacza', icon: 'flash' },
  { min: 600, title: 'Legenda porządku', icon: 'trophy' },
];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Punkty za wykonane zadanie: 1 pkt za każde 5 minut szacowanego czasu (min. 1 pkt). */
function pointsFor(chore) {
  return Math.max(1, Math.round((chore.estimatedMinutes || 5) / 5));
}

/**
 * Sumuje punkty ze wszystkich dotąd wykonanych wystąpień.
 * Gdy podano `forMemberId`, liczy tylko wystąpienia, których FAKTYCZNY wykonawca
 * (override.assigneeId, a w jego braku domyślny assigneeId obowiązku) to ta osoba —
 * dzięki temu punkty/poziom są "Twoje", a nie wspólne dla całego domu.
 */
export function computeTotalPoints(chores, overrides, forMemberId = null) {
  const choreById = new Map(chores.map((c) => [c.id, c]));
  let total = 0;
  for (const key of Object.keys(overrides)) {
    const entry = overrides[key];
    if (entry.status !== 'done') continue;
    const choreId = key.split('|')[0];
    const chore = choreById.get(choreId);
    if (!chore) continue;
    if (forMemberId) {
      const effectiveAssignee = entry.assigneeId ?? chore.assigneeId ?? null;
      if (effectiveAssignee !== forMemberId) continue;
    }
    total += pointsFor(chore);
  }
  return total;
}

/** Zwraca aktualny poziom (tytuł + ikonę) i próg następnego poziomu. */
export function computeLevel(points) {
  let current = LEVELS[0];
  let next = LEVELS[1] || null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (points >= LEVELS[i].min) {
      current = LEVELS[i];
      next = LEVELS[i + 1] || null;
    }
  }
  return { ...current, points, next };
}

/**
 * Liczy passę kolejnych dni, w których wszystkie obowiązki zaplanowane na dany
 * dzień zostały wykonane. Dni bez żadnych zaplanowanych obowiązków nie przerywają
 * passy (po prostu są pomijane). Dzisiejszy, jeszcze niedokończony dzień też jej
 * nie przerywa — liczy się dopiero od jutra wstecz.
 */
export function computeStreak(chores, getOverrideFn) {
  const today = startOfDay(new Date());
  let streak = 0;
  let cursor = today;
  for (let i = 0; i < 365; i++) {
    const dayOccs = generateAllOccurrences(chores, cursor, cursor);
    if (dayOccs.length > 0) {
      const allDone = dayOccs.every((o) => getOverrideFn(o.choreId, dateKey(o.date))?.status === 'done');
      if (allDone) {
        streak++;
      } else if (i > 0) {
        break; // dzień (poza dzisiejszym) z niewykonanym obowiązkiem przerywa passę
      }
    }
    cursor = addUnits(cursor, 'day', -1);
  }
  return streak;
}

/**
 * Podsumowanie na potrzeby dashboardu: dziś/tydzień/passa liczone dla CAŁEGO domu
 * (wspólny postęp dnia), punkty i poziom liczone TYLKO dla `forMemberId` (Twoje —
 * patrz storage.getMyMemberId()), jeśli podano; bez tego (nikt jeszcze nie wybrał
 * "kim jesteś") punkty są wspólne dla domu, tak jak wcześniej.
 */
export function computeDashboardStats(chores, overrides, getOverrideFn, forMemberId = null) {
  const today = startOfDay(new Date());
  const weekStart = addUnits(today, 'day', -((today.getDay() + 6) % 7)); // poniedziałek
  const todayOccs = generateAllOccurrences(chores, today, today);
  const weekOccsSoFar = generateAllOccurrences(chores, weekStart, today);

  const countDone = (occs) => occs.filter((o) => getOverrideFn(o.choreId, dateKey(o.date))?.status === 'done').length;

  const points = computeTotalPoints(chores, overrides, forMemberId);

  return {
    todayTotal: todayOccs.length,
    todayDone: countDone(todayOccs),
    weekTotal: weekOccsSoFar.length,
    weekDone: countDone(weekOccsSoFar),
    streak: computeStreak(chores, getOverrideFn),
    points,
    level: computeLevel(points),
  };
}
