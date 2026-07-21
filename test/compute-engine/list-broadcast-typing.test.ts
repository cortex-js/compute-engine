import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';

/**
 * Honest result typing for list-broadcast numeric operators.
 * See docs/plans/2026-07-07-honest-list-broadcast-typing.md.
 *
 * A broadcastable numeric operator applied to a finite indexed collection
 * produces a **List value**, so its declared `.type` must be a list/vector
 * type — not the scalar per-element type. Two paths produce that list:
 *
 * - `Add`/`Multiply` over a **tensor** operand are typed by their own handlers
 *   (they see the tensor directly, and the value goes through
 *   addTensors/mulTensors). Their declared type is the exact `vector<n>` and
 *   equals the evaluated type.
 * - Every other broadcastable operator over a collection (trig, log, special
 *   functions, `Negate`, logic, …) is lifted centrally in `boxed-function.ts`
 *   `type()` to an (unbounded) `list<R>`. The value path materializes a plain
 *   `List`, whose own type handler is also `list<…>` (it drops the fixed
 *   length), so `list<R>` is the consistent, sound upper bound of the
 *   evaluated type.
 */

const ce = new ComputeEngine();

/** Declared type is a collection (list/vector), never a bare scalar. */
function expectIsList(expr: BoxedExpression): void {
  expect(expr.type.matches('list<any>')).toBe(true);
  expect(expr.type.matches('number')).toBe(false);
  expect(expr.type.matches('boolean')).toBe(false);
}

/**
 * The declared `.type` is an honest description of the value: it is a list, and
 * the evaluated type is a subtype of (or equal to) the declared type — i.e.
 * they never disagree.
 */
function expectHonestBroadcast(expr: BoxedExpression): void {
  expectIsList(expr);
  const evaluated = expr.evaluate().type;
  expect(evaluated.matches(expr.type.type)).toBe(true);
}

describe('LIST-BROADCAST TYPING — tensor Add/Multiply (exact vector<n>)', () => {
  // These operands box to BoxedTensors; the broadcast wrapper is skip-listed
  // for tensor Add/Multiply, so the honest list type comes from the operator's
  // own type handler and equals the evaluated type exactly.
  test.each([
    ['[1,2]·2 (parsed)', '[1,2]\\cdot 2', 'vector<2>'],
    ['2·[1,2] (parsed)', '2\\cdot [1,2]', 'vector<2>'],
  ])('%s → %s', (_label, latex, expected) => {
    const expr = ce.parse(latex);
    expect(expr.type.toString()).toBe(expected);
    expect(expr.type.toString()).toBe(expr.evaluate().type.toString());
  });

  test.each([
    ['Multiply(List, x)', ['Multiply', ['List', 0, 0, 1, 1], 'x'], 'vector<4>'],
    ['Multiply(2, List)', ['Multiply', 2, ['List', 1, 2]], 'vector<2>'],
    ['Add(List, x)', ['Add', ['List', 1, 2], 'x'], 'vector<2>'],
    ['Add(List, List)', ['Add', ['List', 1, 2], ['List', 3, 4]], 'vector<2>'],
  ])('%s → %s', (_label, mathjson, expected) => {
    const expr = ce.box(mathjson as any);
    expect(expr.type.toString()).toBe(expected);
    // Declared type equals the evaluated type.
    expect(expr.type.toString()).toBe(expr.evaluate().type.toString());
  });

  test('the old `number | vector<2>` union artifact is gone', () => {
    const expr = ce.box(['Add', ['List', 1, 2], 'x']);
    expect(expr.type.toString()).not.toContain('|');
    expect(expr.type.toString()).toBe('vector<2>');
  });

  // Tycho item 67: the bare-list path was already precise, but wrapping the
  // list in a `Multiply`/`Divide` moved it off the single-tensor branch of
  // `addType` and onto a `widen(…)` that unioned the scalar sibling back in.
  // Nothing here is unbound and no symbol is involved in the last two rows —
  // the scalar arm was unreachable, and it broke consumers routing on
  // `type.matches('collection')` (union matching is all-members).
  test.each([
    ['2·[1,2,3] + a', ['Add', ['Multiply', 2, ['List', 1, 2, 3]], 'a']],
    ['1/10·[1,2,3] + 1', ['Add', ['Divide', ['List', 1, 2, 3], 10], 1]],
    ['[1,2,3]/10 + a', ['Add', ['Divide', ['List', 1, 2, 3], 10], 'a']],
  ])('%s → vector<3>, no scalar arm', (_label, mathjson) => {
    const expr = ce.box(mathjson as any);
    expect(expr.type.toString()).toBe('vector<3>');
    expect(expr.type.matches('collection')).toBe(true);
  });
});

