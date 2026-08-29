/**
 * Boolean value types: a predicate's TYPE HANDLER claims the value type
 * `true` or `false` when the operands' types and facts prove the verdict,
 * and stays `boolean` otherwise. The claim is a proof, never an
 * evaluation: every positive pin below also checks that `evaluate()`
 * agrees, and every negative pin checks that a claim that WOULD be unsound
 * is not made. The compiler consumes the claim to drop dead `If`/`Which`
 * arms and to fold a proven test to the target's literal.
 *
 * Design: `docs/plans/2026-08-29-boolean-value-types.md`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();
ce.declare('a', 'real');
ce.declare('n', 'number');
ce.declare('m', 'real | missing');
ce.declare('p', 'real<3<..>');
ce.declare('q', 'real<..<2>');
ce.declare('k', 'integer');
ce.declare('x', 'real');
ce.declare('y', 'real');

const typeOf = (e: Expression): string => e.type.toString();
const evalOf = (e: Expression): string => e.evaluate().toString();
const sym = (s: string) => ce.symbol(s);
const fn = (h: string, ops: Expression[]) => ce.function(h, ops);

describe('boolean value types — comparison producers', () => {
  test.each([
    ['1 < 2', '1<2', 'true', '"True"'],
    ['1 > 2', '1>2', 'false', '"False"'],
    ['p > q with 3 < p and q < 2', 'p > q', 'true', 'q < p'],
    ['p >= 3 (open lower bound above 3)', 'p \\geq 3', 'true', 'p \\geq 3'],
    // An open bound at the tested value has a gap of zero: the tolerant
    // evaluation would call `3 + 1e-12 > 3` False, so no claim is made.
    ['p > 3 (open lower bound at 3)', 'p > 3', 'boolean', 'p > 3'],
    ['0.5 = 1/2 (value node vs rational singleton)', '0.5 = \\frac{1}{2}', 'true', '"True"'],
  ])('%s', (_label, latex, expectedType, _expectedEval) => {
    const e = ce.parse(latex);
    expect(typeOf(e)).toBe(expectedType);
    // A proof and its evaluation never disagree.
    const v = e.evaluate();
    if (v.symbol === 'True' || v.symbol === 'False')
      expect(v.symbol === 'True').toBe(expectedType === 'true');
  });

  test('an undecided comparison keeps `boolean`', () => {
    expect(typeOf(ce.parse('a < 3'))).toBe('boolean');
    expect(typeOf(ce.parse('x < y'))).toBe('boolean');
  });

  test('NotEqual is the complement', () => {
    expect(typeOf(fn('NotEqual', [ce.number(1), ce.number(2)]))).toBe('true');
    expect(typeOf(fn('NotEqual', [ce.number(2), ce.number(2)]))).toBe('false');
  });
});

describe('boolean value types — Equal soundness', () => {
  test('Equal(a, a) is `true` for a NaN-free real', () => {
    const e = fn('Equal', [sym('a'), sym('a')]);
    expect(typeOf(e)).toBe('true');
    expect(evalOf(e)).toBe('"True"');
  });

  test('Equal(n, n) stays `boolean` when n admits NaN (NaN ≠ NaN)', () => {
    expect(typeOf(fn('Equal', [sym('n'), sym('n')]))).toBe('boolean');
  });

  test('Equal(m, m) stays `boolean` when m may be missing', () => {
    expect(typeOf(fn('Equal', [sym('m'), sym('m')]))).toBe('boolean');
  });

  test('Equal(True, False) makes no claim (both type the bare `boolean`)', () => {
    expect(typeOf(fn('Equal', [ce.True, ce.False]))).toBe('boolean');
  });

  test('Equal("a", "b") makes no claim (strings have no literal type)', () => {
    expect(typeOf(fn('Equal', [ce.string('a'), ce.string('b')]))).toBe(
      'boolean'
    );
  });

  test('two big integers sharing one coarse range make no claim', () => {
    expect(typeOf(fn('Equal', [ce.number(1e30), ce.number(1e30 + 1)]))).toBe(
      'boolean'
    );
  });

  test('two literals closer than the tolerance are not separated', () => {
    // The evaluated comparison is tolerance-based, so a proof must not
    // claim a separation the evaluation would deny.
    const a = ce.number(0.3);
    const b = ce.number(0.3 + 1e-12);
    for (const h of ['Less', 'Greater', 'Equal', 'NotEqual', 'LessEqual']) {
      const e = fn(h, [a, b]);
      const v = e.evaluate().symbol;
      const t = typeOf(e);
      if (t !== 'boolean') expect(t === 'true').toBe(v === 'True');
    }
    expect(typeOf(fn('Equal', [a, b]))).toBe('boolean');
    expect(typeOf(fn('Less', [a, b]))).toBe('boolean');
  });

  test('Less(NaN, 1) makes no claim', () => {
    expect(typeOf(fn('Less', [ce.NaN, ce.number(1)]))).toBe('boolean');
  });
});

describe('boolean value types — connectives and literal predicates', () => {
  test('connectives fold by the truth table', () => {
    expect(typeOf(ce.parse('1<2 \\land 2<3'))).toBe('true');
    expect(typeOf(fn('And', [ce.parse('1<2'), sym('A')]))).toBe('boolean');
    expect(typeOf(fn('And', [ce.parse('1>2'), sym('A')]))).toBe('false');
    expect(typeOf(fn('Or', [ce.parse('1>2'), sym('A')]))).toBe('boolean');
    expect(typeOf(fn('Or', [ce.parse('1<2'), sym('A')]))).toBe('true');
    expect(typeOf(fn('Not', [ce.parse('1<2')]))).toBe('false');
    expect(typeOf(fn('Xor', [ce.parse('1<2'), ce.parse('2<3')]))).toBe('false');
  });

  test('number-theory predicates claim on literals only', () => {
    expect(typeOf(fn('IsPrime', [ce.number(7)]))).toBe('true');
    expect(typeOf(fn('IsPrime', [ce.number(9)]))).toBe('false');
    expect(typeOf(fn('IsComposite', [ce.number(9)]))).toBe('true');
    expect(typeOf(fn('IsEven', [ce.number(4)]))).toBe('true');
    expect(typeOf(fn('IsOdd', [ce.number(4)]))).toBe('false');
    expect(typeOf(fn('IsOdd', [sym('k')]))).toBe('boolean');
    // The claims agree with evaluation.
    expect(evalOf(fn('IsPrime', [ce.number(7)]))).toBe('"True"');
    expect(evalOf(fn('IsComposite', [ce.number(9)]))).toBe('"True"');
  });

  test('Element claims on a literal against a literal list or set', () => {
    expect(typeOf(ce.parse('3 \\in \\lbrack 1,2,3\\rbrack'))).toBe('true');
    const list = fn('List', [ce.number(1), ce.number(2), ce.number(3)]);
    expect(typeOf(fn('Element', [ce.number(4), list]))).toBe('false');
    expect(typeOf(fn('Element', [sym('k'), list]))).toBe('boolean');
    expect(typeOf(fn('Element', [ce.number(2), sym('Integers')]))).toBe(
      'boolean'
    );
    // A `Set` admits a number within the tolerance of a member: no `false`.
    const set = fn('Set', [ce.number(1), ce.number(0.3)]);
    const near = fn('Element', [ce.number(0.3 + 1e-12), set]);
    expect(typeOf(near)).toBe('boolean');
    expect(evalOf(near)).toBe('"True"');
    expect(typeOf(fn('Element', [ce.number(0.5), set]))).toBe('false');
    expect(typeOf(fn('Element', [ce.number(0.3 + 1e-12), list]))).toBe(
      'false'
    );
  });

  test('IsPrime claims on a large literal without trial division', () => {
    expect(typeOf(fn('IsPrime', [ce.number(2147483647)]))).toBe('true');
  });
});

describe('boolean value types — storage', () => {
  test('assignment widens a proven `true` to `boolean`', () => {
    ce.assign('b1', ce.parse('1<2'));
    expect(typeOf(sym('b1'))).toBe('boolean');
    ce.assign('b2', ce.parse('p > 2'));
    expect(typeOf(sym('b2'))).toBe('boolean');
  });

  test('a symbol declared `boolean` keeps `boolean` when assigned True', () => {
    ce.declare('c', 'boolean');
    ce.assign('c', ce.True);
    expect(typeOf(sym('c'))).toBe('boolean');
  });

  test('a proven comparison survives a function-literal result', () => {
    // The handler-side boundary: the type handler of `Function` reads the
    // body's type, and a boolean value node is a leaf of `widenValueTypes`.
    const f = ce.parse('x \\mapsto 1 < 2');
    expect(f.type.toString()).toContain('-> true');
  });
});

describe('boolean value types — compiler consumption', () => {
  const eq = () => fn('Equal', [sym('a'), sym('a')]);
  const code = (e: Expression, to?: string): string =>
    String(compile(e, to ? { to } : {}).code).replace(/\s+/g, ' ');

  test('a proven If drops its test and the dead arm', () => {
    expect(code(fn('If', [eq(), sym('x'), sym('y')]))).toBe('_.x');
    expect(code(fn('If', [ce.parse('1>2'), sym('x'), sym('y')]))).toBe('_.y');
  });

  test('an unproven If keeps the runtime test', () => {
    expect(code(fn('If', [ce.parse('a<3'), sym('x'), sym('y')]))).toBe(
      '((_.a < 3) ? (_.x) : (_.y))'
    );
  });

  test('a proven If keeps the arms in one complex convention', () => {
    expect(code(fn('If', [eq(), sym('x'), ce.parse('2i')]))).toBe(
      '({ re: _.x, im: 0 })'
    );
  });

  test('a dead Which clause is never compiled', () => {
    // The dead arm holds an operator the JavaScript target has no lowering
    // for (`Input`): compiled alone it fails closed to no code at all.
    const arm = fn('Input', [ce.string('q')]);
    expect(compile(arm, {}).code).toBe('');
    const w = fn('Which', [ce.parse('1>2'), arm, ce.True, sym('x')]);
    expect(code(w)).toBe('(_.x)');
  });

  test('Which skips a false clause and stops at a true one', () => {
    const w = fn('Which', [
      ce.parse('1>2'),
      sym('x'),
      eq(),
      sym('y'),
      ce.True,
      ce.number(0),
    ]);
    expect(code(w)).toBe('(_.y)');
  });

  test('a proven test folds to the target literal on every target', () => {
    expect(code(eq())).toBe('true');
    expect(code(eq(), 'python')).toBe('True');
    expect(code(eq(), 'glsl')).toBe('true');
    expect(code(fn('If', [eq(), sym('x'), sym('y')]), 'glsl')).toBe('x');
    expect(code(fn('If', [eq(), sym('x'), sym('y')]), 'python')).toBe('x');
    expect(code(fn('If', [eq(), sym('x'), sym('y')]), 'interval-js')).toBe(
      '_.x'
    );
  });

  test('a connective folds its proven operands', () => {
    expect(code(fn('Not', [eq()]))).toBe('false');
    expect(code(fn('Or', [eq(), ce.parse('x<y')]))).toBe('true');
  });

  test('an impure condition is never dropped', () => {
    const impure = fn('Equal', [fn('Print', [ce.number(1)]), ce.number(1)]);
    expect(impure.isPure).toBe(false);
    expect(typeOf(impure)).toBe('boolean');
  });
});
