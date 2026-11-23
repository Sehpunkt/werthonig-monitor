import { test, expect, openPage, dismissCookieBanner } from '../lib/fixtures';
import { monitorApi } from '../lib/api';
import { WITH_ORDER, TEST_ACCOUNT, TEST_PRODUCT_URL, EXPECT_MAIL_IMAGES, TEST_EMAIL } from '../lib/config';
import { waitForMails, imageUrls, type Mail } from '../lib/mail';
import { findPhpMessages } from '../lib/php';
import { saveResult } from '../lib/results';

/**
 * Echte Testbestellung mit dem versteckten Testprodukt (Vorkasse), Prüfung beider
 * Bestellmails, danach automatische Stornierung. Nur mit WITH_ORDER=true.
 */
test.describe('Testbestellung', () => {
  test.skip(!WITH_ORDER, 'Testbestellung ist ausgeschaltet (WITH_ORDER=false).');

  test('Bestellung, Bestellmails, Stornierung', async ({ page, request }) => {
    test.setTimeout(360_000);
    expect(TEST_PRODUCT_URL, 'Variable TEST_PRODUCT_URL fehlt').not.toBe('');
    expect(TEST_ACCOUNT.pass, 'Secret TEST_ACCOUNT_PASS fehlt').not.toBe('');

    const status = await monitorApi('/status');
    const { myaccount, checkout } = status.urls;

    // 1. Anmelden
    await openPage(page, myaccount);
    if (await page.locator('#username').isVisible().catch(() => false)) {
      await page.fill('#username', TEST_ACCOUNT.user);
      await page.fill('#password', TEST_ACCOUNT.pass);
      await page.locator('button[name="login"]').click();
    }
    await expect(page.locator('.woocommerce-MyAccount-navigation').first(), 'Login ins Testkonto fehlgeschlagen').toBeVisible();

    // 2. Testprodukt in den Warenkorb
    await openPage(page, TEST_PRODUCT_URL);
    const productName = (await page.locator('h1.product_title, .product_title').first().innerText()).trim();
    const productImage = await page
      .locator('.woocommerce-product-gallery img, img.wp-post-image')
      .first()
      .getAttribute('src')
      .catch(() => null);
    await page.locator('.single_add_to_cart_button').first().click();
    await page.waitForLoadState('networkidle').catch(() => {});

    // 3. Kasse: Vorkasse wählen, Pflicht-Checkboxen setzen, bestellen
    await openPage(page, checkout);
    const bacs = page.locator('#payment_method_bacs');
    await expect(bacs, 'Zahlungsart Vorkasse/Überweisung nicht verfügbar').toBeAttached();
    await bacs.check({ force: true });
    await page.waitForTimeout(1000);

    const since = new Date();
    for (let step = 0; step < 3; step++) {
      // Nur Pflicht-Checkboxen anhaken, keine Newsletter o. Ä.
      const required = page.locator(
        'form.checkout .validate-required input[type="checkbox"], form.checkout input[type="checkbox"][required], #terms',
      );
      for (const box of await required.all()) {
        if (await box.isVisible().catch(() => false)) await box.check({ force: true }).catch(() => {});
      }
      await dismissCookieBanner(page);
      await page.locator('#place_order').first().click();
      // Entweder Danke-Seite oder German-Market-Prüfseite ("Bestellung prüfen").
      await page.waitForURL(/order-received|bestellung-erhalten|bestellung-pruefen|check/i, { timeout: 45_000 }).catch(() => {});
      if (/order-received|bestellung-erhalten/i.test(page.url())) break;
      const errors = await page.locator('.woocommerce-error, .woocommerce-NoticeGroup-checkout').allInnerTexts();
      if (errors.length) throw new Error(`Kasse meldet: ${errors.join(' | ').slice(0, 400)}`);
    }
    expect(page.url(), 'Danke-Seite wurde nicht erreicht').toMatch(/order-received|bestellung-erhalten/i);

    const orderId = Number(page.url().match(/\/(\d+)\/?\?key=/)?.[1]);
    const orderNumber =
      (await page.locator('.woocommerce-order-overview__order strong').first().innerText().catch(() => '')).trim() || String(orderId);
    expect(orderId, 'Bestell-ID nicht gefunden').toBeGreaterThan(0);
    saveResult('order', { orderId, orderNumber });

    try {
      // 4. Bestellmails prüfen (Kunde und – umgeleitet – Admin)
      const hasOrder = (m: Mail) => m.subject.includes(orderNumber) || m.text.includes(orderNumber) || m.html.includes(orderNumber);
      const isAdmin = (m: Mail) => /neue bestellung|new order/i.test(m.subject);
      const [customer, admin] = await waitForMails(
        [(m) => hasOrder(m) && !isAdmin(m), (m) => hasOrder(m) && isAdmin(m)],
        { since, timeoutMs: 180_000 },
      );
      expect.soft(customer, `Kundenmail zu Bestellung ${orderNumber} nicht angekommen (an ${TEST_EMAIL})`).not.toBeNull();
      expect.soft(admin, `Admin-Mail „Neue Bestellung“ ${orderNumber} nicht angekommen`).not.toBeNull();

      for (const [label, mail] of [['Kundenmail', customer], ['Admin-Mail', admin]] as const) {
        if (!mail) continue;
        const body = mail.html || mail.text;
        expect.soft(findPhpMessages(body), `${label}: PHP-Meldungen im Mailtext`).toEqual([]);
        expect.soft(body, `${label}: Produktname fehlt in der Bestelltabelle`).toContain(productName);

        if (EXPECT_MAIL_IMAGES && mail.html) {
          const stem = productImage ? productImage.split('/').pop()!.replace(/(-\d+x\d+)?\.\w+$/, '') : '';
          const imgs = imageUrls(mail.html);
          const productImg = imgs.find((u) => stem && u.includes(stem));
          expect.soft(productImg, `${label}: Produktbild fehlt in der Mail`).toBeTruthy();
          if (productImg) {
            const res = await request.get(productImg, { failOnStatusCode: false });
            expect.soft(res.status(), `${label}: Produktbild lädt nicht (${productImg})`).toBeLessThan(400);
          }
        }
      }
    } finally {
      // 5. Immer stornieren (nie löschen – Rechnungsnummern bleiben lückenlos).
      const result = await monitorApi('/cleanup-order', { method: 'POST', body: { order_id: orderId } });
      expect(result.status, 'Testbestellung wurde nicht storniert').toBe('cancelled');
    }
  });
});
