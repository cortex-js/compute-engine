import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  epsilHighlightTokens,
  epsilStreamParser,
  type EpsilStringStream,
} from '../../src/epsil-highlight';
import { tokenize } from '../../src/epsil/lexer';

// The `@cortex-js/compute-engine/epsil-highlight` entry. Its token
// boundaries must be the lexer's, and its stream parser, which sees one line
// at a time, must give the same ranges as `epsilHighlightTokens`.

const DOCS_DIR = join(__dirname, '../../src/epsil/docs');
const DOC_FILES = [DOCS_DIR, join(DOCS_DIR, 'reference')].flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => join(dir, name))
);

/** Every ```epsil and ```epsil-live block of the documentation. */
function corpus(): { name: string; source: string }[] {
  const out: { name: string; source: string }[] = [];
  for (const file of DOC_FILES) {
    const text = readFileSync(file, 'utf8');
    const re = /^```(?:epsil|epsil-live)[^\n]*\n([\s\S]*?)^```/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      out.push({ name: `${file.slice(DOCS_DIR.length + 1)}:${line}`, source: m[1] });
    }
  }
  return out;
}

const BLOCKS = corpus();

/** Run the stream parser over `source` the way CodeMirror does: one line at
 * a time, `blankLine` for an empty line, a copy of the state per line. */
function streamTokens(source: string): string[] {
  let state = epsilStreamParser.startState();
  const out: string[] = [];
  let offset = 0;
  for (const line of source.split('\n')) {
    if (line === '') epsilStreamParser.blankLine(state);
    else {
      const stream: EpsilStringStream = {
        string: line,
        pos: 0,
        sol() {
          return this.pos === 0;
        },
        skipToEnd() {
          this.pos = this.string.length;
        },
      };
      while (stream.pos < line.length) {
        const from = stream.pos;
        const style = epsilStreamParser.token(stream, state);
        if (stream.pos <= from) throw new Error(`no progress in ${line}`);
        if (style !== null)
          out.push(`${offset + from}-${offset + stream.pos} ${style}`);
      }
    }
    state = epsilStreamParser.copyState(state);
    offset += line.length + 1;
  }
  return out;
}

/** The style of each range, keyed by its text. */
function styles(source: string): [string, string][] {
  return epsilHighlightTokens(source).map((t) => [
    source.slice(t.start, t.end),
    t.style,
  ]);
}

