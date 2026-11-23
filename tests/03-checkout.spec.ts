import { test, expect, openPage } from '../lib/fixtures';
import { monitorApi } from '../lib/api';
import { PAYMENT_LOGO_MAX_HEIGHT, SIMPLE_PRODUCT_ID, PAGES } from '../lib/config';
import { findPhpMessages } from '../lib/php';

test.describe('German Market und Kasse', () => {
  let urls: { cart: string; checkout: string };

  test.beforeAll(async () => {
    const status = await monitorApi('/status');
    urls = status.urls;
    if (!urls?.cart || !urls?.checkout) throw new Error('Warenkorb-/Kassen-URL nicht ermittelbar (WooCommerce aktiv?).');
  });

  test('Produktseite zeigt Pflichtangaben', async ({ page }) => {
    const product = PAGES.find((p) => p.name === 'produkt-einfach')!;
    await openPage(page, product.path);
    const summary = page.locator('.summary, .product').first();
    await expect(summary).toContainText(/MwSt/i);
    await expect(summary).toContainText(/Grundpreis/i);
    await expect(summary).toContainText(/Lieferzeit/i);
    await expect(summary).toContainText(/Versand/i);
    await expect(page.getByRole('link', { name: /Vertrag widerrufen/i }).first()).toBeVisible();
  });

  test('Warenkorb und Kasse funktionieren, PayPal korrekt dargestellt', async ({ page, pageErrors }) => {
    await page.goto(`/?add-to-cart=${SIMPLE_PRODUCT_ID}`);
    await openPage(page, urls.cart);
    await expect(page.locator('.woocommerce-cart-form, .wc-block-cart').first(), 'Warenkorb ist leer').toBeVisible();
    await expect(page.locator('.cart_item, .wc-block-cart-items__row').first()).toBeVisible();

    await openPage(page, urls.checkout);
    const html = await page.content();
    expect.soft(findPhpMessages(html), 'PHP-Meldungen in der Kasse').toEqual([]);

    const payment = page.locator('#payment, .wc-block-checkout__payment-method').first();
    await expect(payment, 'Zahlungsbereich fehlt').toBeVisible();
    await expect(payment, 'PayPal fehlt in der Zahlungsauswahl').toContainText(/PayPal/i);

    // Kein Logo/Bild in der Zahlungsauswahl höher als erlaubt (Fall "riesiges PayPal-Logo").
    const tooBig = await payment.locator('img').evaluateAll(
      (imgs, max) =>
        imgs
          .map((i) => ({ src: (i as HTMLImageElement).src.split('/').pop(), h: Math.round(i.getBoundingClientRect().height) }))
          .filter((i) => i.h > (max as number)),
      PAYMENT_LOGO_MAX_HEIGHT,
    );
    expect.soft(tooBig, `Bilder in der Zahlungsauswahl höher als ${PAYMENT_LOGO_MAX_HEIGHT}px`).toEqual([]);

    // Rechtstexte / Checkboxen von German Market
    const legal = page.locator('form.checkout, .wc-block-checkout').first();
    await expect.soft(legal, 'AGB-Hinweis fehlt').toContainText(/AGB|Allgemeine Geschäftsbedingungen/i);
    await expect.soft(legal, 'Widerrufs-Hinweis fehlt').toContainText(/Widerruf/i);
    const checkboxes = await legal.locator('input[type="checkbox"]').count();
    expect.soft(checkboxes, 'Keine Checkboxen in der Kasse (AGB-Bestätigung?)').toBeGreaterThan(0);
    await expect.soft(page.locator('#place_order, .wc-block-components-checkout-place-order-button').first(), 'Bestellbutton fehlt').toBeVisible();

    expect.soft(pageErrors, 'JavaScript-Fehler in der Kasse').toEqual([]);
  });
});
