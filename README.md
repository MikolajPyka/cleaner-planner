# Cleaner Planner — prototyp (Faza 1)

Aplikacja webowa do zarządzania domowymi obowiązkami sprzątania. Vanilla JS (bez
frameworka JS, bez build stepu). Warstwa wizualna to zatwierdzony kierunek
„Pastelowy spokój" (8 ekranów) przeniesiony 1:1 z podglądu statycznego: logowanie,
dashboard, kalendarz, obowiązki, formularz obowiązku, kategorie (kolor + ikona) i
konto. Dane trzymane lokalnie w przeglądarce (localStorage) — działa od razu, bez
żadnej konfiguracji, dane ze starszej wersji migrują się automatycznie przy
pierwszym uruchomieniu.

## Uruchomienie lokalnie

Przeglądarki nie pozwalają ładować modułów JS (`type="module"`) bezpośrednio z pliku
(`file://`), więc potrzebny jest minimalny lokalny serwer statyczny:

```bash
python3 -m http.server 5500
# albo
npx serve . -l 5500
```

Otwórz `http://localhost:5500`. **Wymaga połączenia z internetem** — Ionic (tylko
`ion-app`/`ion-content`, patrz niżej) i font Plus Jakarta Sans są ładowane z CDN
(jsDelivr / Google Fonts). Sekcja „Praca offline” niżej pokazuje, jak to zmienić na
wersję w pełni lokalną.

Na telefonie w tej samej sieci Wi-Fi: adres IP komputera zamiast `localhost`, żeby
przetestować responsywność na realnym urządzeniu.

## Co już działa

- **Logowanie** — ekran startowy z „Kontynuuj z Google” (prawdziwe logowanie Google po
  wklejeniu własnego Client ID — patrz „Publikacja pod testy na telefonie” niżej; bez
  niego pokazuje uczciwą notatkę zamiast udawać logowanie) i „Kontynuuj lokalnie” (tryb
  bez logowania, dokładnie taki jak dotychczas).
- **Start (dashboard)** — powitanie, karty statystyk (dziś wykonane, passa dni,
  punkty, % tygodnia), pasek szybkich akcji (+ Obowiązek, + Jednorazowe), lista
  zaległych/dzisiejszych/najbliższych zadań z kolorowymi znacznikami kategorii.
- **Grywalizacja** — punkty za wykonane zadania (proporcjonalnie do szacowanego
  czasu), passa kolejnych „czystych” dni, poziomy z żartobliwymi tytułami
  (Nowicjusz sprzątania → Legenda porządku). Logika w `js/gamification.js`,
  liczona na bieżąco z istniejących danych — nic dodatkowego nie jest zapisywane.
- **Kalendarz** — widok miesięczny z kropkami, kliknięcie dnia pokazuje listę poniżej.
- **Szczegóły obowiązku** — odznaka kategorii, notatka/lista punktów, wykonawca
  (zmienialny per wystąpienie), termin, szacowany czas, przełącznik
  wykonane/niewykonane.
- **Kategorie** — własny system kolor + ikona (6 wbudowanych: Kuchnia, Odkurzanie,
  Łazienka, Mycie, Pranie, Inne, plus możliwość dodawania własnych) używany jako
  filtr na liście obowiązków i odznaka wszędzie, gdzie pojawia się zadanie.
- **Harmonogram w trzech trybach**:
  - *Stały rytm* — sztywna siatka kalendarzowa (dobre dla codziennych/częstych),
  - *Od wykonania* — kolejny termin liczony od ostatniego zaznaczenia „wykonane”
    (dobre dla rzadkich, np. mycie okien co 3 miesiące),
  - *Jednorazowe* — pojedyncze zdarzenie na wskazany dzień, bez powtórzeń
    (skrót „+ Jednorazowe” na dashboardzie ustawia ten tryb od razu).
- **Konto** — jeden ekran zbierający: kartę profilu, status połączenia z kalendarzem
  Google (Faza 2), listę domowników z kolorem/inicjałami (dodawanie/usuwanie/zmiana
  koloru), przełącznik wyglądu (system/jasny/ciemny), skrót do kategorii i wylogowanie.
- Dane demonstracyjne ładują się same przy pierwszym uruchomieniu — edytuj je albo
  wyczyść przyciskiem „Zresetuj dane demonstracyjne” w zakładce Obowiązki.

## Struktura projektu

```
index.html            — szkielet aplikacji (ion-app/ion-content + kontener na tab-bar)
css/styles.css         — pełny system tokenów „Pastelowy spokój” (kolor/typografia/
                         spacing/promienie), warianty light/dark, style wszystkich
                         własnych komponentów (tab-bar, karty, modal, kalendarz,
                         kategorie, ekran logowania/konta)
js/icons.js            — biblioteka ikon SVG (zestaw dla kategorii + logo Google)
js/google-auth.js      — logowanie Google Identity Services (patrz "Publikacja pod
                         testy na telefonie" niżej — tu wklejasz swój Client ID)
js/recurrence.js       — silnik powtarzalności (czysta logika dat, bez zależności)
js/storage.js          — warstwa danych: obowiązki, kategorie, domownicy, sesja
                         (dziś: localStorage z migracją ze starszego formatu —
                         patrz Faza 2 niżej)
js/gamification.js     — punkty, passa, poziomy
js/app.js              — render wszystkich widoków + obsługa zdarzeń
```

