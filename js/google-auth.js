// google-auth.js — logowanie przez Google Identity Services (GIS, biblioteka Google
// ładowana z CDN w index.html), w pełni po stronie klienta — appka nie ma i nie będzie
// mieć własnego backendu (patrz architektura projektu, Faza 2).
//
// STAN: logowanie tożsamościowe (imię, e-mail, zdjęcie) ORAZ zakres Google Calendar
// (Faza 2, krok 2 — synchronizacja obowiązków z kalendarzem, patrz calendar-sync.js).
// GIS w trybie czysto klienckim NIE daje refresh tokenu — token dostępu żyje ~1h.
// Ten moduł trzyma go w pamięci (nie w localStorage — to sekret sesji, ginie przy
// odświeżeniu strony, wtedy po prostu odnawiamy go po cichu przy pierwszym użyciu)
// i odnawia go w tle przez requestAccessToken({prompt: ''}) — działa bez pokazywania
// okna logowania, DOPÓKI zgoda użytkownika jest ważna. WAŻNE ograniczenie: dopóki
// projekt w Google Cloud Console jest w trybie "Testing" (a nie "In production"),
// Google unieważnia zgodę na zakresy inne niż podstawowe (a Calendar to taki zakres)
// po 7 dniach — appka wtedy poprosi o ponowne zalogowanie, to nie jest błąd appki.
//
// WYMAGANE PRZED UŻYCIEM NA PRAWDZIWYM URZĄDZENIU: wklej swój Client ID poniżej.
// Jak go zdobyć: Google Cloud Console → APIs & Services → Credentials → Create Credentials
// → OAuth client ID → typ aplikacji "Web application" → w "Authorized JavaScript origins"
// wpisz DOKŁADNIE origin, pod którym appka jest hostowana (np. https://twojlogin.github.io
// dla GitHub Pages — bez ścieżki, bez końcowego "/"; "http://localhost:5500" działa TYLKO
// gdy testujesz na tym samym komputerze, na którym stoi serwer — telefon go nie zobaczy).
// Bez wklejonego Client ID przycisk "Kontynuuj z Google" pokazuje uczciwy komunikat
// zamiast udawać logowanie.

export const GOOGLE_CLIENT_ID = '755537342812-qs0t7dfe8anad9qoibgj0j25mbldhfes.apps.googleusercontent.com';

// Tożsamość + zakres Google Calendar (tylko zdarzenia — appka nie zarządza samymi
// kalendarzami, tylko wpisami w kalendarzu, który użytkownik sam utworzył i którego
// ID poda w Koncie, patrz calendar-sync.js). Rozszerzenie zakresu oznacza, że każde
// kolejne logowanie (nawet u kogoś, kto logował się wcześniej tylko po tożsamość)
// poprosi o dodatkową zgodę na dostęp do kalendarza — to oczekiwane, jednorazowe.
const APP_SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar.events';

let tokenClient = null;

// Token dostępu trzymany w pamięci (nie w localStorage) + moment jego wygaśnięcia,
// żeby calendar-sync.js mogło poprosić o ważny token bez wiedzy o mechanice GIS.
let cachedToken = null;
let cachedTokenExpiresAt = 0; // epoch ms

function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  if (!window.google?.accounts?.oauth2) return null; // biblioteka GIS jeszcze się nie załadowała (brak internetu / CDN zablokowane)
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: APP_SCOPES,
    callback: () => {}, // nadpisywane per-wywołanie poniżej
  });
  return tokenClient;
}

export function isGoogleSignInConfigured() {
  return !!GOOGLE_CLIENT_ID;
}

function storeToken(response) {
  cachedToken = response.access_token;
  // Margines 2 minut, żeby nie korzystać z tokenu tuż przed jego wygaśnięciem.
  cachedTokenExpiresAt = Date.now() + (Number(response.expires_in || 3600) - 120) * 1000;
}

/**
 * Otwiera okno zgody Google (popup), a po zaakceptowaniu pobiera podstawowy profil.
 * Zwraca Promise<{ name, email, picture }> albo odrzuca z Error, którego `.message`
 * to jeden z krótkich kodów: 'missing-client-id' | 'gis-not-loaded' | 'popup_closed' |
 * 'access_denied' | 'userinfo-failed' | inny kod błędu zwrócony przez Google.
 */
export function signInWithGoogle() {
  return new Promise((resolve, reject) => {
    if (!isGoogleSignInConfigured()) {
      reject(new Error('missing-client-id'));
      return;
    }
    const client = ensureTokenClient();
    if (!client) {
      reject(new Error('gis-not-loaded'));
      return;
    }
    client.callback = async (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      storeToken(response);
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${response.access_token}` },
        });
        if (!res.ok) throw new Error('userinfo-failed');
        const profile = await res.json();
        resolve({ name: profile.name, email: profile.email, picture: profile.picture });
      } catch (err) {
        reject(err);
      }
    };
    client.requestAccessToken({ prompt: 'consent' });
  });
}

/**
 * Zwraca ważny token dostępu do wywołań Google Calendar API — z pamięci, jeśli
 * jeszcze ważny, albo cicho odnowiony (bez okna logowania) przez GIS. Używane przez
 * calendar-sync.js. Odrzuca z Error('reauth-required'), jeśli cicha odnowa się nie
 * uda (np. minęło 7 dni w trybie "Testing" projektu Google Cloud, patrz komentarz
 * na górze pliku) — appka powinna wtedy poprosić o ponowne kliknięcie "Kontynuuj
 * z Google".
 */
export function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return Promise.resolve(cachedToken);
  }
  return new Promise((resolve, reject) => {
    const client = ensureTokenClient();
    if (!client) {
      reject(new Error('gis-not-loaded'));
      return;
    }
    // Zabezpieczenie przed zawieszeniem: cicha odnowa (prompt: '') w praktyce
    // czasem nie wywołuje callbacku wcale (np. zablokowany ukryty iframe GIS na
    // mobilnej przeglądarce, długie uśpienie karty w tle) — bez tego timeoutu
    // cała synchronizacja wisiałaby w stanie "syncing" bez końca, bo nic nigdy
    // by nie odrzuciło ani nie rozwiązało tej obietnicy.
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('token-timeout'));
    }, 8000);
    client.callback = (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (response.error) {
        reject(new Error('reauth-required'));
        return;
      }
      storeToken(response);
      resolve(response.access_token);
    };
    // prompt: '' — bez okna logowania, jeśli zgoda użytkownika jest wciąż ważna.
    client.requestAccessToken({ prompt: '' });
  });
}
