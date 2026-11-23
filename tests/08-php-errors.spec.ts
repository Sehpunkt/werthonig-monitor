import { test, expect } from '../lib/fixtures';
import { monitorApi } from '../lib/api';
import { saveResult, addNotice } from '../lib/results';

// Läuft bewusst nach den Seiten- und Kassen-Tests, damit deren Fehler mit erfasst werden.
test('Keine neuen PHP-Fehler seit dem letzten Lauf', async () => {
  const data = await monitorApi('/php-errors');
  saveResult('php-errors', data);

  if (!data.log_found) {
    addNotice('PHP-Fehlerlog nicht gefunden – WP_DEBUG_LOG aktivieren.');
    return;
  }
  const { fatal, warning, notice, deprecated } = data.counts;
  if (notice || deprecated) addNotice(`PHP: ${notice} Notices, ${deprecated} Deprecated seit dem letzten Lauf (nur Hinweis).`);

  const serious = data.messages.filter((m: any) => m.type === 'fatal' || m.type === 'warning').map((m: any) => `${m.count}× ${m.message}`);
  expect(fatal + warning, `Neue PHP-Fehler/Warnungen:\n${serious.join('\n')}`).toBe(0);
});