describe('EPSIL HIGHLIGHT', () => {
  test('the corpus has blocks', () => {
    expect(BLOCKS.length).toBeGreaterThan(200);
  });

  test('every token boundary of the lexer is a range boundary', () => {
    const failures: string[] = [];
    for (const { name, source } of BLOCKS) {
      const ranges = epsilHighlightTokens(source);
      // No range straddles a token boundary, and each non-EOF token is
      // covered by ranges from its start to its end.
      const starts = new Set(ranges.map((r) => r.start));
      const ends = new Set(ranges.map((r) => r.end));
      for (const tok of tokenize(source)) {
        if (tok.type === 'EOF') continue;
        const text = JSON.stringify(source.slice(tok.start, tok.end));
        if (!starts.has(tok.start) || !ends.has(tok.end))
          failures.push(`${name}: ${tok.type} ${text}`);
        for (const r of ranges)
          if (
            (r.start < tok.start && r.end > tok.start) ||
            (r.start < tok.end && r.end > tok.end)
          )
            failures.push(`${name}: range crosses ${tok.type} ${text}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('every character outside a token is white space or a comment', () => {
    const failures: string[] = [];
    for (const { name, source } of BLOCKS) {
      const inToken = new Uint8Array(source.length);
      for (const tok of tokenize(source))
        for (let i = tok.start; i < tok.end; i++) inToken[i] = 1;
      const style: (string | undefined)[] = new Array(source.length);
      for (const r of epsilHighlightTokens(source))
        for (let i = r.start; i < r.end; i++) style[i] = r.style;
      for (let i = 0; i < source.length; i++) {
        if (inToken[i] || /\s/.test(source[i])) continue;
        if (style[i] !== 'comment' && style[i] !== 'docComment') {
          failures.push(`${name}: ${JSON.stringify(source.slice(i, i + 20))}`);
          break;
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test('the stream parser gives the ranges of epsilHighlightTokens', () => {
    const failures: string[] = [];
    for (const { name, source } of BLOCKS) {
      const viaFunction = epsilHighlightTokens(source).map(
        (t) => `${t.start}-${t.end} ${t.style}`
      );
      if (JSON.stringify(streamTokens(source)) !== JSON.stringify(viaFunction))
        failures.push(name);
    }
    expect(failures).toEqual([]);
  });

  test('constructs that span lines', () => {
    const source = [
      'while x < 1 {',
      '  let y = 2',
      '}',
      '/* a /* nested',
      'comment */ still */ z',
      's = """',
      '  text \\(x + 1)',
      '  """',
      'm = $\\frac{1}',
      '{2}$ + 1',
    ].join('\n');
    expect(styles(source)).toEqual([
      ['while', 'controlKeyword'],
      ['x', 'variableName'],
      ['<', 'operator'],
      ['1', 'number'],
      ['{', 'brace'],
      ['let', 'definitionKeyword'],
      ['y', 'variableName'],
      ['=', 'operator'],
      ['2', 'number'],
      ['}', 'brace'],
      ['/* a /* nested', 'comment'],
      ['comment */ still */', 'comment'],
      ['z', 'variableName'],
      ['s', 'variableName'],
      ['=', 'operator'],
      ['"""', 'string'],
      ['  text ', 'string'],
      ['\\(', 'escape'],
      ['x', 'variableName'],
      ['+', 'operator'],
      ['1', 'number'],
      [')', 'escape'],
      ['  """', 'string'],
      ['m', 'variableName'],
      ['=', 'operator'],
      ['$\\frac{1}', 'latex'],
      ['{2}$', 'latex'],
      ['+', 'operator'],
      ['1', 'number'],
    ]);
  });

  test('single-line strings, names and literals', () => {
    expect(styles('r = #"a "b" c"# + "x\\n\\z"')).toEqual([
      ['r', 'variableName'],
      ['=', 'operator'],
      ['#"a "b" c"#', 'rawString'],
      ['+', 'operator'],
      ['"x', 'string'],
      ['\\n', 'escape'],
      ['\\z', 'invalid'],
      ['"', 'string'],
    ]);
    expect(styles('f(π) + `while`(oo, true, Nothing) + p.type')).toEqual([
      ['f', 'functionName'],
      ['(', 'paren'],
      ['π', 'atom'],
      [')', 'paren'],
      ['+', 'operator'],
      ['`while`', 'functionName'],
      ['(', 'paren'],
      ['oo', 'atom'],
      [',', 'separator'],
      ['true', 'bool'],
      [',', 'separator'],
      ['Nothing', 'atom'],
      [')', 'paren'],
      ['+', 'operator'],
      ['p', 'variableName'],
      ['.', 'operator'],
      ['type', 'variableName'],
    ]);
  });

  test('a contextual word is a keyword only where it heads a construct', () => {
    expect(styles('let type = 5')).toEqual([
      ['let', 'definitionKeyword'],
      ['type', 'variableName'],
      ['=', 'operator'],
      ['5', 'number'],
    ]);
    expect(styles('let (q, r) = d')[0]).toEqual(['let', 'definitionKeyword']);
    expect(styles('x is real')).toEqual([
      ['x', 'variableName'],
      ['is', 'operatorKeyword'],
      ['real', 'variableName'],
    ]);
  });

  test('glyph operators, escapes and an unclosed string', () => {
    expect(styles('√2 × 3')).toEqual([
      ['√', 'operator'],
      ['2', 'number'],
      ['×', 'operator'],
      ['3', 'number'],
    ]);
    expect(styles('"\\u{41}\\u{xyz}\\u{110000}\\uD800\\u0041"')).toEqual([
      ['"', 'string'],
      ['\\u{41}', 'escape'],
      ['\\u{', 'invalid'],
      ['xyz}', 'string'],
      ['\\u{110000}', 'invalid'],
      ['\\uD800', 'invalid'],
      ['\\u0041', 'escape'],
      ['"', 'string'],
    ]);
    // A malformed escape covers what the lexer consumes: the hex digits, not
    // the closing quote (CE-1781).
    expect(styles('"\\u" + 2')).toEqual([
      ['"', 'string'],
      ['\\u', 'invalid'],
      ['"', 'string'],
      ['+', 'operator'],
      ['2', 'number'],
    ]);
    expect(styles('"a\\u{12" + 2')).toEqual([
      ['"a', 'string'],
      ['\\u{12', 'invalid'],
      ['"', 'string'],
      ['+', 'operator'],
      ['2', 'number'],
    ]);
    expect(styles('"\\u{}\\u123😀\\u００４１"')).toEqual([
      ['"', 'string'],
      ['\\u{}', 'invalid'],
      ['\\u123', 'invalid'],
      ['😀', 'string'],
      ['\\u００４１', 'escape'],
      ['"', 'string'],
    ]);
    // A `\` that ends the line of an unclosed single-line string is an
    // invalid escape, as the lexer reports it, alone or before spaces
    // (CE-1782). In a `"""` string it is a line continuation.
    expect(styles('let s = "C:\\')).toEqual([
      ['let', 'definitionKeyword'],
      ['s', 'variableName'],
      ['=', 'operator'],
      ['"C:', 'string'],
      ['\\', 'invalid'],
    ]);
    expect(styles('"C:\\  ')).toEqual([
      ['"C:', 'string'],
      ['\\ ', 'invalid'],
      [' ', 'string'],
    ]);
    expect(styles('"""\na\\\nb\\  \n"""')).toEqual([
      ['"""', 'string'],
      ['a', 'string'],
      ['\\', 'escape'],
      ['b', 'string'],
      ['\\  ', 'escape'],
      ['"""', 'string'],
    ]);
    // The lexer's token for `"x\` ends one unit past the source.
    const ranges = epsilHighlightTokens('"x\\');
    expect(Math.max(...ranges.map((r) => r.end))).toBe(3);
  });

  test('a line that holds a whole """ string leaves no string open', () => {
    // A host that does not end lines at U+2028 gives the stream parser one
    // line with the whole string.
    const state = epsilStreamParser.startState();
    const run = (line: string): (string | null)[] => {
      const stream: EpsilStringStream = {
        string: line,
        pos: 0,
        sol() {
          return this.pos === 0;
        },
        skipToEnd() {
          this.pos = this.string.length;
        },
      };
      const out: (string | null)[] = [];
      while (stream.pos < line.length)
        out.push(epsilStreamParser.token(stream, state));
      return out;
    };
    expect(run('s = """\u2028\\(x)\u2028"""')).toEqual([
      'variableName',
      null,
      'operator',
      null,
      'string',
      'escape',
      'variableName',
      'escape',
      'string',
    ]);
    expect(run('let y')).toEqual(['definitionKeyword', null, 'variableName']);
  });

  test('strings nested in interpolations, many levels deep', () => {
    let source = 'x';
    for (let i = 0; i < 200; i++) source = `"\\(${source})"`;
    const ranges = epsilHighlightTokens(source);
    expect(ranges[0]).toEqual({ start: 0, end: 1, style: 'string' });
    expect(ranges[ranges.length - 1].end).toBe(source.length);
  });

  test('a shebang only on the first line', () => {
    expect(styles('#!/usr/bin/env epsil\n#simplify')).toEqual([
      ['#!/usr/bin/env epsil', 'meta'],
      ['#simplify', 'meta'],
    ]);
  });
});
