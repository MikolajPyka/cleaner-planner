// google-auth.js — logowanie przez Google Identity Services (GIS, biblioteka Google
// ładowana z CDN w index.html), w pełni po stronie klienta — appka nie ma i nie będzie
// mieć własnego backendu (patrz architektura projektu, Faza 2).
//
// Zakres na TERAZ: tylko TOŻSAMOŚĆ (imię, e-mail, zdjęcie) do ekranu Logowania/Konta —
// to wystarcza, żeby "Kontynuuj z Google" było prawdziwym logowaniem, a nie placeholderem.
// Realna dwukierunkowa synchronizacja obowiązków z Kalendarzem Google to oddzielny,
// kolejny krok: wymaga dodatkowego zakresu (scope) 'https://www.googleapis.com/auth/calendar'
// i innej obsługi tokenu (GIS w trybie czysto klienckim NIE daje refresh tokenu — token
// wygasa po ok. godzinie i appka musi go po cichu odnowić albo poprosić o ponowną zgodę;
// przy samej tożsamości logowania to nieistotne, bo token jest zużywany raz, od razu po
// otrzymaniu, tylko do pobrania profilu).
//
// WYMAGANE PRZED UŻYCIEM NA PRAWDZIWYM URZĄDZENIU: wklej swój Client ID poniżej.
// Jak go zdobyć: Google Cloud Console → APIs & Services → Credentials → Create Credentials
// → OAuth client ID → typ aplikacji "Web application" → w "Authorized JavaScript origins"
// wpisz DOKŁADNIE origin, pod którym appka jest hostowana (np. https://twojlogin.github.io
// dla GitHub Pages — bez ścieżki, bez końcowego "/"; "http://localhost:5500" działa TYLKO
// gdy testujesz na tym samym komputerze, na którym stoi serwer — telefon go nie zobaczy).
// Bez wklejonego Client ID przycisk "Kontynuuj z Google" pokazuje uczciwy komunikat
// zamiast udawać logowanie.

export const GOOGLE_CLIENT_ID = ''; // <- wklej tutaj, np. '123456789-abc123.apps.googleusercontent.com'

// Na razie tylko tożsamość — bez zakresu kalendarza (patrz komentarz wyżej).
const IDENTITY_SCOPES = 'openid email profile';

let tokenClient = null;

function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  if (!window.google?.accounts?.oauth2) return null; // biblioteka GIS jeszcze się nie załadowała (brak internetu / CDN zablokowane)
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: IDENTITY_SCOPES,
    callback: () => {}, // nadpisywane per-wywołanie w signInWithGoogle(), poniżej
  });
  return tokenClient;
}

export function isGoogleSignInConfigured() {
  return !!GOOGLE_CLIENT_ID;
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
