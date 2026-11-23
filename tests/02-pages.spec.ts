import { test, expect, openPage } from '../lib/fixtures';
import { PAGES } from '../lib/config';
import { findPhpMessages } from '../lib/php';

test.describe('Seiten laden fehlerfrei', () => {
  for (const p of PAGES) {
    test(`${p.name} (${p.path})`, async ({ page, pageErrors }) => {
      const res = await openPage(page, p.path);
      expect(res?.status(), `HTTP-Status von ${p.path}`).toBeLessThan(400);

      const html = await page.content();
      expect.soft(findPhpMessages(html), 'PHP-Meldungen im Seiteninhalt').toEqual([]);
      expect.soft(html, 'Seite ist unvollständig (kein </html>)').toContain('</html>');
      expect.soft(pageErrors, 'JavaScript-Fehler auf der Seite').toEqual([]);
    });
  }
});
