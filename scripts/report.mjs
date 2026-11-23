/**
 * Baut die Protokoll-Mail aus den Playwright-Ergebnissen und verschickt sie.
 * Meldet das Ergebnis außerdem an das WordPress-Plugin (Admin-Ansicht).
 */
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

// GitHub übergibt nicht gesetzte Variablen als leeren Text – dann gilt der Standardwert.
const env = (k, d = '') => (process.env[k] || '').trim() || d;
const SITE_URL = env('SITE_URL', 'https://werthonig.de').replace(/\/$/, '');
const RUN_URL = env('RUN_URL');
const RUN_TYPE = env('RUN_TYPE', 'manual');
const WITH_ORDER = env('WITH_ORDER') === 'true';

const readJson = (f) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const stripAnsi = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '');

// ---------- Ergebnisse einsammeln ----------
const results = readJson('results/results.json');
const status = readJson('results/status.json');
const phpErrors = readJson('results/php-errors.json');
const order = readJson('results/order.json');
const notices = fs.existsSync('results/notices.txt')
  ? [...new Set(fs.readFileSync('results/notices.txt', 'utf8').split('\n').filter(Boolean))]
  : [];
let changes = [];
try { changes = JSON.parse(env('CHANGES_JSON', 'null')) || []; } catch { changes = []; }

const tests = [];
const walk = (suite, prefix = []) => {
  const title = suite.title && !suite.title.endsWith('.ts') ? [...prefix, suite.title] : prefix;
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const last = t.results?.[t.results.length - 1];
      const errors = (last?.errors ?? []).map((e) => stripAnsi(e.message).split('\n').filter((l) => l.trim() && !/^\s*at /.test(l)).slice(0, 25).join('\n'));
      tests.push({
        title: [...title, spec.title].join(' › ').replace(/\s*@visual/g, ''),
        project: t.projectName,
        status: t.status, // expected | unexpected | flaky | skipped
        errors,
      });
    }
  }
  for (const s of suite.suites ?? []) walk(s, title);
};
(results?.suites ?? []).forEach((s) => walk(s));

const failed = tests.filter((t) => t.status === 'unexpected');
const flaky = tests.filter((t) => t.status === 'flaky');
const passed = tests.filter((t) => t.status === 'expected');
const skipped = tests.filter((t) => t.status === 'skipped');
const crashed = !results;
const ok = !crashed && failed.length === 0;

// Abweichungsbilder aus dem Screenshot-Vergleich
const diffs = [];
const findDiffs = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findDiffs(p);
    else if (e.name.endsWith('-diff.png')) diffs.push(p);
  }
};
findDiffs('test-results');

// ---------- Mail bauen ----------
const host = new URL(SITE_URL).host;
const runLabel = { 'after-update': 'nach Update', daily: 'täglicher Kontrolllauf', weekly: 'wöchentlicher Volltest', manual: 'manuell' }[RUN_TYPE] ?? RUN_TYPE;
const subject = crashed
  ? `[${host}] FEHLER – Testlauf abgebrochen (${runLabel})`
  : ok
    ? `[${host}] OK – alle ${passed.length} Prüfungen bestanden (${runLabel})`
    : `[${host}] FEHLER – ${failed.length} von ${tests.length - skipped.length} Prüfungen fehlgeschlagen (${runLabel})`;

