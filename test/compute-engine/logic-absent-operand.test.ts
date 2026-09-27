import { ComputeEngine } from '../../src/compute-engine';

// Every logic connective reads an absent operand (`Missing`, or `Undefined`,
// which is read the same way) by the same Kleene rule: an operand that
// decides the result wins, otherwise the result is the absence marker
// `Missing`. `Xor` and `Equivalent` have no deciding operand — flipping any
// one operand flips the result — so an absent operand always makes them
// absent. Before the user decision of 2026-09-27, `Xor` and `Equivalent`
// rejected a `Missing` operand with `incompatible-type` at canonicalization,
// and kept an `Undefined` operand symbolic (`Xor(True, Undefined)` evaluated
// to `Not(Undefined)`), while `And`, `Or` and `Not` answered `Missing`.
//
// `docs/ERROR-MODEL.md` §3 is the reference for the absence contract.
//
// Boolean contexts use UPPERCASE symbols: evaluating a symbol as a boolean
// operand retypes it `boolean` for the engine's lifetime.

const ce = new ComputeEngine();

const evalJson = (expr: any) => ce.box(expr).evaluate().json;

describe('LOGIC CONNECTIVES WITH AN ABSENT OPERAND — box route', () => {
  const table: [any, string][] = [
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
    [['Xor', 'A', 'Missing'], 'Missing'],
    [['Equivalent', 'True', 'Missing'], 'Missing'],
    [['Equivalent', 'False', 'Missing'], 'Missing'],
    [['Equivalent', 'True', 'Undefined'], 'Missing'],
    [['Equivalent', 'Missing', 'False'], 'Missing'],
    [['Equivalent', 'Missing', 'Missing'], 'Missing'],
    [['Equivalent', 'A', 'Missing'], 'Missing'],
  ];
  test.each(table)('%j evaluates to %s', (expr, expected) => {
    const boxed = ce.box(expr);
    expect(boxed.isValid).toBe(true);
    expect(boxed.evaluate().json).toEqual(expected);
    expect(boxed.N().json).toEqual(expected);
  });

  test('the boxed expression is typed boolean, as for And', () => {
    for (const op of ['And', 'Or', 'Xor', 'Equivalent']) {
      expect(ce.box([op, 'True', 'Missing']).type.toString()).toBe('boolean');
      expect(ce.box([op, 'True', 'Undefined']).type.toString()).toBe('boolean');
    }
    expect(ce.box(['Not', 'Missing']).type.toString()).toBe('boolean');
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
