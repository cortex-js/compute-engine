import { ComputeEngine } from '../../src/compute-engine';

// Every logic connective reads an absent operand (`Missing`, or `Undefined`,
// which is read the same way) by the same Kleene rule: an operand that
// decides the result wins, otherwise the result is the absence marker
// `Missing`. `Xor` and `Equivalent` have no deciding operand — flipping any
// one operand flips the result — so an absent operand makes them absent,
// unless another operand is an unknown symbol: then they stay symbolic, as
// `And(A, Missing)` does (a second user decision of 2026-09-27; before it,
// `Xor(A, Missing)` was `Missing`). Before the first user decision of
// 2026-09-27, `Xor` and `Equivalent` rejected a `Missing` operand with
// `incompatible-type` at canonicalization, and kept an `Undefined` operand
// symbolic (`Xor(True, Undefined)` evaluated to `Not(Undefined)`), while
// `And`, `Or` and `Not` answered `Missing`.
//
// The TYPE of a connective contains every value it can evaluate to (user
// decision 2026-10-18): `missing` when the result is always `Missing`
// (`And(True, Missing)`), `boolean | missing` when it may be (`And(A,
// Missing)`, an operand typed `boolean | missing`, an `Undefined` operand),
// and `boolean` when an operand decides the result (`And(False, Missing)` is
// `False`). Before this decision every connective was typed `boolean`
// whatever its operands, as the comparisons were until 2026-10-17.
//
// `docs/ERROR-MODEL.md` §3 is the reference for the absence contract.
//
// Boolean contexts use UPPERCASE symbols: evaluating a symbol as a boolean
// operand retypes it `boolean` for the engine's lifetime.

const ce = new ComputeEngine();

const evalJson = (expr: any) => ce.box(expr).evaluate().json;

describe('LOGIC CONNECTIVES WITH AN ABSENT OPERAND — box route', () => {
  const table: [any, any][] = [
    [['And', 'True', 'Missing'], 'Missing'],
    [['Or', 'False', 'Missing'], 'Missing'],
    [['Not', 'Missing'], 'Missing'],
    [['And', 'True', 'Undefined'], 'Missing'],
    [['Or', 'False', 'Undefined'], 'Missing'],
    [['Not', 'Undefined'], 'Missing'],
    [['Xor', 'True', 'Missing'], 'Missing'],
    [['Xor', 'False', 'Missing'], 'Missing'],
    [['Xor', 'True', 'Undefined'], 'Missing'],
    [['Xor', 'Missing', 'True'], 'Missing'],
    [['Xor', 'True', 'False', 'Missing'], 'Missing'],
    [
      ['Xor', 'A', 'Missing'],
      ['Xor', 'A', 'Missing'],
    ],
    [
      ['Xor', 'A', 'Undefined'],
      ['Xor', 'A', 'Missing'],
    ],
    [['Equivalent', 'True', 'Missing'], 'Missing'],
    [['Equivalent', 'False', 'Missing'], 'Missing'],
    [['Equivalent', 'True', 'Undefined'], 'Missing'],
    [['Equivalent', 'Missing', 'False'], 'Missing'],
    [['Equivalent', 'Missing', 'Missing'], 'Missing'],
    [
      ['Equivalent', 'A', 'Missing'],
      ['Equivalent', 'A', 'Missing'],
    ],
    [
      ['Equivalent', 'A', 'Undefined'],
      ['Equivalent', 'A', 'Missing'],
    ],
  ];
  test.each(table)('%j evaluates to %s', (expr, expected) => {
    const boxed = ce.box(expr);
    expect(boxed.isValid).toBe(true);
    expect(boxed.evaluate().json).toEqual(expected);
    expect(boxed.N().json).toEqual(expected);
  });

  test('the boxed expression is typed with the absent result it can give', () => {
    // `True` decides neither `And` nor `Xor` nor `Equivalent`, so the result
    // is always `Missing`; `True` decides `Or`.
    for (const op of ['And', 'Xor', 'Equivalent'])
      expect(ce.box([op, 'True', 'Missing']).type.toString()).toBe('missing');
    expect(ce.box(['Or', 'True', 'Missing']).type.toString()).toBe('boolean');
    // An `Undefined` operand is read as absent, but its own type is
    // `unknown`, so it is a possibly-absent operand, as for the comparisons.
    for (const op of ['And', 'Xor', 'Equivalent'])
      expect(ce.box([op, 'True', 'Undefined']).type.toString()).toBe(
        'boolean | missing'
      );
    expect(ce.box(['Not', 'Missing']).type.toString()).toBe('missing');
    expect(ce.box(['Not', 'Undefined']).type.toString()).toBe(
      'boolean | missing'
    );
  });

  test('the evaluated result is typed missing, as for And', () => {
    for (const op of ['And', 'Xor', 'Equivalent']) {
      expect(ce.box([op, 'True', 'Missing']).evaluate().type.toString()).toBe(
        'missing'
      );
    }
  });

  test('a possibly-absent operand validates, as for And', () => {
    const sc = new ComputeEngine();
    sc.declare('M', 'boolean | missing');
    for (const op of ['And', 'Xor', 'Equivalent']) {
      const expr = sc.box([op, 'True', 'M']);
      expect(expr.isValid).toBe(true);
      expect(expr.type.toString()).toBe('boolean | missing');
    }
  });

  test('a non-boolean operand is still a type error', () => {
    for (const op of ['Xor', 'Equivalent']) {
      const expr = ce.box([op, 'True', 1]);
      expect(expr.isValid).toBe(false);
      expect(JSON.stringify(expr.json)).toContain('incompatible-type');
    }
  });

  test('decided operands are unchanged', () => {
    expect(evalJson(['Xor', 'True', 'False'])).toEqual('True');
    expect(evalJson(['Xor', 'True', 'True'])).toEqual('False');
    expect(evalJson(['Equivalent', 'True', 'True'])).toEqual('True');
    expect(evalJson(['Equivalent', 'True', 'False'])).toEqual('False');
    // An unknown operand keeps the symbolic reductions.
    expect(evalJson(['Xor', 'True', 'B'])).toEqual(['Not', 'B']);
    expect(evalJson(['Equivalent', 'B', 'C'])).toEqual([
      'Equivalent',
      'B',
      'C',
    ]);
  });
});