const color = ok ? '#1a7f37' : '#cf222e';
let html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2328;max-width:760px">
<h2 style="color:${color};margin:0 0 4px">${ok ? 'Alles in Ordnung' : crashed ? 'Testlauf abgebrochen' : 'Prüfungen fehlgeschlagen'}</h2>
<p style="margin:0 0 16px;color:#57606a">${esc(host)} · ${esc(runLabel)} · ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} · Testbestellung: ${WITH_ORDER ? 'ja' : 'nein'}</p>`;

if (changes.length) {
  html += `<h3>Änderungen seit dem letzten Lauf</h3><table cellpadding="4" style="border-collapse:collapse">`;
  for (const c of changes) html += `<tr><td>${esc(c.name)}</td><td style="color:#57606a">${esc(c.from)} → <b>${esc(c.to)}</b></td></tr>`;
  html += `</table>`;
}

if (crashed) {
  html += `<p>Es liegen keine Testergebnisse vor. Vermutlich ist die Einrichtung unvollständig oder die Seite war nicht erreichbar. Details im Bericht.</p>`;
}

if (failed.length) {
  html += `<h3 style="color:#cf222e">Fehlgeschlagen (${failed.length})</h3>`;
  for (const t of failed) {
    html += `<div style="border-left:3px solid #cf222e;padding:4px 10px;margin:8px 0"><b>${esc(t.title)}</b> <span style="color:#57606a">(${esc(t.project)})</span>`;
    for (const e of t.errors) html += `<pre style="white-space:pre-wrap;font-size:12px;background:#f6f8fa;padding:6px;margin:6px 0">${esc(e)}</pre>`;
    html += `</div>`;
  }
}

if (phpErrors?.messages?.length) {
  const c = phpErrors.counts;
  html += `<h3>PHP-Log seit dem letzten Lauf</h3><p>${c.fatal} Fatal · ${c.warning} Warnungen · ${c.notice} Notices · ${c.deprecated} Deprecated</p><ul style="font-size:12px">`;
  for (const m of phpErrors.messages.slice(-10)) html += `<li>${m.count}× <code>${esc(m.message)}</code></li>`;
  html += `</ul>`;
}

if (notices.length) {
  html += `<h3>Hinweise</h3><ul>${notices.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
}

if (order) html += `<p>Testbestellung Nr. ${esc(order.orderNumber)} wurde angelegt und storniert.</p>`;

html += `<h3>Bestanden (${passed.length}${flaky.length ? `, davon ${flaky.length} erst im 2. Versuch` : ''})</h3><ul style="color:#57606a;font-size:13px">`;
for (const t of [...passed, ...flaky]) html += `<li>${esc(t.title)} <span>(${esc(t.project)})</span>${t.status === 'flaky' ? ' – wackelig' : ''}</li>`;
html += `</ul>`;

if (status) {
  html += `<h3>Umgebung</h3><p style="font-size:13px;color:#57606a">WordPress ${esc(status.wordpress)} · PHP ${esc(status.php)} · WooCommerce ${esc(status.woocommerce)} · German Market ${esc(status.german_market || '–')} · Theme ${esc(status.theme?.name)} ${esc(status.theme?.version)}${status.theme?.parent ? ` (Eltern: ${esc(status.theme.parent)})` : ''}</p>`;
}

if (diffs.length) html += `<p>Im Anhang: ${diffs.length} Abweichungsbild(er) aus dem Screenshot-Vergleich (rot = Unterschied). Ist die Änderung gewollt, in GitHub „Run workflow“ mit „update_screenshots“ starten.</p>`;
if (RUN_URL) html += `<p><a href="${esc(RUN_URL)}">Vollständiger Bericht auf GitHub</a> (unter „Artifacts“ mit Screenshots und Ablaufaufzeichnung)</p>`;
html += `</div>`;

// ---------- Versand ----------
const to = env('REPORT_TO');
if (!to || !env('SMTP_HOST')) {
  console.log('REPORT_TO oder SMTP_HOST fehlt – Mail wird nicht verschickt.\n' + subject);
} else {
  const port = Number(env('SMTP_PORT', '465'));
  const transport = nodemailer.createTransport({
    host: env('SMTP_HOST'),
    port,
    secure: port === 465,
    auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
  });
  await transport.sendMail({
    from: `Update-Monitor <${env('SMTP_USER')}>`,
    to,
    subject,
    html,
    attachments: diffs.slice(0, 10).map((p) => ({
      filename: p.split(path.sep).slice(-2).join('_').replace(/[^\w.-]/g, '_'),
      path: p,
    })),
  });
  console.log('Protokoll-Mail verschickt: ' + subject);
}

// ---------- Ergebnis ans Plugin melden ----------
if (env('MONITOR_KEY')) {
  await fetch(`${SITE_URL}/wp-json/update-monitor/v1/report`, {
    method: 'POST',
    headers: { 'X-Monitor-Key': env('MONITOR_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: ok ? 'passed' : 'failed',
      run_url: RUN_URL,
      summary: ok ? `${passed.length} bestanden (${runLabel})` : failed.map((t) => t.title).slice(0, 5).join('; '),
    }),
  }).catch((e) => console.log('Rückmeldung ans Plugin fehlgeschlagen: ' + e.message));
}
