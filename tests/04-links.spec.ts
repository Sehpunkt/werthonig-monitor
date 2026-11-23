import { test, expect, openPage } from '../lib/fixtures';
import { SITE_URL } from '../lib/config';

const SKIP = /add-to-cart|customer-logout|wp-admin|wp-login|\/feed\/|\?s=|#|mailto:|tel:|javascript:/i;

test('Interne Links der Startseite und Fußzeile erreichbar', async ({ page, request }) => {
  test.setTimeout(240_000);
  await openPage(page, '/');
  const host = new URL(SITE_URL).host;
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));

  const links = [...new Set(hrefs)]
    .filter((h) => { try { return new URL(h).host === host; } catch { return false; } })
    .filter((h) => !SKIP.test(h))
    .slice(0, 150);

  const broken: string[] = [];
  for (const url of links) {
    // Doppelte Domain im Pfad (z. B. /https://werthonig.de/...)
    if (/\/https?:\/\//.test(new URL(url).pathname)) {
      broken.push(`${url} → fehlerhafter Link (Domain doppelt)`);
      continue;
    }
    const res = await request.get(url, { maxRedirects: 5, failOnStatusCode: false, timeout: 30_000 }).catch(() => null);
    if (!res || res.status() >= 400) broken.push(`${url} → ${res ? res.status() : 'keine Antwort'}`);
  }
  expect(broken, 'Kaputte Links').toEqual([]);
});
