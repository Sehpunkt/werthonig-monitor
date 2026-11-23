import { test, expect, openPage } from '../lib/fixtures';
import { PAGES, DYNAMIC_SELECTORS } from '../lib/config';

/**
 * Screenshot-Vergleich gegen freigegebene Referenzbilder (Desktop + Mobil).
 * Neue Referenzbilder: Workflow "Monitor" manuell mit "update_screenshots" starten.
 */
test.describe('Darstellung @visual', () => {
  for (const p of PAGES) {
    test(`${p.name} @visual`, async ({ page }) => {
      await openPage(page, p.path);
      // Lazy-Load anstoßen und zurück nach oben
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 100));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(1000);
      await expect(page).toHaveScreenshot(`${p.name}.png`, {
        fullPage: true,
        mask: DYNAMIC_SELECTORS.map((s) => page.locator(s)),
        timeout: 30_000,
      });
    });
  }
});