describe('LOGIC CONNECTIVES WITH AN ABSENT OPERAND — parse route', () => {
  const table: [string, any, string][] = [
    [
      '\\mathrm{True}\\veebar\\mathrm{Missing}',
      ['Xor', 'True', 'Missing'],
      'Missing',
    ],
    [
      '\\mathrm{True}\\veebar\\mathrm{Undefined}',
      ['Xor', 'True', 'Undefined'],
      'Missing',
    ],
    [
      '\\operatorname{Xor}(\\mathrm{True}, \\mathrm{Missing})',
      ['Xor', 'True', 'Missing'],
      'Missing',
    ],
    [
      '\\mathrm{True}\\iff\\mathrm{Missing}',
      ['Equivalent', 'True', 'Missing'],
      'Missing',
    ],
    [
      '\\mathrm{True}\\iff\\mathrm{Undefined}',
      ['Equivalent', 'True', 'Undefined'],
      'Missing',
    ],
    [
      '\\mathrm{True}\\Leftrightarrow\\mathrm{Missing}',
      ['Equivalent', 'True', 'Missing'],
      'Missing',
    ],
    [
      '\\mathrm{True}\\land\\mathrm{Missing}',
      ['And', 'True', 'Missing'],
      'Missing',
    ],
    [
      '\\mathrm{False}\\lor\\mathrm{Missing}',
      ['Or', 'False', 'Missing'],
      'Missing',
    ],
    ['\\lnot\\mathrm{Missing}', ['Not', 'Missing'], 'Missing'],
    ['\\mathrm{True}\\veebar\\mathrm{False}', ['Xor', 'False', 'True'], 'True'],
    ['\\mathrm{True}\\iff\\mathrm{True}', 'True', 'True'],
  ];
  test.each(table)('%s', (latex, boxed, expected) => {
    const expr = ce.parse(latex);
    expect(expr.json).toEqual(boxed);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().json).toEqual(expected);
  });
});