describe('LIST-BROADCAST TYPING — wrapper-lifted families (sound list<R>)', () => {
  // For each: `.type` is a list (not a scalar), and the evaluated type is a
  // subtype of (or equal to) the declared type.
  test.each([
    ['Sin', ['Sin', ['List', 0, 1]], 'list<finite_number>'],
    ['Cos', ['Cos', ['List', 0, 1]], 'list<finite_number>'],
    ['Tan', ['Tan', ['List', 0, 1]], 'list<number>'],
    ['Exp', ['Exp', ['List', 0, 1]], 'list<finite_number>'],
    ['Ln', ['Ln', ['List', 1, 2]], 'list<finite_number>'],
    ['Sqrt', ['Sqrt', ['List', 4, 9]], 'list<finite_number>'],
    ['Gamma (special fn)', ['Gamma', ['List', 1, 2]], 'list<finite_number>'],
    ['Abs', ['Abs', ['List', -1, 2]], 'list<real>'],
    ['Negate', ['Negate', ['List', 'a', 'b']], 'list<number>'],
    ['Real (complex)', ['Real', ['List', 2, 3]], 'list<finite_real>'],
    ['Conjugate (complex)', ['Conjugate', ['List', 2, 3]], 'list<number>'],
    ['Round', ['Round', ['List', 1.2, 2.7]], 'list<finite_integer>'],
  ])('%s → %s', (_label, mathjson, expected) => {
    const expr = ce.box(mathjson as any);
    expect(expr.type.toString()).toBe(expected);
    expectHonestBroadcast(expr);
  });

  test('Round(List) evaluated type is a shaped subtype of the declared type', () => {
    // Since honest List typing (tensor-unification Phase A), an evaluated
    // literal list gains its shape: declared stays the sound unbounded
    // `list<finite_integer>`, the evaluated value types
    // `list<finite_integer^2>` — a strict subtype (the broadcast contract
    // `evaluated ⊆ declared` still holds, and is what this test guards).
    const expr = ce.box(['Round', ['List', 1.2, 2.7]]);
    const evaluated = expr.evaluate();
    expect(expr.type.toString()).toBe('list<finite_integer>');
    expect(evaluated.type.toString()).toBe('vector<finite_integer^2>');
    expect(evaluated.type.matches(expr.type.type)).toBe(true);
  });

  test('symbolic broadcast: Sin(List(t,1)) is a list, not a scalar', () => {
    const expr = ce.box(['Sin', ['List', 't', 1]]);
    expectIsList(expr);
  });
});

describe('LIST-BROADCAST TYPING — logic broadcast (list<boolean>)', () => {
  // Relational operators (Less/Greater/…) are NOT broadcastable yet — the
  // `list<boolean>` assertion for those belongs to the follow-on
  // desmos-list-filtering plan. Here we assert the wrapper handles a
  // broadcastable boolean-returning operator (And/Or/Not) correctly, which is
  // the type that plan will consume.
  test.each([
    ['Not(List)', ['Not', ['List', 'True', 'False']]],
    ['And(List, True)', ['And', ['List', 'True', 'False'], 'True']],
    ['Or(List, False)', ['Or', ['List', 'True', 'False'], 'False']],
  ])('%s → list<boolean>', (_label, mathjson) => {
    const expr = ce.box(mathjson as any);
    expect(expr.type.toString()).toBe('list<boolean>');
    // Evaluated literal lists gain their shape (tensor-unification Phase A):
    // `list<boolean^2>` ⊆ the declared `list<boolean>` — the broadcast
    // contract `evaluated ⊆ declared` is what this asserts.
    const evaluated = expr.evaluate();
    expect(evaluated.type.toString()).toBe('list<boolean^2>');
    expect(evaluated.type.matches(expr.type.type)).toBe(true);
  });
});

describe('LIST-BROADCAST TYPING — exactness / N stability', () => {
  test('declared list type is stable under .N()', () => {
    const sin = ce.box(['Sin', ['List', 0, 1]]);
    expect(sin.N().type.matches('list<any>')).toBe(true);

    const mul = ce.box(['Multiply', ['List', 1, 2], 2]);
    expect(mul.type.toString()).toBe('vector<2>');
    expect(mul.N().type.toString()).toBe('vector<2>');
  });

  test('the type path does not evaluate (value is unchanged)', () => {
    const expr = ce.box(['Sin', ['List', 0, 1]]);
    // Touching `.type` must not mutate the (unevaluated) expression.
    void expr.type;
    expect(expr.operator).toBe('Sin');
    expect(expr.op1.operator).toBe('List');
  });
});

describe('LIST-BROADCAST TYPING — non-interference with scalars', () => {
  test.each([
    ['Sin(x)', ['Sin', 'x'], 'finite_number'],
    ['Add(2, x)', ['Add', 2, 'x'], 'number'],
    ['Multiply(2, x)', ['Multiply', 2, 'x'], 'finite_number'],
  ])('%s stays scalar %s', (_label, mathjson, expected) => {
    const expr = ce.box(mathjson as any);
    expect(expr.type.toString()).toBe(expected);
    expect(expr.type.matches('list<any>')).toBe(false);
  });

  test('numeric tuple (point) is not turned into a list', () => {
    // `2·(3,4)` scales the point component-wise; it stays a tuple.
    const expr = ce.box(['Multiply', 2, ['Tuple', 3, 4]]);
    expect(expr.type.matches('list<any>')).toBe(false);
    expect(expr.type.toString()).toContain('tuple');
  });
});

describe('`isValid` is DEEP through a tensor (Tycho item 67)', () => {
  // `BoxedTensor.isValid` used to return `true` unconditionally, so a list
  // whose every element was an `Error` still reported `isValid: true` — and
  // consumers use `isValid` as an admission gate before compiling/plotting.
  test('a broadcast that errors per element is invalid', () => {
    const v = ce.box(['Add', ['Tuple', 1, 2], ['List', 3, 4]]).evaluate();
    expect(v.op1.isValid).toBe(false);
    expect(v.isValid).toBe(false);
  });

  test('a directly embedded Error poisons the list', () => {
    expect(ce.box(['List', ['Error', "'oops'"], 2]).isValid).toBe(false);
  });

  test('well-formed tensors of every dtype stay valid', () => {
    // The numeric/bool fields cannot hold an `Error` by construction and keep
    // the O(1) answer; only `expression`-dtype tensors are scanned.
    expect(ce.box(['List', 1, 2, 3]).isValid).toBe(true);
    expect(ce.box(['List', ['List', 1, 2], ['List', 3, 4]]).isValid).toBe(true);
    expect(ce.box(['List', true, false]).isValid).toBe(true);
    expect(ce.box(['List', 'x', 'y']).isValid).toBe(true);
  });
});
