import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { IMAP } from './config';

export type Mail = { subject: string; from: string; to: string; html: string; text: string; date: Date };

function client() {
  if (!IMAP.host || !IMAP.pass) throw new Error('IMAP_HOST oder IMAP_PASS fehlt.');
  return new ImapFlow({
    host: IMAP.host,
    port: IMAP.port,
    secure: IMAP.port === 993,
    auth: { user: IMAP.user, pass: IMAP.pass },
    logger: false,
  });
}

function toMail(p: ParsedMail): Mail {
  const addr = (a: ParsedMail['to'] | ParsedMail['from']) =>
    (Array.isArray(a) ? a.map((x) => x.text).join(', ') : a?.text) ?? '';
  return {
    subject: p.subject ?? '',
    from: addr(p.from),
    to: addr(p.to),
    html: typeof p.html === 'string' ? p.html : '',
    text: p.text ?? '',
    date: p.date ?? new Date(),
  };
}

/**
 * Wartet, bis alle gesuchten Mails im Testpostfach angekommen sind.
 * `matchers` = je Mail eine Bedingung; Ergebnis in derselben Reihenfolge (null = nicht gefunden).
 */
export async function waitForMails(
  matchers: ((m: Mail) => boolean)[],
  opts: { since: Date; timeoutMs?: number; pollMs?: number },
): Promise<(Mail | null)[]> {
  const timeout = opts.timeoutMs ?? 180_000;
  const poll = opts.pollMs ?? 10_000;
  const deadline = Date.now() + timeout;
  const found: (Mail | null)[] = matchers.map(() => null);
  // IMAP "SINCE" arbeitet tageweise; genauer filtern wir selbst.
  const sinceDay = new Date(opts.since.getTime() - 24 * 3600_000);
  const since = opts.since.getTime() - 120_000;

  while (Date.now() < deadline && found.some((f) => !f)) {
    const c = client();
    await c.connect();
    const lock = await c.getMailboxLock('INBOX');
    try {
      const uids = (await c.search({ since: sinceDay }, { uid: true })) || [];
      for await (const msg of c.fetch(uids.slice(-50), { source: true, internalDate: true }, { uid: true })) {
        if (!msg.source) continue;
        const internal = msg.internalDate ? new Date(msg.internalDate).getTime() : Date.now();
        if (internal < since) continue;
        const mail = toMail(await simpleParser(msg.source));
        matchers.forEach((match, i) => {
          if (!found[i] && match(mail)) found[i] = mail;
        });
      }
    } finally {
      lock.release();
      await c.logout().catch(() => {});
    }
    if (found.some((f) => !f)) await new Promise((r) => setTimeout(r, poll));
  }
  return found;
}

/** Löscht Mails, die älter als `days` Tage sind, damit das Testpostfach nicht vollläuft. */
export async function cleanupMailbox(days = 14) {
  const c = client();
  await c.connect();
  const lock = await c.getMailboxLock('INBOX');
  try {
    const before = new Date(Date.now() - days * 24 * 3600_000);
    const uids = (await c.search({ before }, { uid: true })) || [];
    if (uids.length) await c.messageDelete(uids, { uid: true });
  } finally {
    lock.release();
    await c.logout().catch(() => {});
  }
}

/** Alle Bild-URLs aus einer HTML-Mail. */
export function imageUrls(html: string): string[] {
  return [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
}
