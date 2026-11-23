import { test, expect } from '../lib/fixtures';
import { monitorApi } from '../lib/api';
import { saveResult, addNotice } from '../lib/results';

test.describe('Server-Status', () => {
  test('Plugin erreichbar, Fehleranzeige aus', async () => {
    const status = await monitorApi('/status');
    saveResult('status', status);

    expect.soft(status.checks.display_errors, 'display_errors ist an – PHP-Fehler werden Besuchern angezeigt').toBe(false);
    expect.soft(status.checks.wp_debug_display, 'WP_DEBUG_DISPLAY ist an – PHP-Fehler landen in Seiten und Mails').toBe(false);
    expect.soft(status.checks.test_email_set, 'UPDATE_MONITOR_TEST_EMAIL fehlt in der wp-config.php').toBe(true);

    if (!status.checks.wp_debug_log) addNotice('WP_DEBUG_LOG ist aus – neue PHP-Fehler können nicht ausgewertet werden.');
    if (!status.checks.smtp_plugin) addNotice('Kein SMTP-Plugin aktiv (z. B. FluentSMTP) – Mailversand ohne Log und Fehlerbenachrichtigung.');
    if (!status.checks.wp_cron_disabled) addNotice('DISABLE_WP_CRON ist nicht gesetzt – Testläufe nach Updates starten erst beim nächsten Seitenaufruf.');
  });
});
