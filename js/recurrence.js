// recurrence.js
// Silnik powtarzalności obowiązków. Czysta logika dat — bez zależności od DOM/storage,
// żeby dało się ją przenieść 1:1 do integracji z Google Calendar w Fazie 2.

/** Zwraca datę jako 'YYYY-MM-DD' (lokalny czas, bez przesunięć strefowych). */
export function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parsuje 'YYYY-MM-DD' na Date o północy lokalnego czasu. */
export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Dodaje N jednostek (day/week/month) do daty, zwraca nowy obiekt Date. */
export function addUnits(date, unit, amount) {
  const result = new Date(date);
  if (unit === 'day') result.setDate(result.getDate() + amount);
  else if (unit === 'week') result.setDate(result.getDate() + amount * 7);
  else if (unit === 'month') result.setMonth(result.getMonth() + amount);
  else throw new Error(`Nieznana jednostka: ${unit}`);
  return result;
}

function isSameOrAfter(a, b) {
  return a.getTime() >= b.getTime();
}
function isSameOrBefore(a, b) {
  return a.getTime() <= b.getTime();
}

/**
 * Następny termin dla obowiązku w trybie 'rolling' — liczony od ostatniego wykonania
 * (albo od daty zakotwiczenia, jeśli jeszcze nigdy nie wykonano).
 */
export function getRollingDueDate(chore) {
  const { schedule, lastCompletedAt } = chore;
  const base = lastCompletedAt ? parseDateKey(lastCompletedAt) : parseDateKey(schedule.anchorDate);
  if (!lastCompletedAt) return base;
  return addUnits(base, schedule.unit, schedule.interval);
}

/**
 * Generuje listę dat (Date, początek dnia) dla obowiązku w trybie 'fixed' wewnątrz
 * przedziału [rangeStart, rangeEnd] (włącznie).
 */
function generateFixedDates(chore, rangeStart, rangeEnd) {
  const { schedule } = chore;
  const anchor = parseDateKey(schedule.anchorDate);
  const dates = [];

  if (schedule.unit === 'week' && schedule.weekdays && schedule.weekdays.length > 0) {
    // Iterujemy tydzień po tygodniu od zakotwiczenia, co `interval` tygodni,
    // i w każdym pasującym tygodniu dodajemy wskazane dni tygodnia.
    const weekStart = new Date(anchor);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // niedziela jako start tygodnia
    let cursor = new Date(weekStart);
    let guard = 0;
    while (cursor.getTime() <= rangeEnd.getTime() && guard < 5000) {
      guard++;
      for (const wd of schedule.weekdays) {
        const day = new Date(cursor);
        day.setDate(day.getDate() + wd);
        if (isSameOrAfter(day, rangeStart) && isSameOrBefore(day, rangeEnd) && isSameOrAfter(day, anchor)) {
          dates.push(day);
        }
      }
      cursor = addUnits(cursor, 'week', schedule.interval);
    }
    return dates.sort((a, b) => a - b);
  }

  // Prosty krok co N jednostek od zakotwiczenia (anchorDate + k * interval).
  // Najpierw idziemy od anchor aż trafimy w okolice rangeStart (żeby nie liczyć
  // tysięcy kroków dla dawno ustawionych codziennych zadań), potem zbieramy
  // wszystkie terminy z siatki aż do rangeEnd.
  let cursor = new Date(anchor);
  let guard = 0;
  while (cursor.getTime() < rangeStart.getTime() && guard < 100000) {
    cursor = addUnits(cursor, schedule.unit, schedule.interval);
    guard++;
  }

  guard = 0;
  while (cursor.getTime() <= rangeEnd.getTime() && guard < 5000) {
    dates.push(new Date(cursor));
    cursor = addUnits(cursor, schedule.unit, schedule.interval);
    guard++;
  }
  return dates;
}

/**
 * Generuje wystąpienia obowiązku widoczne w danym zakresie dat.
 * Dla trybu 'rolling' zwraca co najwyżej jedno wystąpienie — najbliższy termin —
 * nawet jeśli jest zaległy (data < rangeStart), żeby nie zniknął z widoku.
 *
 * @returns {Array<{choreId, date: Date, overdue: boolean}>}
 */
export function generateOccurrencesInRange(chore, rangeStart, rangeEnd) {
  if (!chore.active) return [];

  if (chore.schedule.mode === 'once') {
    // Zdarzenie jednorazowe — jeden stały termin, bez powtórzeń i bez logiki "od wykonania".
    const due = parseDateKey(chore.schedule.anchorDate);
    if (due.getTime() > rangeEnd.getTime()) return [];
    const overdue = due.getTime() < rangeStart.getTime();
    return [{ choreId: chore.id, date: due, overdue }];
  }

  if (chore.schedule.mode === 'rolling') {
    const due = getRollingDueDate(chore);
    if (due.getTime() > rangeEnd.getTime()) return [];
    const overdue = due.getTime() < rangeStart.getTime();
    return [{ choreId: chore.id, date: due, overdue }];
  }

  return generateFixedDates(chore, rangeStart, rangeEnd).map((date) => ({
    choreId: chore.id,
    date,
    overdue: false,
  }));
}

/** Generuje wystąpienia dla wielu obowiązków naraz, posortowane chronologicznie. */
export function generateAllOccurrences(chores, rangeStart, rangeEnd) {
  const all = [];
  for (const chore of chores) {
    all.push(...generateOccurrencesInRange(chore, rangeStart, rangeEnd));
  }
  return all.sort((a, b) => a.date - b.date);
}

/** Zwraca początek i koniec miesiąca zawierającego `date`. */
export function monthRange(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

/** Zwraca zakres siatki kalendarza miesięcznego (pełne tygodnie, pon–niedz). */
export function monthGridRange(date) {
  const { start, end } = monthRange(date);
  const gridStart = new Date(start);
  const startDow = (gridStart.getDay() + 6) % 7; // 0 = poniedziałek
  gridStart.setDate(gridStart.getDate() - startDow);
  const gridEnd = new Date(end);
  const endDow = (gridEnd.getDay() + 6) % 7;
  gridEnd.setDate(gridEnd.getDate() + (6 - endDow));
  gridEnd.setHours(23, 59, 59);
  return { start: gridStart, end: gridEnd };
}
