import { ComputeEngine } from '../../src/compute-engine';

// Every logic connective reads an absent operand (`Missing`, or `Undefined`,
// which is read the same way) as `False`. The logic is two-valued: an absent
// value is not a third truth value (user decision of 2026-11-02, two-valued
// comparisons). So `And(True, Missing)` is `False`, `Not(Missing)` is
// `True`, `Xor(True, Missing)` is `True` and `Xor(A, Missing)` is `A`.
// From 2026-09-27 to 2026-11-02 the connectives used the Kleene
// three-valued tables: `And(True, Missing)` was `Missing`.
//
// The TYPE of a connective is `boolean`, also with an absent operand: the
// result is never `Missing`. From 2026-10-18 to 2026-11-02 the type had a
// `missing` arm where the Kleene result could be `Missing`.
//
// `docs/ERROR-MODEL.md` is the reference for the absence contract.
//
// Boolean contexts use UPPERCASE symbols: evaluating a symbol as a boolean
// operand retypes it `boolean` for the engine's lifetime.

const ce = new ComputeEngine();

const evalJson = (expr: any) => ce.box(expr).evaluate().json;

describe('LOGIC CONNECTIVES WITH AN ABSENT OPERAND — box route', () => {
  const table: [any, any][] = [
    [['And', 'True', 'Missing'], 'False'],
    [['Or', 'False', 'Missing'], 'False'],
    [['Not', 'Missing'], 'True'],
    [['And', 'True', 'Undefined'], 'False'],
    [['Or', 'False', 'Undefined'], 'False'],
    [['Not', 'Undefined'], 'True'],
    [['Xor', 'True', 'Missing'], 'True'],
    [['Xor', 'False', 'Missing'], 'False'],
    [['Xor', 'True', 'Undefined'], 'True'],
    [['Xor', 'Missing', 'True'], 'True'],
    [['Xor', 'True', 'False', 'Missing'], 'True'],
    [['Xor', 'A', 'Missing'], 'A'],
    [['Xor', 'A', 'Undefined'], 'A'],
    [['Equivalent', 'True', 'Missing'], 'False'],
    [['Equivalent', 'False', 'Missing'], 'True'],
    [['Equivalent', 'True', 'Undefined'], 'False'],
    [['Equivalent', 'Missing', 'False'], 'True'],
    [['Equivalent', 'Missing', 'Missing'], 'True'],
    // A held equivalence spells the absent operand `False`.
    [
      ['Equivalent', 'A', 'Missing'],
      ['Equivalent', 'A', 'False'],
    ],
    [
      ['Equivalent', 'A', 'Undefined'],
      ['Equivalent', 'A', 'False'],
    ],
  ];
  test.each(table)('%j evaluates to %s', (expr, expected) => {
    const boxed = ce.box(expr);
    expect(boxed.isValid).toBe(true);
    expect(boxed.evaluate().json).toEqual(expected);
    expect(boxed.N().json).toEqual(expected);
  });

  test('the boxed expression is typed boolean', () => {
    for (const op of ['And', 'Or', 'Xor', 'Equivalent']) {
      expect(ce.box([op, 'True', 'Missing']).type.toString()).toBe('boolean');
      expect(ce.box([op, 'True', 'Undefined']).type.toString()).toBe(
        'boolean'
      );
    }
    expect(ce.box(['Not', 'Missing']).type.toString()).toBe('boolean');
    expect(ce.box(['Not', 'Undefined']).type.toString()).toBe('boolean');
  });

  test('a possibly-absent operand validates, as for And', () => {
    const sc = new ComputeEngine();
    sc.declare('M', 'boolean | missing');
    for (const op of ['And', 'Xor', 'Equivalent']) {
      const expr = sc.box([op, 'True', 'M']);
      expect(expr.isValid).toBe(true);
      expect(expr.type.toString()).toBe('boolean');
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
      'True',
    ],
    [
      '\\mathrm{True}\\veebar\\mathrm{Undefined}',
      ['Xor', 'True', 'Undefined'],
      'True',
    ],
    [
      '\\operatorname{Xor}(\\mathrm{True}, \\mathrm{Missing})',
      ['Xor', 'True', 'Missing'],
      'True',
    ],
    [
      '\\mathrm{True}\\iff\\mathrm{Missing}',
      ['Equivalent', 'True', 'Missing'],
      'False',
    ],
    [
      '\\mathrm{True}\\iff\\mathrm{Undefined}',
      ['Equivalent', 'True', 'Undefined'],
      'False',
    ],
    [
      '\\mathrm{True}\\Leftrightarrow\\mathrm{Missing}',
      ['Equivalent', 'True', 'Missing'],
      'False',
    ],
    [
      '\\mathrm{True}\\land\\mathrm{Missing}',
      ['And', 'True', 'Missing'],
      'False',
    ],
    [
      '\\mathrm{False}\\lor\\mathrm{Missing}',
      ['Or', 'False', 'Missing'],
      'False',
    ],
    ['\\lnot\\mathrm{Missing}', ['Not', 'Missing'], 'True'],
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
  // type is `boolean`: an absent operand reads as `False`, so the result is
  // never `Missing`.
  const sc = new ComputeEngine();
  sc.declare('M', 'boolean | missing');
  const table: [any, string, any][] = [
    [['And', 'True', 'Missing'], 'boolean', 'False'],
    [['And', 'Missing', 'True'], 'boolean', 'False'],
    [['And', 'False', 'Missing'], 'boolean', 'False'],
    [['And', 'Missing', 'False'], 'boolean', 'False'],
    [['And', 'False', 'Undefined'], 'boolean', 'False'],
    [['And', 'True', 'Undefined'], 'boolean', 'False'],
    [['And', 'True', 'M'], 'boolean', 'M'],
    [['And', 'A', 'Missing'], 'boolean', 'False'],
    [['Or', 'False', 'Missing'], 'boolean', 'False'],
    [['Or', 'True', 'Missing'], 'boolean', 'True'],
    [['Or', 'False', 'M'], 'boolean', 'M'],
    [['Not', 'Missing'], 'boolean', 'True'],
    [['Not', 'Undefined'], 'boolean', 'True'],
    [['Not', 'M'], 'boolean', ['Not', 'M']],
    [['Xor', 'False', 'Missing'], 'boolean', 'False'],
    [['Xor', 'A', 'Missing'], 'boolean', 'A'],
    [['Xor', 'True', 'M'], 'boolean', ['Not', 'M']],
    [['Equivalent', 'False', 'Missing'], 'boolean', 'True'],
    [['Equivalent', 'True', 'Undefined'], 'boolean', 'False'],
    [['Implies', 'True', 'Missing'], 'boolean', 'False'],
    [['Implies', 'Missing', 'False'], 'boolean', 'True'],
    [['Implies', 'False', 'Missing'], 'boolean', 'True'],
    [['Implies', 'Missing', 'True'], 'boolean', 'True'],
    [['Implies', 'Undefined', 'False'], 'boolean', 'True'],
    [['Nand', 'True', 'Missing'], 'boolean', 'True'],
    [['Nand', 'False', 'Missing'], 'boolean', 'True'],
    [['Nor', 'False', 'Missing'], 'boolean', 'True'],
    [['Nor', 'True', 'Missing'], 'boolean', 'False'],
    [['Nor', 'M', 'False'], 'boolean', ['Not', 'M']],
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

  test('a broadcast over a list reads the absent operand in each cell', () => {
    // `And([True, False], Missing)` is `[False, False]`.
    const expr = sc.box(['And', ['List', 'True', 'False'], 'Missing']);
    expect(expr.type.toString()).toBe('list<boolean^2>');
    expect(expr.evaluate().json).toEqual(['List', 'False', 'False']);
  });

  test('the negated comparisons, built from Not, are typed like Not', () => {
    // `NotLess(a, b)` is `Not(Less(a, b))`. A comparison with an absent
    // operand is `False`, so its negation is `True`.
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
        expect(expr.type.toString()).toBe('boolean');
        expect(expr.evaluate().json).toEqual('True');
      }
      const expr = sc.box([op, 'Undefined', 1]);
      expect(expr.type.toString()).toBe('boolean');
      expect(expr.evaluate().json).toEqual('True');
      expect(sc.box([op, 'x', 1]).type.toString()).toBe('boolean');
    }
  });

  test('the parse route gives the same types', () => {
    const table: [string, string][] = [
      ['\\mathrm{True}\\land\\mathrm{Missing}', 'boolean'],
      ['\\mathrm{False}\\land\\mathrm{Missing}', 'boolean'],
      ['\\mathrm{False}\\lor\\mathrm{Missing}', 'boolean'],
      ['\\lnot\\mathrm{Missing}', 'boolean'],
      ['\\lnot\\mathrm{Undefined}', 'boolean'],
      ['\\mathrm{True}\\veebar\\mathrm{Missing}', 'boolean'],
      ['\\mathrm{True}\\iff\\mathrm{Missing}', 'boolean'],
      ['\\mathrm{True}\\implies\\mathrm{Missing}', 'boolean'],
      ['\\mathrm{False}\\implies\\mathrm{Missing}', 'boolean'],
      ['\\mathrm{Missing}\\not<1', 'boolean'],
      ['\\mathrm{Undefined}\\not<1', 'boolean'],
    ];
    for (const [latex, type] of table)
      expect([latex, ce.parse(latex).type.toString()]).toEqual([latex, type]);
  });
});
