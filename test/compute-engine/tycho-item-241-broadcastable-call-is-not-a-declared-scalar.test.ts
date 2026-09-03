/**
 * A broadcastable operator applied to an operand of unproven shape is not a
 * PROVEN scalar, so a sum with a tuple stays symbolic instead of erroring.
 *
 * `Add` rejects `scalar + tuple` at canonicalization when the scalar is
 * PROVEN — a literal, a declared number, or a call whose operator declares a
 * numeric result. `Negate` declares `-> number`, but maps over a tuple
 * component-wise, so `Negate(q)` with `q` an untyped function-literal
 * parameter is proven nothing: `["Function", ["Add", ["Negate", "q"],
 * ["Tuple", 1, 2]], "q"]` boxed `incompatible-type` while the reordered
 * `q + (1, 2)` bound (Tycho item 241). A Desmos definition
 * `P_1(M_0, a, r_0) = l(r((1,2), a) - M_0) - r_0` never bound as a lambda.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('a function literal subtracting its parameter from a tuple', () => {
  test.each([
    ['q + (1,2)', ['Function', ['Add', 'q', ['Tuple', 1, 2]], 'q']],
    ['-q + (1,2)', ['Function', ['Add', ['Negate', 'q'], ['Tuple', 1, 2]], 'q']],
    ['(1,2) - q', ['Function', ['Subtract', ['Tuple', 1, 2], 'q'], 'q']],
    ['2q + (1,2)', ['Function', ['Add', ['Multiply', 2, 'q'], ['Tuple', 1, 2]], 'q']],
  ])('%s binds', (_label, json) => {
    const literal = ce.box(json as any);
    expect(literal.isValid).toBe(true);
    expect(String(literal.type)).toBe('(unknown) -> number | tuple<integer, integer>');
  });

  test('applies to a tuple component-wise', () => {
    const f = ce.box(['Function', ['Subtract', ['Tuple', 1, 2], 'q'], 'q']);
    expect(String(ce.function('Apply', [f, ce.box(['Tuple', 3, 4])]).evaluate())).toBe(
      '(-2, -2)'
    );
  });

  test('the Desmos shape: a composition of point-valued definitions', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('l', 'function');
    ce2.declare('r', 'function');
    ce2.declare('P_1', 'function');
    ce2.parse('l(V):=\\sqrt{V.x^{2}+V.y^{2}}').evaluate();
    ce2
      .parse('r(V,a):=V.x\\cdot(\\cos(a),\\sin(a))+V.y\\cdot(-\\sin(a),\\cos(a))')
      .evaluate();
    ce2.parse('P_{1}(M_{0},a,r_{0}):=l(r((1,2),a)-M_{0})-r_{0}').evaluate();
    expect(String(ce2.parse('P_{1}((1,2),0,0)').evaluate())).toBe('0');
    expect(String(ce2.parse('P_{1}((0,0),0,1)').evaluate())).toBe('-1 + sqrt(5)');
  });
});

describe('a proven scalar still rejects', () => {
  test('a literal, a declared number, and a non-broadcastable call', () => {
    ce.declare('n', 'number');
    for (const scalar of [5, 'n', ['Length', ['List', 1, 2]]]) {
      const e = ce.box(['Add', ['Negate', scalar], ['Tuple', 1, 2]] as any);
      expect(e.isValid).toBe(false);
    }
  });
});
