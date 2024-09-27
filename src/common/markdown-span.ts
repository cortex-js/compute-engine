import type { TaggedSpan } from './markdown-types.ts';
import { StyledSpan } from './styled-text.ts';

/** Parse a markdown string into tagged text fragments */
export function parseSpan(t: string): TaggedSpan[] {
  let i = 0;
  const spans: TaggedSpan[] = [];

  // const match = (regexp: RegExp) => {
  //   const m = t.slice(i).match(regexp);
  //   if (!m) return;
  //   i += m[0].length;
  //   return m[0];
  // };

  const match = (s: string) => {
    let j = 0;
    while (i + j < t.length && t[i + j] === s[j]) j += 1;

    return j === s.length;
  };

  const peek = () => {
    if (t[i] === '\\' && t[i + 1] !== undefined) {
      // Escape characters
      if ('\\`*_{}[]<>()#+-.!|'.includes(t[i + 1])) {
        i += 1;
        return t[i];
      }
    }
    return t[i];
  };

  const consume = () => {
    const c = peek();
    i += 1;
    return c;
  };

  const parseCode = () => {
    // Note: the caller has not consumed the initial backtick

    // A quintuple backtick is a code span for a single backtick
    if (match('`````')) return { tag: 'code', s: '`' };
    // A triple backtick is also a code span for a single backtick
    if (match('```')) return { tag: 'code', s: '`' };
    i += 1;
    let s = '';

    if (t[i] === '`' && t[i + 1] === '`') {
      // In a double backtick code span, there are no escape sequences
      // and single backticks are preserved verbatim
      i += 2;
      // Inside a code span, characters are not escaped, so don't use consume()
      while (t[i] !== '`' && t[i + 1] !== '`' && i < t.length) {
        s += t[i];
        i += 1;
      }
      i += 2;
      spans.push({ tag: 'code', s });
    }

    // In a single backtick code span, backticks can be escaped
    // with \` and backslashes can be escaped with \\
    while (t[i] !== '`' && i < t.length) {
      if (t[i] === '\\' && t[i + 1] !== undefined) {
        i += 1;
        // Inside a code span, characters are not escaped, so don't use consume()
        if (t[i] === '`') s += '`';
        if (t[i] === '\\') s += '\\';
        else s += `\\${t[i]}`;
      } else s += t[i];
      i++;
    }
    i += 1;
    spans.push({ tag: 'code', s });
  };

  const parseBold = (delim: string) => {
    let s = '';
    while (!match(delim) && i < t.length) s += consume();
    spans.push({ tag: 'b', s });
  };

  const parseEmphasis = (delim: string) => {
    let s = '';
    while (!match(delim) && i < t.length) s += consume();
    spans.push({ tag: 'em', s });
  };

  const parseItalic = (delim: string) => {
    let s = '';
    while (t[i] !== delim && i < t.length) s += consume();
    spans.push({ tag: 'i', s });
  };

  const parseTag = () => {
    // Note: the caller has not consumed the initial '<'
    i += 1;
    let tag = '';
    while (t[i] !== '>' && i < t.length) {
      tag += t[i];
      i += 1;
    }
    // If there are any attributes, separate them
    // from the tag name with a space
    tag = tag.split(' ')[0];

    i += 1;

    let s = '';
    while (!match(`</${tag}>`) && i < t.length) s += consume();
    if (tag === 'code' || tag === 'kbd') spans.push({ tag: 'code', s });
    else if (tag === 'b') spans.push({ tag: 'b', s });
    else if (tag === 'i') spans.push({ tag: 'i', s });
    else if (tag === 'em') spans.push({ tag: 'em', s });
    else spans.push({ s });
  };

  while (i < t.length) {
    if (match('***')) parseEmphasis('***');
    else if (match('___')) parseEmphasis('___');
    else if (match('**')) parseBold('**');
    else if (match('__')) parseBold('__');
    else if (match('*')) parseItalic('*');
    else if (match('_')) parseItalic('_');
    else if (match('==')) {
      let s = '';
      while (!match('==') && i < t.length) s += consume();
      spans.push({ tag: 'b', s });
    } else if (t[i] === '`') parseCode();
    else if (t[i] === '<') parseTag();
    else {
      const start = i;
      while (t[i] !== '*' && t[i + 1] !== '*' && t[i] !== '`') i++;
      spans.push({ s: t.slice(start, i) });
    }
  }

  return spans;
}

export function renderSpan(spans: TaggedSpan[]): StyledSpan[] {
  const styled: StyledSpan[] = [];
  for (const span of spans) {
    if (span.tag === 'b') styled.push({ weight: 'bold', content: span.s });
    else if (span.tag === 'i') styled.push({ italic: true, content: span.s });
    else if (span.tag === 'em')
      styled.push({ italic: true, weight: 'bold', content: span.s });
    else if (span.tag === 'code')
      styled.push({ mono: true, fg: 'yellow', content: span.s });
    else styled.push({ content: span.s });
  }
  return styled;
}
