/**
 * Tycho item 323: a user function whose parameter is broader than its
 * argument (a bare `function` declaration, or `(list) -> unknown`) is typed
 * and compiled with the parameter bound to the ARGUMENT's type.
 *
 * The Tycho document `art/nxlddeh5zv` builds a height map as twelve nested
 * calls of three helpers: `u(l)` up-samples a list with `Length(l)` and
 * `l[…]` reads, `s(l)` smooths it, `d(l, a)` adds seeded noise. With the
 * helpers declared as a bare `function` (parameters `unknown`, the default
 * of Tycho's document manager), `d(s(u(L)), 1)` with `L: list<real>` typed
 * `list<unknown>`, and the JavaScript compile declined with "Could not
 * compile `Length`: operand is not an indexed collection"; declared
 * `(list) -> unknown` it declined with "scalar arithmetic over a
 * list-valued operand". Declared `(list<real>) -> unknown` it compiled.
 *
 * Three changes make the three declarations agree:
 * - the type of a call whose arguments the function binds whole is derived
 *   from the body with each parameter typed as its argument
 *   (`callResultType`), comprehensions included;
 * - the JavaScript target compiles such a call through a helper specialized
 *   to the argument's list type (`ensureSpecializedUserCallEmitted`);
 * - `Multiply` keeps the `nan` arm of a `nan | real` factor (the type of an
 *   element read `l[i]`), so `(1/4)·l[i]` is `nan | real`, not `number`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const U = String.raw`l \mapsto \left[l\left[\operatorname{ceil}\left(\frac{i}{2}\right)-\frac{\left(\operatorname{floor}\left(\frac{i-1}{2\sqrt{\operatorname{Length}(l)}}\right)+\operatorname{mod}\left(\operatorname{floor}\left(\frac{i-1}{2\sqrt{\operatorname{Length}(l)}}\right),2\right)\right)\sqrt{\operatorname{Length}(l)}}{2}\right]\operatorname{for}i=\left[1...4\operatorname{Length}(l)\right]\right]`;
const S = String.raw`l \mapsto \left[\frac{l\left[i\right]+l\left[i+\left\{\operatorname{mod}\left(i-1,\sqrt{\operatorname{Length}(l)}\right)<\frac{\sqrt{\operatorname{Length}(l)}}{2}:1,-1\right\}\right]+l\left[i+\left\{\frac{i}{\sqrt{\operatorname{Length}(l)}}<\frac{\sqrt{\operatorname{Length}(l)}}{2}:1,-1\right\}\sqrt{\operatorname{Length}(l)}\right]+l\left[i+\left\{\operatorname{mod}\left(i-1,\sqrt{\operatorname{Length}(l)}\right)<\frac{\sqrt{\operatorname{Length}(l)}}{2}:1,-1\right\}+\left\{\frac{i}{\sqrt{\operatorname{Length}(l)}}<\frac{\sqrt{\operatorname{Length}(l)}}{2}:1,-1\right\}\sqrt{\operatorname{Length}(l)}\right]}{4}\operatorname{for}i=\left[1...\operatorname{Length}(l)\right]\right]`;
const D = String.raw`(l,a) \mapsto a\,\mathrm{WithRandomSeed}(7+\operatorname{Length}(l), \mathrm{RandomChoice}(\lbrack0,1\rparen, \operatorname{Length}(l)))+l`;

type Variant = 'function' | 'list' | 'list<real>';
const SIGNATURES: Record<Variant, [string, string]> = {
  'function': ['function', 'function'],
  'list': ['(list) -> unknown', '(list, real) -> unknown'],
  'list<real>': ['(list<real>) -> unknown', '(list<real>, real) -> unknown'],
};

function engine(variant: Variant): ComputeEngine {
  const [one, two] = SIGNATURES[variant];
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  ce.declare('u', one as never);
  ce.assign('u', ce.parse(U));
  ce.declare('s', one as never);
  ce.assign('s', ce.parse(S));
  ce.declare('d', two as never);
  ce.assign('d', ce.parse(D));
  return ce;
}

/** `d(s(u(… d(s(u(L)), 1) …)), depth)`: three calls per level. */
function chain(depth: number): string {
  let latex = 'L';
  for (let k = 1; k <= depth; k++) latex = `d(s(u(${latex})), ${k})`;
  return latex;
}

const L = Array.from({ length: 16 }, (_, k) => k + 1);

type CollectionView = { each(): Generator<{ N(): { re: number } }> };

function compiled(variant: Variant, depth: number) {
  const ce = engine(variant);
  const expr = ce.parse(chain(depth));
  const result = compile(expr, { to: 'javascript', fallback: false });
  return { ce, expr, result };
}

