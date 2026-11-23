# Update-Monitor für werthonig.de

Nach jedem WordPress-Update (manuell, automatisch, per FTP oder bei einem PHP-Wechsel) startet automatisch ein Testlauf gegen den Live-Shop. Danach kommt eine Protokoll-Mail: was sich geändert hat, welche Prüfungen bestanden sind, was fehlschlägt, mit Abweichungsbildern im Anhang.

Zusätzlich gibt es einen täglichen Kontrolllauf und montags einen Volltest.

## Inhalt

| Ordner/Datei | Zweck |
| --- | --- |
| `wp-plugin/update-monitor.php` | MU-Plugin für den Server: erkennt Updates, bündelt sie 15 Min., stößt GitHub an, Prüf-Schnittstellen, Testbestellungen, Protokoll unter *Werkzeuge → Update-Monitor* |
| `tests/` | Playwright-Prüfungen (siehe unten) |
| `lib/config.ts` | Seitenliste, Produkt-ID, Grenzwerte, ausgeblendete Bereiche |
| `scripts/report.mjs` | Protokoll-Mail |
| `.github/workflows/monitor.yml` | Ablauf auf GitHub |

### Was geprüft wird

1. **Status:** Plugin erreichbar, Fehleranzeige (`display_errors`, `WP_DEBUG_DISPLAY`) aus.
2. **Seiten:** Start, Shop, einfaches und variables Produkt, Konto, Newsletter, Kontakt – HTTP-Status, keine PHP-Meldungen, keine JavaScript-Fehler.
3. **German Market und Kasse:** Grundpreis, MwSt., Lieferzeit, Versand, „Vertrag widerrufen“; Produkt in den Warenkorb, Kasse lädt, PayPal vorhanden, kein Bild in der Zahlungsauswahl höher als 60 px, AGB/Widerruf/Checkboxen, Bestellbutton. Es wird **nicht** bestellt.
4. **Links:** alle internen Links der Startseite inkl. Fußzeile, auch doppelte Domains im Link.
5. **Mailversand:** Testmail über `wp_mail()`, Empfang per IMAP im Testpostfach.
6. **Testbestellung** (nur wenn eingeschaltet): Login Testkonto, verstecktes Testprodukt, Vorkasse, Kunden- und Admin-Mail prüfen (PHP-Meldungen, Produktname, Produktbild lädt), danach stornieren.
7. **Darstellung:** Screenshot-Vergleich Desktop und Mobil gegen freigegebene Referenzbilder.
8. **PHP-Log:** neue Fatal Errors/Warnungen seit dem letzten Lauf → Fehler; Notices/Deprecated → Hinweis.

---

## Einrichtung (einmalig, ca. 1,5–2 Std.)

### 1. Testpostfach

Postfach `test@werthonig.de` anlegen. Es empfängt die Testmails und verschickt die Protokoll-Mails. Notieren: IMAP-Server und Port (meist 993), SMTP-Server und Port (meist 465), Passwort.

### 2. GitHub-Repository

1. Kostenloses Konto auf github.com, neues **privates** Repository, z. B. `werthonig-monitor`.
2. Alle Dateien dieses Pakets hochladen (*Add file → Upload files*; den Ordner `.github` mit hochladen – ggf. per GitHub Desktop, da versteckte Ordner beim Hochladen im Browser leicht fehlen).
3. **Secrets** unter *Settings → Secrets and variables → Actions → Secrets*:

| Secret | Inhalt |
| --- | --- |
| `MONITOR_KEY` | Zufälliger Schlüssel, mind. 32 Zeichen, nur Buchstaben/Ziffern (z. B. per `openssl rand -hex 24` oder Passwortmanager). Derselbe Wert kommt in die wp-config.php. |
| `TEST_EMAIL_PASS` | Passwort des Testpostfachs |
| `TEST_ACCOUNT_PASS` | Passwort des Testkunden im Shop (erst für die Testbestellung nötig) |

4. **Variables** im Reiter daneben:

| Variable | Beispiel |
| --- | --- |
| `SITE_URL` | `https://werthonig.de` |
| `TEST_EMAIL` | `test@werthonig.de` |
| `IMAP_HOST` / `IMAP_PORT` | `imap.example.de` / `993` |
| `SMTP_HOST` / `SMTP_PORT` | `smtp.example.de` / `465` |
| `REPORT_TO` | Empfänger der Protokolle, mehrere mit Komma |
| `TEST_PRODUCT_URL` | Adresse des versteckten Testprodukts (für die Testbestellung) |
| `WITH_ORDER_WEEKLY` | `false`, später `true` = Montags-Volltest mit Testbestellung |
| `PAYMENT_LOGO_MAX_HEIGHT` | optional, Standard `60` |
| `EXPECT_MAIL_IMAGES` | optional, `false`, wenn Bestellmails keine Produktbilder haben sollen |

