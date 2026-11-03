import { ComputeEngine } from '../../src/compute-engine';

// A comparison is two-valued (user decision of 2026-11-02, two-valued
// comparisons): an absent operand (`Missing`) makes it `False` (`NotEqual`:
// `True`), and its type is `boolean`. From 2026-10-17 to 2026-11-02 the
// value was `Missing` and the type `boolean | missing`.
//
// These tests used `Undefined` as the absent operand until `Undefined`
// became an ordinary symbol (`docs/ERROR-MODEL.md`, "`Missing` is a result
// only — user decision of 2026-11-02"): a comparison with `Undefined` now
// stays unevaluated, as with any unknown symbol.
//
// Boolean contexts use UPPERCASE symbols: evaluating a symbol as a boolean
// operand retypes it `boolean` for the engine's lifetime.

const ce = new ComputeEngine();

const HEADS = [
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
];

describe('A COMPARISON WITH A MISSING OPERAND', () => {
  const cases: [string, any[]][] = [];
  for (const head of HEADS)
    for (const args of [
      ['Missing', 3],
      [3, 'Missing'],
      ['Missing', 'Missing'],
    ])
      cases.push([head, args]);

  test.each(cases)(
    '%s%j is typed boolean and evaluates to False (NotEqual: True)',
    (head, args) => {
      const expr = ce.box([head, ...args]);
      expect(expr.isValid).toBe(true);
      expect(expr.type.toString()).toBe('boolean');
      const value = expr.evaluate();
      expect(value.json).toBe(head === 'NotEqual' ? 'True' : 'False');
      expect(value.type.matches(expr.type)).toBe(true);
    }
  );

  test.each(HEADS)('%s on the parse route', (head) => {
    const latex = {
      Less: '\\operatorname{Missing} < 3',
      LessEqual: '\\operatorname{Missing} \\le 3',
      Greater: '\\operatorname{Missing} > 3',
      GreaterEqual: '\\operatorname{Missing} \\ge 3',
      Equal: '\\operatorname{Missing} = 3',
      NotEqual: '\\operatorname{Missing} \\ne 3',
    }[head]!;
    const expr = ce.parse(latex);
    expect(expr.type.toString()).toBe('boolean');
    expect(expr.evaluate().json).toBe(head === 'NotEqual' ? 'True' : 'False');
  });

  test('an Undefined operand is an unknown symbol, not an absence', () => {
    const expr = ce.box(['Less', 'Undefined', 3]);
    expect(expr.type.toString()).toBe('boolean');
    expect(expr.evaluate().json).toEqual(['Less', 'Undefined', 3]);
  });

  test('a comparison without an absent operand keeps its type', () => {
    expect(ce.box(['Less', 'x', 3]).type.toString()).toBe('boolean');
    expect(ce.box(['Less', 1, 3]).type.toString()).toBe('true');
    expect(ce.box(['Equal', 'x', 3]).type.toString()).toBe('boolean');
  });
});

// `NotGreater(a, b)` canonicalized to `Not(Greater(a, b))` with a `Greater`
// that was not canonical. `Greater` has no evaluate handler of its own (its
// canonical form is a `Less`), so `1 \ngtr 3` stayed `Not(3 < 1)` under
// `evaluate()`. It now canonicalizes as `NotLess` does.
describe('NOTGREATER EVALUATES', () => {
  test.each([
    [['NotGreater', 1, 3], 'True'],
    [['NotGreater', 3, 1], 'False'],
    [['NotGreater', 3, 3], 'True'],
    // `Not(Missing > 3)` is `Not(False)`.
    [['NotGreater', 'Missing', 3], 'True'],
  ])('%j evaluates to %s', (expr, expected) => {
    expect(ce.box(expr).evaluate().json).toBe(expected);
  });

  test('the canonical form is the negation of the canonical Less', () => {
    expect(ce.box(['NotGreater', 1, 3]).json).toEqual(['Not', ['Less', 3, 1]]);
  });

  test('the parse route', () => {
    expect(ce.parse('1 \\ngtr 3').evaluate().json).toBe('True');
    expect(ce.parse('3 \\ngtr 1').evaluate().json).toBe('False');
  });
});
