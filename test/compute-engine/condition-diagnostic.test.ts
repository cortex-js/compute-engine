import { ComputeEngine } from '../../src/compute-engine';

//
// A PROVABLY NON-BOOLEAN CONDITION IS REFUSED AT BOXING (ruled 2026-09-02).
//
// The 2026-08-31 ruling made an undecidable `If`/`Which` condition inert
// instead of a host throw, and the throw had carried the only diagnostic for
// a condition that can never be a boolean (`Which(10, …)`). The diagnostic is
// back as an ordinary error OPERAND: a condition whose static type is
// disjoint from `boolean` becomes `Error(incompatible-type, boolean, …)` at
// boxing, exactly as a wrong-typed argument to `Sin` does, and the evaluate
// handlers propagate it as the condition's error. Everything that may still
// resolve stays inert: a symbol of unknown type, a relation with free
// variables, a `missing`-admitting type, a boolean collection (element-wise
// selection), a possibly-collection type.
//

describe('If/Which: a provably non-boolean condition is an error operand', () => {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('b', 'boolean');
  ce.declare('kb', 'boolean | missing');
  ce.declare('LB', 'list<boolean>');
  ce.declare('s', 'string');
  ce.declare('pt', 'tuple<integer, integer>');
  ce.declare('SB', 'set<boolean>');
  ce.declare('LN', 'list<number>');
  ce.declare('rg', 'range');
  ce.declare('bnum', 'broadcastable<number>');
  ce.declare('nOrLN', 'number | list<number>');
  ce.declare('LU', 'list<unknown>');
  ce.declare('Lbare', 'list');
  ce.declare('bbool', 'broadcastable<boolean>');
  ce.declare('bOrLN', 'boolean | list<number>');
  ce.declare('LBM', 'list<boolean | missing>');

  test.each([
    [['If', 10, 1, 2], '10'],
    [['If', { str: 'banana' }, 1, 2], 'string'],
    [['If', 'n', 1, 2], 'integer'],
    [['If', 's', 1, 2], 'string'],
    [['Which', 5, 1, ['Greater', 3, 0], 2], '5'],
    [['Which', { str: 'banana' }, 1, 'True', 2], 'string'],
    // Collections that can never select element-wise: a point binds whole,
    // a set is not indexed, and these cells are never condition values.
    [['If', 'pt', 1, 2], 'tuple'],
    [['If', ['Tuple', 'True', 'False'], 1, 2], 'tuple'],
    [['If', 'SB', 1, 2], 'set'],
    [['If', 'LN', 1, 2], 'list<number>'],
    [['If', 'rg', 1, 2], 'range'],
    [['If', 'bnum', 1, 2], 'broadcastable<number>'],
    [['If', 'nOrLN', 1, 2], 'list<number>'],
  ])('%j is refused', (expr, actual) => {
    const boxed = ce.box(expr as any);
    expect(boxed.errors).toHaveLength(1);
    const err = boxed.errors[0].toString();
    expect(err).toContain('incompatible-type');
    expect(err).toContain('boolean');
    expect(err).toContain(actual);
    // The condition is the one operand always demanded, so its error is the
    // value; never a host exception.
    expect(boxed.evaluate().operator).toBe('Error');
  });

  test.each([
    [['If', 'undeclaredCond', 1, 2]],
    [['If', ['Greater', 'x', 0], 1, 2]],
    [['If', 'b', 1, 2]],
    [['If', 'kb', 1, 2]],
    [['If', 'LB', 1, 2]],
    [['If', 'LBM', 1, 2]],
    [['If', 'LU', 1, 2]],
    [['If', 'Lbare', 1, 2]],
    [['If', 'bbool', 1, 2]],
    [['If', 'bOrLN', 1, 2]],
    [['Which', 'undeclaredCond', 1, 'True', 2]],
  ])('%j stays inert', (expr) => {
    const boxed = ce.box(expr as any);
    expect(boxed.errors).toHaveLength(0);
    const r = boxed.evaluate();
    expect(r.operator).toBe((expr as any)[0]);
  });

  test('a later bad condition is reported at boxing but never demanded', () => {
    // `Which` selects its first true clause and demands nothing past it
    // (`docs/ERROR-MODEL.md` §3), so the error operand in the third position
    // is in `errors` yet the value is the first arm.
    const boxed = ce.box(['Which', ['Greater', 3, 0], 1, 'n', 2]);
    expect(boxed.errors).toHaveLength(1);
    expect(boxed.errors[0].toString()).toContain('incompatible-type');
    expect(boxed.evaluate().toString()).toBe('1');
  });

  test('a decided condition still selects', () => {
    expect(ce.box(['If', 'True', 5, 7]).evaluate().toString()).toBe('5');
    expect(
      ce
        .box(['If', ['List', 'True', 'False'], 1, 2])
        .evaluate()
        .toString()
    ).toBe('[1,2]');
    expect(ce.box(['Which', 'False', 1, 'True', 2]).evaluate().toString()).toBe(
      '2'
    );
  });

  test('the parse route agrees with the box route', () => {
    const boxed = ce.parse('\\begin{cases} 1 & 10 \\\\ 2 \\end{cases}');
    expect(boxed.errors.length).toBe(1);
    expect(boxed.errors[0].toString()).toContain('incompatible-type');
  });
});

describe('cases: an empty condition cell is the default clause', () => {
  // A row written with a trailing `&` and nothing after it (`3x^2 & \\`)
  // used to parse to a `Nothing` condition — a dead row the boxing check
  // above would now refuse — while the same row without the `&` parsed to
  // the `True` default. Both spellings are the default clause.
  const ce = new ComputeEngine();
  test('trailing `&` with an empty cell', () => {
    const withAmp = ce.parse(
      '\\begin{cases} 0 & x \\le 0 \\\\ 3x^2 & \\end{cases}'
    );
    const without = ce.parse(
      '\\begin{cases} 0 & x \\le 0 \\\\ 3x^2 \\end{cases}'
    );
    expect(withAmp.errors).toHaveLength(0);
    expect(withAmp.json).toEqual(without.json);
    expect(withAmp.ops![2].symbol).toBe('True');
  });
  test('a piecewise-bodied user function evaluates its default row', () => {
    ce.parse(
      'f_0(x) := \\begin{cases} 0 & x \\le 0 \\\\ 1 & x \\ge 1 \\\\ 3x^2-2x^3 & \\end{cases}'
    ).evaluate();
    expect(ce.parse('f_0(1/2)').evaluate().toString()).toBe('1/2');
  });
});
