import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('results');

/** Speichert Zusatzdaten für die Protokoll-Mail (Versionen, PHP-Fehler, Hinweise). */
export function saveResult(name: string, data: unknown) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

/** Hinweis, der im Protokoll erscheint, ohne den Test scheitern zu lassen. */
export function addNotice(text: string) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(path.join(DIR, 'notices.txt'), text + '\n');
}
