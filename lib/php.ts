/** Erkennt PHP-Meldungen, die versehentlich in HTML oder Mails ausgegeben werden. */
const PHP_MESSAGE = /(?:<b>)?(Fatal error|Parse error|Warning|Notice|Deprecated)(?:<\/b>)?\s*:\s*.{3,300}?\s+in\s+(?:<b>)?\/[^\s<]+\.php(?:<\/b>)?\s+on line/gi;

export function findPhpMessages(content: string): string[] {
  const text = content.replace(/\s+/g, ' ');
  const hits = new Set<string>();
  for (const m of text.matchAll(PHP_MESSAGE)) {
    hits.add(m[0].replace(/<\/?b>/g, '').slice(0, 300));
    if (hits.size >= 10) break;
  }
  return [...hits];
}
