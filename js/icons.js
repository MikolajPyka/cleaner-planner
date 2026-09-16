// icons.js — biblioteka inline SVG (styl: stroke 1.8-2px, zaokrąglone końce),
// zgodna z kierunkiem wizualnym ustalonym w statycznym podglądzie (Claude Design canvas).
//
// Świadome uproszczenie: to ręcznie rysowane przybliżenia stylu Lucide, nie sama
// biblioteka Lucide (patrz "Wizualny kierunek UI" w architekturze projektu — docelowo
// do zastąpienia prawdziwym Lucide, kiedy dojdzie do tego etapu). Trzymanie ich tutaj,
// w jednym miejscu, ułatwia tę przyszłą podmianę.

const ICONS = {
  // ---------- Kategorie obowiązków (6 domyślnych) ----------
  droplet: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  broom: '<path d="M19 4 9.5 13.5"/><path d="M9.5 13.5c-1.2-1.2-3.4-.8-4.7.5-1.3 1.3-2.3 3.3-2.3 3.3s2 1 3.3 1.7c1.3.7 3.3-.3 4.5-1.5 1.2-1.2 1.6-2.8.5-4z"/>',
  'trash-2': '<path d="M4 7h16"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  trash: '<path d="M4 7h16"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>',
  sparkle: '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  utensils: '<path d="M7 3v6a2 2 0 0 0 4 0V3"/><path d="M9 9v12"/><path d="M17 3c-1 0-2 1-2 3v4c0 1 .5 2 2 2s2-1 2-2V6c0-2-1-3-2-3z"/><path d="M17 12v9"/>',
  tag: '<path d="M20.6 12.6 12 4H4v8l8.6 8.6a2 2 0 0 0 2.8 0l5.2-5.2a2 2 0 0 0 0-2.8z"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/>',

  // ---------- Dodatkowe ikony do wyboru przy tworzeniu własnej kategorii ----------
  breeze: '<path d="M4 15c2-1 4-1 6 0s4 1 6 0 4-1 4-1M4 10c2-1 4-1 6 0s4 1 6 0 4-1 4-1"/><path d="M7 6a2 2 0 1 1 3 1.7M14 5a2 2 0 1 1 3 1.7"/>',
  box: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  shield: '<path d="M12 22s7-4.4 7-11V6l-7-3-7 3v5c0 6.6 7 11 7 11z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  face: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9h.01M15 9h.01M9 15c1 1 2 1.5 3 1.5s2-.5 3-1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',

  // ---------- Grywalizacja / dashboard ----------
  medal: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14.5 7 22l5-3 5 3-1.5-7.5"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  starburst: '<path d="M12 3l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6-4.4-4.2 6-.7z"/>',
  'trending-up': '<path d="M3 17l6-6 4 4 8-9"/><path d="M15 6h6v6"/>',
  flash: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  leaf: '<path d="M6 21c8 0 13-5 13-13V5h-3C8 5 3 10 3 18v3z"/><path d="M6 21c0-5 3-9 7-11"/>',
  'shield-check': '<path d="M12 22s7-4.4 7-11V6l-7-3-7 3v5c0 6.6 7 11 7 11z"/><path d="M9 12l2 2 4-4"/>',
  trophy: '<path d="M8 4h8v4a4 4 0 0 1-8 0V4z"/><path d="M8 4H4v2a4 4 0 0 0 4 4"/><path d="M16 4h4v2a4 4 0 0 1-4 4"/><path d="M12 12v4"/><path d="M8 20h8"/><path d="M9 16h6l1 4H8z"/>',

  // ---------- Nawigacja / chrome ----------
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1.3" fill="currentColor" stroke="none"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  'chevron-left': '<path d="M15 18l-6-6 6-6"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  pencil: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
};

/** Zwraca gotowe markup <svg> dla nazwy z biblioteki ICONS (pusty string, jeśli brak). */
export function svgIcon(name, opts = {}) {
  const { size = 20, color = 'currentColor', strokeWidth = 1.8, style = '', className = '' } = opts;
  const inner = ICONS[name];
  if (!inner) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${className}" style="${style}">${inner}</svg>`;
}

/** Nazwy dostępne w kreatorze nowej kategorii (nie wszystkie ikony z ICONS mają tu sens). */
export const CATEGORY_ICON_CHOICES = [
  'droplet', 'broom', 'trash', 'sparkle', 'utensils', 'breeze',
  'box', 'tag', 'shield', 'clock', 'face', 'plus',
];

/** Znaczek marki Google (kolory własne, nie stroke) — dla przycisku logowania. */
export function googleLogoSvg(size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.6 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.4-.9-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.5 6.5 29.6 4.5 24 4.5c-7.4 0-13.8 4.1-17.1 10.2z"/>
    <path fill="#4CAF50" d="M24 44.5c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.4c-2.1 1.5-4.8 2.5-7.7 2.5-5.3 0-9.7-3.1-11.3-7.6l-6.6 5.1C9.9 40.3 16.4 44.5 24 44.5z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.6 5.4c-.5.4 6.8-5 6.8-15.1 0-1.2-.1-2.4-.9-3.5z"/>
  </svg>`;
}
