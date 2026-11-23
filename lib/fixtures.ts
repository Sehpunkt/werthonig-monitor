import { test as base, expect, type Page } from '@playwright/test';
import { BLOCKED_HOSTS } from './config';

type Fixtures = {
  /** Gesammelte JavaScript-Fehler der Seite (Abbrüche, nicht nur Konsolen-Warnungen). */
  pageErrors: string[];
};

export const test = base.extend<Fixtures>({
  pageErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message.slice(0, 300)));
    await use(errors);
  },
  page: async ({ page }, use) => {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (BLOCKED_HOSTS.some((h) => url.includes(h))) return route.abort();
      return route.continue();
    });
    await use(page);
  },
});

export { expect };

/**
 * Schließt den Cookie-Banner möglichst datensparsam (Ablehnen/Nur notwendige).
 * Unbekannte Banner werden ignoriert; der Test läuft trotzdem weiter.
 */
export async function dismissCookieBanner(page: Page) {
  const candidates = [
    page.locator('.cmplz-btn.cmplz-deny'),
    page.locator('.cmplz-btn.cmplz-functional'),
    page.getByRole('button', { name: /^(ablehnen|alle ablehnen|nur notwendige|nur essenzielle|nur funktionale)/i }),
    page.getByRole('button', { name: /^(speichern|einstellungen speichern|auswahl speichern)$/i }),
    page.getByRole('button', { name: /^(akzeptieren|alle akzeptieren|einverstanden)$/i }),
  ];
  for (const c of candidates) {
    const btn = c.first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
}

/** Seite öffnen, warten bis sie ruhig ist, Banner schließen. */
export async function openPage(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await dismissCookieBanner(page);
  return response;
}