## Ionic — ograniczone celowo do minimum

Po wdrożeniu zatwierdzonego kierunku wizualnego zostały tylko dwa realne komponenty
Ionic: `<ion-app>` i `<ion-content>` (przewijalny kontener strony). Pasek nawigacji na
dole, przyciski, segmentowany przełącznik trybu harmonogramu, selecty i modal to teraz
własny, prosty HTML/CSS — dawało to pełną, pikselową zgodność z zatwierdzonym
podglądem statycznym (kolory, zaokrąglenia, odstępy dokładnie jak w mockupach), czego
przemalowywanie gotowych komponentów Ionic nie zapewniało w 100%. `ion-app`/
`ion-content` zostały, bo dobrze radzą sobie z przewijaniem i pozycjonowaniem na
mobile i nadal mają sens jako baza pod przyszłe przejście na Capacitor (Faza 3).

## Praca offline / przygotowanie pod Capacitor (opcjonalne już teraz)

CDN wymaga internetu przy każdym uruchomieniu. Żeby uniezależnić appkę od sieci
(przyda się też jako krok przygotowawczy pod Fazę 3 — Capacitor zawsze pakuje
zasoby lokalnie):

```bash
npm install @ionic/core@7.8.6 ionicons@7.4.0
mkdir -p vendor/ionic vendor/ionicons
cp -r node_modules/@ionic/core/dist/ionic vendor/ionic/
cp node_modules/@ionic/core/css/ionic.bundle.css vendor/ionic/
cp -r node_modules/ionicons/dist/ionicons vendor/ionicons/
```

Następnie w `index.html` podmień linki CDN na lokalne (`vendor/ionic/ionic.bundle.css`,
`vendor/ionic/ionic/ionic.esm.js`, `vendor/ionicons/ionicons/ionicons.esm.js`) oraz
zamień link do Google Fonts na lokalny plik (np. przez `npm install @fontsource/plus-jakarta-sans`
i skopiowanie potrzebnych plików `.woff2`). To dokładnie ta konfiguracja, na której
testowałem tę wersję aplikacji przed dostarczeniem.

## Stan logowania z Google (uczciwa uwaga)

Logowanie Google jest **prawdziwe** (Google Identity Services, `js/google-auth.js`) —
ale zanim wkleisz swój Client ID (patrz „Konfiguracja realnego logowania” niżej), kod
sam wykrywa brak konfiguracji i pokazuje uczciwą notatkę zamiast próbować się łączyć,
więc appka zawsze albo naprawdę loguje, albo wprost mówi, że jeszcze nie może. Po
zalogowaniu appka zna Twoje imię, e-mail i zdjęcie profilowe z Google — **ale to na
razie tylko tożsamość**, nie synchronizacja obowiązków. Realne odczytywanie/zapisywanie
zadań w Kalendarzu Google to kolejny, osobny krok (patrz „Faza 2, krok 2” niżej) —
status w Koncie mówi o tym wprost („Zalogowano przez Google — synchronizacja z
Kalendarzem to kolejny krok”), żeby nie sugerować czegoś, czego appka jeszcze nie robi.
„Kontynuuj lokalnie” działa tak jak dotychczas, niezależnie od tego wszystkiego.

## Publikacja pod testy na telefonie + konfiguracja logowania Google

**Dlaczego `localhost:5500` nie wystarczy**: telefon nie ma dostępu do „localhost”
Twojego komputera (to słowo zawsze znaczy „ja sam”, więc na telefonie odsyła do samego
telefonu). Do tego Google Identity Services wymaga **HTTPS** dla każdego adresu innego
niż dosłownie `http://localhost` — a adres w tej samej sieci Wi-Fi po IP
(`http://192.168.x.x:5500`) to ani jedno, ani drugie. Potrzebny jest więc prawdziwy
hosting ze stałym adresem HTTPS. Najprostsza bezpłatna opcja to **GitHub Pages**:

1. Załóż (jeśli jeszcze nie masz) repozytorium na GitHubie i wrzuć do niego zawartość
   tego folderu (`index.html`, `css/`, `js/`) — np.:
   ```bash
   git init
   git add index.html css js README.md
   git commit -m "Cleaner Planner"
   git branch -M main
   git remote add origin https://github.com/<twoj-login>/cleaner-planner.git
   git push -u origin main
   ```
2. W ustawieniach repo na GitHubie: **Settings → Pages → Build and deployment → Source:
   Deploy from a branch → Branch: `main` / `(root)` → Save**. Po chwili appka będzie
   dostępna pod `https://<twoj-login>.github.io/cleaner-planner/` — ten adres otwiera
   się już z telefonu (i z komputera), bez lokalnego serwera.
