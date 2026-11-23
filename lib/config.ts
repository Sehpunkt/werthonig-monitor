/**
 * Zentrale Einstellungen. Werte kommen aus GitHub (Secrets/Variables) als
 * Umgebungsvariablen; die Standardwerte passen zu werthonig.de.
 */
const env = (name: string, fallback = '') => (process.env[name] ?? fallback).trim();

export const SITE_URL = env('SITE_URL', 'https://werthonig.de').replace(/\/$/, '');
export const MONITOR_KEY = env('MONITOR_KEY');
export const WITH_ORDER = env('WITH_ORDER', 'false') === 'true';

export const TEST_EMAIL = env('TEST_EMAIL');
export const IMAP = {
  host: env('IMAP_HOST'),
  port: Number(env('IMAP_PORT', '993')),
  user: env('IMAP_USER', env('TEST_EMAIL')),
  pass: env('IMAP_PASS'),
};

export const TEST_ACCOUNT = {
  user: env('TEST_ACCOUNT_USER', env('TEST_EMAIL')),
  pass: env('TEST_ACCOUNT_PASS'),
};

/** Verstecktes Testprodukt (virtuell, 1,00 €). */
export const TEST_PRODUCT_URL = env('TEST_PRODUCT_URL');

/** Maximale Höhe in Pixeln für Bilder/Logos in der Zahlungsauswahl. */
export const PAYMENT_LOGO_MAX_HEIGHT = Number(env('PAYMENT_LOGO_MAX_HEIGHT', '60'));

/** Sollen Bestellmails Produktbilder enthalten? */
export const EXPECT_MAIL_IMAGES = env('EXPECT_MAIL_IMAGES', 'true') === 'true';

/** Seiten für Lade-, Fehler- und Screenshot-Prüfung. Warenkorb/Kasse kommen aus /status. */
export const PAGES: { name: string; path: string }[] = [
  { name: 'startseite', path: '/' },
  { name: 'shop', path: '/onlineshop-bioland-werthonig/' },
  { name: 'produkt-einfach', path: '/produkt/knuspersenf-mit-honig-und-metessig-130ml/' },
  { name: 'produkt-variabel', path: '/produkt/fruehjahrsblueten-wabenhonig-in-der-naturwabe/' },
  { name: 'mein-konto', path: '/mein-konto/' },
  { name: 'newsletter', path: '/newsletter/' },
  { name: 'kontakt', path: '/kontakt/' },
];

/** Einfaches Produkt, das für den Kassen-Test in den Warenkorb gelegt wird. */
export const SIMPLE_PRODUCT_ID = Number(env('SIMPLE_PRODUCT_ID', '4944'));

/** Bereiche, die sich ständig ändern und im Screenshot-Vergleich ausgeblendet werden. */
export const DYNAMIC_SELECTORS = [
  'rs-module-wrap', '.rev_slider_wrapper', 'rs-module', // Slider Revolution
  'video', 'iframe',
  '[class*="instagram"]', '[id*="instagram"]', '[class*="sbi"]', // Instagram-Feeds
  '.latest_post_holder', '.blog_holder', // Aktuelles
];

/** Tracking, das im Testbrowser blockiert wird, damit die Statistik sauber bleibt. */
export const BLOCKED_HOSTS = [
  'googletagmanager.com', 'google-analytics.com', 'analytics.google.com',
  'doubleclick.net', 'connect.facebook.net', 'facebook.com/tr',
  'hotjar.com', 'clarity.ms',
];