5. **Token für WordPress:** *Profilbild → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*
   - Repository access: *Only select repositories* → nur `werthonig-monitor`
   - Permissions → Repository → **Contents: Read and write**
   - Ablaufdatum notieren (max. 1 Jahr) und im Kalender vormerken – danach scheitert das Auslösen, das Plugin schickt dann eine Warnmail.

### 3. WordPress

1. In die `wp-config.php` **oberhalb** von `/* That's all, stop editing! */`:

```php
define( 'UPDATE_MONITOR_GITHUB_REPO',  'DEIN-KONTO/werthonig-monitor' );
define( 'UPDATE_MONITOR_GITHUB_TOKEN', 'github_pat_...' );
define( 'UPDATE_MONITOR_KEY',          'derselbe-wert-wie-MONITOR_KEY' );
define( 'UPDATE_MONITOR_TEST_EMAIL',   'test@werthonig.de' );
define( 'UPDATE_MONITOR_WITH_ORDER',   false );
define( 'DISABLE_WP_CRON', true );
```

2. **Echten Cron einrichten** (WP-Cron läuft sonst nur bei Seitenaufrufen):
   `*/5 * * * * curl -s https://werthonig.de/wp-cron.php?doing_wp_cron > /dev/null 2>&1`
3. `wp-plugin/update-monitor.php` nach `wp-content/mu-plugins/` hochladen (Ordner ggf. anlegen). MU-Plugins sind immer aktiv.
4. Im Backend *Werkzeuge → Update-Monitor* öffnen: alle Punkte unter „Einrichtung“ sollten ✅ zeigen. Beim ersten Aufruf wird der Versions-Snapshot angelegt.
5. Empfohlen: **FluentSMTP** (Mailversand per SMTP mit Log und Fehlerbenachrichtigung) und **Simple History**.
6. Falls ein Sicherheits-Plugin (Wordfence, iThemes …) läuft: Die REST-Schnittstelle `/wp-json/update-monitor/v1/` darf nicht gesperrt werden, und Zugriffe von GitHub dürfen nicht als Bot blockiert werden.

### 4. Erster Lauf

1. Auf GitHub *Actions → Monitor → Run workflow*, Haken bei **update_screenshots** → erstellt die Referenzbilder und legt sie im Repository ab. Bilder unter `tests/__screenshots__/` kurz ansehen.
2. Danach *Run workflow* ohne Haken → normaler Lauf, Protokoll-Mail kommt.
3. Im Backend auf *Testlauf jetzt auslösen* klicken → prüft den Weg WordPress → GitHub.

Rechne in den ersten Läufen mit Fehlalarmen (Cookie-Banner, wechselnde Inhalte, Selektoren). Melde sie, dann passe ich `lib/config.ts` bzw. die Tests an.

---

## Testbestellung einschalten

1. **Testkunde** im Shop anlegen: E-Mail = Testadresse, vollständige Rechnungsadresse im Konto hinterlegen.
2. **Testprodukt** anlegen: Name z. B. „Testprodukt Monitoring“, Preis 1,00 €, Steuersatz 7 %, *Virtuell* angehakt, Lagerbestand nicht verwalten, *Katalogsichtbarkeit: Verborgen*, Produktbild setzen (wird in der Mail geprüft). URL als `TEST_PRODUCT_URL` eintragen.
3. Zahlungsart **Vorkasse/Überweisung** muss aktiv sein.
4. **German Market → Rechnungen:** prüfen, ob/wann Rechnungsnummern vergeben werden. Testbestellungen werden storniert, nie gelöscht – der Nummernkreis bleibt lückenlos. Kunden/Steuerberater kurz informieren.
5. Einmal manuell testen: *Run workflow* mit Haken **with_order**. Im Backend prüfen: Bestellung storniert, Notiz vorhanden, keine Admin-Mail beim Kunden.
6. Dauerhaft einschalten: `UPDATE_MONITOR_WITH_ORDER` auf `true` (nach Updates) und Variable `WITH_ORDER_WEEKLY` auf `true` (montags).

Admin-Mails zu Testbestellungen (neu, storniert, fehlgeschlagen) leitet das Plugin automatisch an die Testadresse um.

---

## Im Betrieb

- **Protokoll-Mail grün:** nichts zu tun.
- **Rot:** Mail zeigt Prüfung und Fehlertext. Ausführlicher Bericht mit Screenshots und Ablaufaufzeichnung: Link in der Mail → *Artifacts*.
- **Gewollte Änderung an der Seite** (neues Banner, neuer Slider): *Run workflow* mit **update_screenshots** → neue Referenzbilder.
- **Seiten ergänzen:** `PAGES` in `lib/config.ts`.
- **Kosten:** GitHub Free enthält 2.000 Minuten/Monat für private Repositories; Bedarf ca. 200–250.
