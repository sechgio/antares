export const REFERENCE = /^ {0,3}\[([^\]\n]+)\]:[ \t]+(<[^>\n]+>|[^\s]+)(?:[ \t]+["'][^"'\n]+["'])?[ \t]*$/;
export const FENCE = /^ {0,3}(\x60{3,}|~{3,})(.*)$/;
const NO_REFERENCES = new Map<string, string>();

export function closesFence(line: string, fence: string): boolean {
  const match = FENCE.exec(line);
  return !!match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim();
}

export function referencesIn(text: string) {
  if (!text.includes(']:')) return NO_REFERENCES;
  const references = new Map<string, string>();
  let fence = '';
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (fence) {
      if (closesFence(line, fence)) fence = '';
    } else {
      fence = FENCE.exec(line)?.[1] ?? '';
      const match = REFERENCE.exec(line);
      if (match && !references.has(match[1].toLowerCase())) references.set(match[1].toLowerCase(), match[2]);
    }
  }
  return references.size ? references : NO_REFERENCES;
}

export function httpsSource(href: string) {
  const value = href.startsWith('<') && href.endsWith('>') ? href.slice(1, -1) : href;
  if (!/^https:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