describe('TYCHO ITEM 323: CALL-SITE SPECIALIZATION OF A WHOLE-LIST FUNCTION', () => {
  const reference = new Map<number, number[]>();
  beforeAll(() => {
    for (const depth of [1, 4]) {
      const { result } = compiled('list<real>', depth);
      expect(result.success).toBe(true);
      reference.set(depth, result.run!({ L }) as number[]);
    }
  });

  test('the (list<real>) declaration gives the reference lengths', () => {
    expect(reference.get(1)!.length).toBe(64);
    expect(reference.get(4)!.length).toBe(4096);
    expect(reference.get(4)!.every((x) => typeof x === 'number')).toBe(true);
  });

  for (const variant of ['function', 'list'] as const) {
    for (const depth of [1, 4]) {
      test(`declared ${variant}, depth ${depth}: typed from the argument`, () => {
        const { expr } = compiled(variant, depth);
        // Before: `list<unknown>`. The elements are the real numbers the
        // body computes, or NaN for an element read outside the list.
        expect(expr.type.toString()).toBe('list<nan | real>');
      });

      test(`declared ${variant}, depth ${depth}: compiles to the reference values`, () => {
        const { result } = compiled(variant, depth);
        expect(result.success).toBe(true);
        const out = result.run!({ L }) as number[];
        expect(out.length).toBe(depth === 1 ? 64 : 4096);
        expect(out).toEqual(reference.get(depth));
      });
    }
  }

  for (const variant of ['function', 'list'] as const) {
    test(`declared ${variant}: the interpreter agrees at depth 1`, () => {
      const ce = engine(variant);
      ce.assign('L', ce.box(['List', ...L]));
      const value = ce.parse(chain(1)).evaluate();
      expect(value.nops).toBe(64);
      const expected = reference.get(1)!;
      value.ops.forEach((x, k) =>
        expect(x.N().re).toBeCloseTo(expected[k], 12)
      );
    });
  }

  test('a bare `function` over a list compiles in the real lane', () => {
    // Before: `s(L)` compiled with `success: true` and returned
    // `{ re: NaN, im: NaN }` objects, because the generic helper read the
    // parameter `indexed_collection<number>` (inferred from the body) as
    // possibly complex.
    const ce = engine('function');
    const result = compile(ce.parse('s(L)'), {
      to: 'javascript',
      fallback: false,
    });
    expect(result.success).toBe(true);
    const out = result.run!({ L }) as number[];
    ce.assign('L', ce.box(['List', ...L]));
    // The interpreter's value is a lazy comprehension: read its elements.
    const value = ce.parse('s(L)').evaluate();
    const elements = [...(value as unknown as CollectionView).each()];
    expect(out.length).toBe(16);
    expect(elements.length).toBe(16);
    elements.forEach((x, k) => expect(out[k]).toBeCloseTo(x.N().re, 12));
  });

  test('a scalar-parameter function still maps over a list argument', () => {
    // The whole-binding typing applies only to a function with a
    // collection parameter. A function whose parameters are all scalar is
    // mapped over the list, and keeps the broadcast type it had before.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.declare('g', 'function');
    ce.assign('g', ce.parse('x \\mapsto 2x + 1'));
    expect(ce.parse('g(L)').type.toString()).toBe('list<number>');
  });
});

describe('MULTIPLY OVER A NAN | REAL FACTOR', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'nan | real');
  ce.declare('r', 'real');
  test.each([
    [['Multiply', 2, 'x'], 'nan | real'],
    [['Multiply', 'r', 'x'], 'nan | real'],
    [['Multiply', ['Rational', 1, 4], 'x'], 'nan | real'],
    [['Multiply', 'x', 'x'], 'nan | real'],
    // Unchanged: no factor has a `nan` arm.
    [['Multiply', 2, 'r'], 'real'],
  ])('%j types %s', (json, expected) => {
    expect(ce.box(json as never).type.toString()).toBe(expected);
  });
});

/**
 * A call with a scalar argument whose type is a union of scalars (`nan |
 * real`, the type Tycho declares for every slider value) is typed from the
 * body like a call with a `real` argument. Before, any union-typed argument
 * made the call keep its declared result (`list<unknown>` for the chain
 * below), because a union was treated as a value that may be a collection.
 * The product of a `nan | real` parameter and a list keeps the `nan` arm in
 * its cells.
 */
describe('SCALAR ARGUMENT WITH A NAN ARM', () => {
  test.each([
    // The helpers read elements with `l[i]`, typed `nan | real`, so the
    // chain has a `nan` arm whatever `a` is.
    ['real', 'list<nan | real>'],
    ['nan | real', 'list<nan | real>'],
    ['real | signed_infinity | nan', 'list<infinity | nan | real>'],
  ])('d(s(u(L)), a) with a: %s types %s', (declared, expected) => {
    const ce = engine('function');
    ce.declare('a', declared as never);
    expect(ce.parse('d(s(u(L)), a)').type.toString()).toBe(expected);
    // A literal argument is unchanged.
    expect(ce.parse('d(s(u(L)), 2)').type.toString()).toBe('list<nan | real>');
  });

  test('a body without a random draw', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.declare('a', 'nan | real');
    ce.declare('g', 'function');
    ce.assign('g', ce.parse('(l, b) \\mapsto l + b\\operatorname{Length}(l)'));
    expect(ce.parse('g(L, a)').type.toString()).toBe('list<nan | real>');
    expect(ce.parse('a L').type.toString()).toBe('list<nan | real>');
  });
});