describe('LOGIC CONNECTIVES WITH AN ABSENT OPERAND — result type', () => {
  // Each row: the expression, its type, and the value it evaluates to. The
  // type must contain the value; it is `boolean` (no `missing` arm) where an
  // operand decides the result, and `missing` where `Missing` is the only
  // possible result.
  const sc = new ComputeEngine();
  sc.declare('M', 'boolean | missing');
  const table: [any, string, any][] = [
    [['And', 'True', 'Missing'], 'missing', 'Missing'],
    [['And', 'Missing', 'True'], 'missing', 'Missing'],
    [['And', 'False', 'Missing'], 'boolean', 'False'],
    [['And', 'Missing', 'False'], 'boolean', 'False'],
    [['And', 'False', 'Undefined'], 'boolean', 'False'],
    [['And', 'True', 'Undefined'], 'boolean | missing', 'Missing'],
    [['And', 'True', 'M'], 'boolean | missing', 'M'],
    [['And', 'A', 'Missing'], 'boolean | missing', ['And', 'A', 'Missing']],
    [['Or', 'False', 'Missing'], 'missing', 'Missing'],
    [['Or', 'True', 'Missing'], 'boolean', 'True'],
    [['Or', 'False', 'M'], 'boolean | missing', 'M'],
    [['Not', 'Missing'], 'missing', 'Missing'],
    [['Not', 'Undefined'], 'boolean | missing', 'Missing'],
    [['Not', 'M'], 'boolean | missing', ['Not', 'M']],
    [['Xor', 'False', 'Missing'], 'missing', 'Missing'],
    // Whatever `A` is, an absent operand makes the exclusive or absent.
    [['Xor', 'A', 'Missing'], 'missing', ['Xor', 'A', 'Missing']],
    [['Xor', 'True', 'M'], 'boolean | missing', ['Not', 'M']],
    [['Equivalent', 'False', 'Missing'], 'missing', 'Missing'],
    [['Equivalent', 'True', 'Undefined'], 'boolean | missing', 'Missing'],
    [['Implies', 'True', 'Missing'], 'missing', 'Missing'],
    [['Implies', 'Missing', 'False'], 'missing', 'Missing'],
    [['Implies', 'False', 'Missing'], 'boolean', 'True'],
    [['Implies', 'Missing', 'True'], 'boolean', 'True'],
    [['Implies', 'Undefined', 'False'], 'boolean | missing', 'Missing'],
    [['Nand', 'True', 'Missing'], 'missing', 'Missing'],
    [['Nand', 'False', 'Missing'], 'boolean', 'True'],
    [['Nor', 'False', 'Missing'], 'missing', 'Missing'],
    [['Nor', 'True', 'Missing'], 'boolean', 'False'],
    [['Nor', 'M', 'False'], 'boolean | missing', ['Nor', 'M', 'False']],
  ];
  test.each(table)('%j is typed %s', (expr, type, value) => {
    const boxed = sc.box(expr);
    expect(boxed.isValid).toBe(true);
    expect(boxed.type.toString()).toBe(type);
    expect(boxed.evaluate().json).toEqual(value);
  });

  test('a connective without an absent operand keeps its type', () => {
    expect(sc.box(['And', 'A', 'B']).type.toString()).toBe('boolean');
    expect(sc.box(['Implies', 'A', 'B']).type.toString()).toBe('boolean');
    expect(sc.box(['Nand', 'A', 'B']).type.toString()).toBe('boolean');
    expect(sc.box(['Equivalent', 'A', 'B']).type.toString()).toBe('boolean');
    // A value type is still read: `1 < 2` is typed `true`.
    expect(sc.box(['Not', ['Less', 1, 2]]).type.toString()).toBe('false');
  });

  test('a broadcast over a list carries the missing arm to its cells', () => {
    // `And([True, False], Missing)` is `[Missing, False]`.
    const expr = sc.box(['And', ['List', 'True', 'False'], 'Missing']);
    expect(expr.type.toString()).toBe('list<boolean | missing^2>');
    expect(expr.evaluate().json).toEqual(['List', 'Missing', 'False']);
  });

  test('the negated comparisons, built from Not, are typed like Not', () => {
    // `NotLess(a, b)` is `Not(Less(a, b))`. A `Missing` operand types the
    // comparison `missing`, an `Undefined` operand `boolean | missing`.
    for (const op of [
      'NotLess',
      'NotGreater',
      'NotLessNotEqual',
      'NotGreaterNotEqual',
    ]) {
      for (const [a, b] of [
        ['Missing', 1],
        [1, 'Missing'],
      ]) {
        const expr = sc.box([op, a, b]);
        expect(expr.type.toString()).toBe('missing');
        expect(expr.evaluate().json).toEqual('Missing');
      }
      const expr = sc.box([op, 'Undefined', 1]);
      expect(expr.type.toString()).toBe('boolean | missing');
      expect(expr.evaluate().json).toEqual('Missing');
      expect(sc.box([op, 'x', 1]).type.toString()).toBe('boolean');
    }
  });

  test('the parse route gives the same types', () => {
    const table: [string, string][] = [
      ['\\mathrm{True}\\land\\mathrm{Missing}', 'missing'],
      ['\\mathrm{False}\\land\\mathrm{Missing}', 'boolean'],
      ['\\mathrm{False}\\lor\\mathrm{Missing}', 'missing'],
      ['\\lnot\\mathrm{Missing}', 'missing'],
      ['\\lnot\\mathrm{Undefined}', 'boolean | missing'],
      ['\\mathrm{True}\\veebar\\mathrm{Missing}', 'missing'],
      ['\\mathrm{True}\\iff\\mathrm{Missing}', 'missing'],
      ['\\mathrm{True}\\implies\\mathrm{Missing}', 'missing'],
      ['\\mathrm{False}\\implies\\mathrm{Missing}', 'boolean'],
      ['\\mathrm{Missing}\\not<1', 'missing'],
      ['\\mathrm{Undefined}\\not<1', 'boolean | missing'],
    ];
    for (const [latex, type] of table)
      expect([latex, ce.parse(latex).type.toString()]).toEqual([latex, type]);
  });
});
