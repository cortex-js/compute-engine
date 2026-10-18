import { ComputeEngine } from '../../src/compute-engine';

// The comparisons read an `Undefined` operand as an absent operand: the value
// of `Less(Undefined, 3)` is `Missing`, as for `Less(Missing, 3)`. The type
// handlers read the operand TYPE, and the type of `Undefined` is `unknown`,
// which has no `missing` arm, so the static type was `boolean` and excluded
// the value. The type handlers now read the `Undefined` symbol itself, and
// the type is `boolean | missing` (user decision of 2026-10-17).
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

describe('A COMPARISON WITH AN UNDEFINED OPERAND', () => {
  const cases: [string, any[]][] = [];
  for (const head of HEADS)
    for (const args of [
      ['Undefined', 3],
      [3, 'Undefined'],
      ['Undefined', 'Undefined'],
    ])
      cases.push([head, args]);

  test.each(cases)(
    '%s%j is typed boolean | missing and evaluates to Missing',
    (head, args) => {
      const expr = ce.box([head, ...args]);
      expect(expr.isValid).toBe(true);
      expect(expr.type.toString()).toBe('boolean | missing');
      const value = expr.evaluate();
      expect(value.json).toBe('Missing');
      expect(value.type.matches(expr.type)).toBe(true);
    }
  );

  test.each(HEADS)('%s on the parse route', (head) => {
    const latex = {
      Less: '\\operatorname{Undefined} < 3',
      LessEqual: '\\operatorname{Undefined} \\le 3',
      Greater: '\\operatorname{Undefined} > 3',
      GreaterEqual: '\\operatorname{Undefined} \\ge 3',
      Equal: '\\operatorname{Undefined} = 3',
      NotEqual: '\\operatorname{Undefined} \\ne 3',
    }[head]!;
    const expr = ce.parse(latex);
    expect(expr.type.toString()).toBe('boolean | missing');
    expect(expr.evaluate().json).toBe('Missing');
  });

  test('a Missing operand keeps the type missing', () => {
    for (const head of HEADS)
      expect(ce.box([head, 'Missing', 3]).type.toString()).toBe('missing');
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
    [['NotGreater', 'Undefined', 3], 'Missing'],
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
