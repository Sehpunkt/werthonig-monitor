import { test, expect } from '../lib/fixtures';
import { monitorApi } from '../lib/api';
import { waitForMails, cleanupMailbox } from '../lib/mail';
import { addNotice } from '../lib/results';

test('Mailversand: Testmail kommt im Testpostfach an', async () => {
  test.setTimeout(240_000);
  await cleanupMailbox(14).catch((e) => addNotice(`Testpostfach konnte nicht aufgeräumt werden: ${e.message}`));

  const since = new Date();
  const res = await monitorApi<{ sent: boolean; token: string; error: string }>('/test-mail', { method: 'POST' });
  expect(res.sent, `wp_mail() meldet Fehler: ${res.error}`).toBe(true);

  const [mail] = await waitForMails([(m) => m.subject.includes(res.token)], { since, timeoutMs: 180_000 });
  expect(mail, 'Testmail ist nach 3 Minuten nicht angekommen').not.toBeNull();
});
