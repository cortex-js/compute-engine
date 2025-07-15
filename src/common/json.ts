const JSON_ESCAPE_CHARS = {
  0x00: '\\u0000',
  0x01: '\\u0001',
  0x02: '\\u0002',
  0x03: '\\u0003',
  0x04: '\\u0004',
  0x05: '\\u0005',
  0x06: '\\u0006',
  0x07: '\\u0007',
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0b: '\\u000b',
  0x0c: '\\f',
  0x0d: '\\r',
  0x0e: '\\u000e',
  0x0f: '\\u000f',
  0x10: '\\u0010',
  0x11: '\\u0011',
  0x12: '\\u0012',
  0x13: '\\u0013',
  0x14: '\\u0014',
  0x15: '\\u0015',
  0x16: '\\u0016',
  0x17: '\\u0017',
  0x18: '\\u0018',
  0x19: '\\u0019',
  0x1a: '\\u001a',
  0x1b: '\\u001b',
  0x1c: '\\u001c',
  0x1d: '\\u001d',
  0x1e: '\\u001e',
  0x1f: '\\u001f',
  0x22: '\\"',
  0x2f: '\\/',
  0x5c: '\\\\',
};

/**
 * Escape a string according to the JSON string requirements
 *
 * See https://www.ietf.org/rfc/rfc4627.txt section "2.5.  Strings"
 *
 */
export function escapeJsonString(s: string): string {
  const result: string[] = [];
  for (const codePoint of Array.from(s)) {
    if (codePoint === undefined) break;
    const code = codePoint.codePointAt(0)!;
    if (JSON_ESCAPE_CHARS[code]) {
      result.push(JSON_ESCAPE_CHARS[code]);
    } else if (code > 0xffff) {
      const high = Math.floor((code - 0x10000) / 0x400) + 0xd800;
      const low = ((code - 0x10000) % 0x400) + 0xdc00;
      result.push(`\\u${high.toString(16).padStart(4, '0')}`);
      result.push(`\\u${low.toString(16).padStart(4, '0')}`);
    } else if (code < 0x20) {
      result.push(`\\u${code.toString(16).padStart(4, '0')}`);
    } else {
      result.push(codePoint);
    }
  }
  return result.join('');
}

export function unescapeJsonString(s: string | any): string {
  if (typeof s !== 'string') return s;
  if (!/[\\]/.test(s)) return s;

  const result: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') result.push(c);
    else {
      const cNext = s[++i];
      if (cNext === 'u') {
        if (i + 4 >= s.length) return s;
        const code = c[i + 1] + c[i + 2] + c[i + 3] + c[i + 4];
        i += 4;
        result.push(String.fromCharCode(Number.parseInt(code, 16)));
      } else if (cNext === 'b') result.push('\u0008');
      else if (cNext === 't') result.push('\u0009');
      else if (cNext === 'n') result.push('\u000a');
      else if (cNext === 'f') result.push('\u000c');
      else if (cNext === 'r') result.push('\u000d');
      else if (cNext === '"') result.push('"');
      else if (cNext === '\\') result.push('\\');
    }
  }
  return result.join('');
}