3. Załóż projekt w [Google Cloud Console](https://console.cloud.google.com/) i
   skonfiguruj **ekran zgody OAuth** (typ „Zewnętrzny”, tryb testowy — do 100 kont
   testowych, w sam raz na Wasze dwa konta; dodaj oba wasze konta Google jako
   „Test users”, inaczej Google odrzuci logowanie).
4. Utwórz **OAuth Client ID** typu „Aplikacja internetowa” (Credentials → Create
   Credentials → OAuth client ID → Web application) i w **Authorized JavaScript
   origins** wpisz **origin, czyli SAM adres bez ścieżki i bez końcowego `/`** —
   dla GitHub Pages to `https://<twoj-login>.github.io` (nie
   `https://<twoj-login>.github.io/cleaner-planner/` — ścieżka po origin się nie liczy,
   Google porównuje tylko schemat+host+port). `http://localhost:5500` możesz dodać
   dodatkowo, obok, jeśli chcesz też dalej testować logowanie lokalnie na komputerze —
   Google pozwala mieć kilka origin na jednym Client ID.
5. Skopiuj wygenerowany **Client ID** (kończy się na `.apps.googleusercontent.com`) i
   wklej go do stałej `GOOGLE_CLIENT_ID` na górze pliku `js/google-auth.js`, np.:
   ```js
   export const GOOGLE_CLIENT_ID = '123456789-abc123.apps.googleusercontent.com';
   ```
   Wypchnij tę zmianę (`git add`, `commit`, `push`) — GitHub Pages przebuduje się
   automatycznie po push. Od teraz „Kontynuuj z Google” na `https://<twoj-login>.github.io/cleaner-planner/`
   powinno pokazać prawdziwe okno logowania Google.

Client ID **nie jest sekretem** (to publiczny identyfikator, bezpiecznie trzymać go w
kodzie frontendowym) — więc nie ma problemu z tym, że ląduje w publicznym repo/appce.

## Faza 2 — współdzielony kalendarz przez Google Calendar (krok 2, jeszcze niezrobiony)

Ustalony kierunek: obie osoby logują się swoim kontem Google (już działa — patrz wyżej),
a zadania stają się wydarzeniami we **wspólnym kalendarzu Google** (dodatkowe dane —
wykonawca, status, checklistę — trzymamy w `extendedProperties` wydarzenia). Zero
własnego backendu — appka wywołuje Google Calendar API wprost z przeglądarki.

Co jeszcze zostało do zrobienia (celowo osobny krok od samego logowania):

1. Rozszerzyć zakres (`scope`) żądania OAuth w `js/google-auth.js` o
   `https://www.googleapis.com/auth/calendar` (na razie prosimy tylko o tożsamość:
   `openid email profile`) — i obsłużyć, że token dostępu z czysto klienckiego GIS
   **wygasa po ok. godzinie i nie ma refresh tokenu** (to wymagałoby backendu) — appka
   będzie musiała po cichu odnawiać token w tle albo poprosić o ponowną zgodę.
2. Założyć jeden wspólny kalendarz Google (np. „Sprzątanie — dom”) i udostępnić go
   drugiej osobie z uprawnieniem „Wprowadzanie zmian w wydarzeniach”.
3. Podmienić `js/storage.js` na adapter wywołujący Google Calendar API — reszta
   aplikacji (`recurrence.js`, `gamification.js`, `app.js`) zostaje bez zmian, bo cała
   logika dostępu do danych jest już za jednym adapterem.

Otwarta kwestia na później: origin dla WebView w Capacitor (zwykle `https://localhost`
albo custom scheme) trzeba będzie dodać osobno do listy autoryzowanych źródeł OAuth.

## Znane uproszczenia w tym MVP (do świadomej decyzji, nie zapomniane)

- Brak rotacji wykonawców (round-robin) — obowiązek ma jednego domyślnego wykonawcę,
  zmienianego ręcznie per wystąpienie.
- Brak powiadomień (push/natywne) — sensowne dopiero po przejściu na Capacitor.
- Tygodniowy harmonogram „w wybrane dni tygodnia” jest przygotowany w silniku
  (`recurrence.js`), ale nie ma jeszcze pola w formularzu — na razie częstotliwość
  ustawia się jako „co N dni/tygodni/miesięcy” od dowolnej daty startowej.
- Grywalizacja jest celowo prosta (punkty + passa + poziom) — bez odznak/osiągnięć,
  żeby nie rozrastać MVP. Łatwo dobudować w `js/gamification.js`, jeśli się sprawdzi.
- „Kontynuuj z Google” loguje naprawdę (po wklejeniu Client ID), ale to na razie tylko
  tożsamość — realna synchronizacja obowiązków ze wspólnym Kalendarzem Google to
  jeszcze niezrobiony krok 2 Fazy 2 (patrz sekcja wyżej).

## Migracja danych

Jeśli testowałeś wcześniejszą wersję aplikacji w tej samej przeglądarce, dane w
localStorage migrują się automatycznie przy pierwszym uruchomieniu tej wersji —
istniejące obowiązki i domownicy zostają zachowane, dochodzą tylko domyślne
kategorie i przypisania kategorii/trybu częstotliwości do istniejących zadań.
Nic nie trzeba robić ręcznie.
