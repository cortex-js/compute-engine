/**
 * A compiled element read (`At`, `First`, `Last`) or selector (`Take`,
 * `Drop`, `Rest`, `Most`) of an operand that may be one string at run time,
 * without a type that proves a list or a string.
 *
 * The interpreter reads a string by grapheme cluster: `First(p)` of `"😀b"`
 * is `"😀"`. The generic compiled lowerings read it as an array, by UTF-16
 * code unit on JavaScript and by code point on Python, so such an operand
 * fails closed and the interpreter evaluates it:
 *
 * - JavaScript, `p: broadcastable<broadcastable<string>>` (and an alias of
 *   `broadcastable<string>` as the cells): `At(p, 1)` gave `undefined` and
 *   `First(p)` gave `"\ud83d"`. A cell that is itself a broadcastable of
 *   strings is not a subtype of `string`, and only one level of cells was
 *   read.
 * - JavaScript, `p: broadcastable<any>`, `broadcastable<value>` or `any`:
 *   `First(p)` gave `"\ud83d"`, where `At` and `Last` already declined.
 * - Python, `p: broadcastable<string>` or `string | list<string>`: `At(p, 1)`
 *   gave `nan` for `"abc"`, and `First(p)` emitted `_l[0]`.
 *
 * Python is not run here: the tests check that the compile is refused.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const EMOJI = { str: '😀b' };

/** The interpreted value of `json` with `p` declared `decl` and assigned
 * `"😀b"`. */
function interpreted(
  decl: string,
  json: unknown,
  setup?: (ce: ComputeEngine) => void
): string {
  const ce = new ComputeEngine();
  setup?.(ce);
  ce.declare('p', decl);
  const e = ce.box(json as any);
  ce.assign('p', ce.box(EMOJI));
  return e.evaluate().toString();
}

function compiles(
  decl: string,
  json: unknown,
  to: 'javascript' | 'python',
  setup?: (ce: ComputeEngine) => void
): boolean {
  const ce = new ComputeEngine();
  setup?.(ce);
  ce.declare('p', decl);
  try {
    compile(ce.box(json as any), { to, fallback: false });
    return true;
  } catch {
    return false;
  }
}

const READS: [unknown, string][] = [
  [['At', 'p', 1], '"😀"'],
  [['First', 'p'], '"😀"'],
  [['Last', 'p'], '"b"'],
];

const SELECTORS: unknown[] = [
  ['Take', 'p', 1],
  ['Drop', 'p', 1],
  ['Rest', 'p'],
  ['Most', 'p'],
];

describe('JavaScript: a broadcastable whose cells are broadcastables of strings', () => {
  const NESTED = 'broadcastable<broadcastable<string>>';

  test.each(READS)('%j fails closed', (json, value) => {
    expect(compiles(NESTED, json, 'javascript')).toBe(false);
    expect(interpreted(NESTED, json)).toBe(value);
  });

  // Each selector is wrapped in an array: `test.each` spreads an array row
  // into the arguments.
  test.each(SELECTORS.map((json) => [json]))('%j fails closed', (json) => {
    expect(compiles(NESTED, json, 'javascript')).toBe(false);
  });

  test.each(READS)(
    '%j fails closed when the cells are an alias',
    (json, value) => {
      const setup = (ce: ComputeEngine) =>
        ce.declareType('text', 'broadcastable<string>', { alias: true });
      expect(compiles('broadcastable<text>', json, 'javascript', setup)).toBe(
        false
      );
      expect(interpreted('broadcastable<text>', json, setup)).toBe(value);
    }
  );
});

describe('JavaScript: First of an operand with a top type', () => {
  test.each(['broadcastable<any>', 'broadcastable<value>', 'any'])(
    'First(p) for p: %s fails closed',
    (decl) => {
      expect(compiles(decl, ['First', 'p'], 'javascript')).toBe(false);
      expect(interpreted(decl, ['First', 'p'])).toBe('"😀"');
    }
  );

  test('First of a provable list of numbers still compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<number>');
    const r = compile(ce.box(['First', 'p']), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ p: [3, 4] } as any)).toBe(3);
  });
});

describe('Python: an operand that may be one string', () => {
  test.each([
    'broadcastable<string>',
    'string | list<string>',
    'broadcastable<broadcastable<string>>',
  ])('the element reads and the selectors of p: %s fail closed', (decl) => {
    for (const [json] of READS)
      expect(compiles(decl, json, 'python')).toBe(false);
    for (const json of SELECTORS)
      expect(compiles(decl, json, 'python')).toBe(false);
  });

  test('the interpreter reads one string by grapheme cluster', () => {
    for (const [json, value] of READS)
      expect(interpreted('broadcastable<string>', json)).toBe(value);
  });

  test('a provable list of numbers still compiles', () => {
    for (const [json] of READS)
      expect(compiles('list<number>', json, 'python')).toBe(true);
    for (const json of SELECTORS)
      expect(compiles('list<number>', json, 'python')).toBe(true);
  });
});
