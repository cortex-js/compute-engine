/**
 * A lazy collection argument at a `list<…>` parameter is admitted when its
 * element type, without the `nan` arm, fits the parameter's element type
 * (user decision of 2026-09-27).
 *
 * The shape is Tycho's (item 323): `u(l)` up-samples a list with a
 * comprehension that reads `l[…]`, `s(l)` smooths it. An element read is
 * typed `nan | real` (a read outside the list is `NaN`), so `u(L)` evaluates
 * to a lazy `Comprehension` typed `indexed_collection<integer | nan>`.
 * Before, with `s` declared `(list<real>) -> unknown`, `s(u(L))` evaluated to
 * `Error(incompatible-type, "list<real>", "indexed_collection<integer |
 * nan>")`, while the compiled JavaScript code returned values.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// The helpers of `tycho-323-call-site-specialization.test.ts`.
const U = String.raw`l \mapsto \left[l\left[\operatorname{ceil}\left(\frac{i}{2}\right)-\frac{\left(\operatorname{floor}\left(\frac{i-1}{2\sqrt{\operatorname{Length}(l)}}\right)+\operatorname{mod}\left(\operatorname{floor}\left(\frac{i-1}{2\sqrt{\operatorname{Length}(l)}}\right),2\right)\right)\sqrt{\operatorname{Length}(l)}}{2}\right]\operatorname{for}i=\left[1...4\operatorname{Length}(l)\right]\right]`;
const S = String.raw`l \mapsto \left[\frac{l\left[i\right]+l\left[i+\left\{\operatorname{mod}\left(i-1,\sqrt{\operatorname{Length}(l)}\right)<\frac{\sqrt{\operatorname{Length}(l)}}{2}:1,-1\right\}\right]+l\left[i+\left\{\frac{i}{\sqrt{\operatorname{Length}(l)}}<\frac{\sqrt{\operatorname{Length}(l)}}{2}:1,-1\right\}\sqrt{\operatorname{Length}(l)}\right]+l\left[i+\left\{\operatorname{mod}\left(i-1,\sqrt{\operatorname{Length}(l)}\right)<\frac{\sqrt{\operatorname{Length}(l)}}{2}:1,-1\right\}+\left\{\frac{i}{\sqrt{\operatorname{Length}(l)}}<\frac{\sqrt{\operatorname{Length}(l)}}{2}:1,-1\right\}\sqrt{\operatorname{Length}(l)}\right]}{4}\operatorname{for}i=\left[1...\operatorname{Length}(l)\right]\right]`;

const L = Array.from({ length: 16 }, (_, k) => k + 1);

type CollectionView = { each(): Generator<{ N(): { re: number } }> };

function engine(element: 'real' | 'integer'): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('L', `list<${element}>`);
  ce.declare('u', `(list<${element}>) -> unknown` as never);
  ce.assign('u', ce.parse(U));
  ce.declare('s', `(list<${element}>) -> unknown` as never);
  ce.assign('s', ce.parse(S));
  return ce;
}

/** The elements of an evaluated collection, lazy or eager, as numbers. */
function numbers(value: unknown): number[] {
  return [...(value as CollectionView).each()].map((x) => x.N().re);
}

describe('LAZY COLLECTION AT A LIST PARAMETER', () => {
  let reference: number[];
  beforeAll(() => {
    const ce = engine('real');
    const result = compile(ce.parse('s(u(L))'), {
      to: 'javascript',
      fallback: false,
    });
    expect(result.success).toBe(true);
    reference = result.run!({ L }) as number[];
  });

  test('the compiled route gives 64 numbers', () => {
    expect(reference.length).toBe(64);
    expect(reference.every((x) => typeof x === 'number')).toBe(true);
  });

  test('the argument is a lazy collection with a nan arm', () => {
    const ce = engine('real');
    ce.assign('L', ce.box(['List', ...L]));
    const arg = ce.parse('u(L)').evaluate();
    expect(arg.isLazyCollection).toBe(true);
    expect(arg.type.toString()).toBe('list<integer | nan>');
  });

  test('parse route: s(u(L)) evaluates to the compiled values', () => {
    const ce = engine('real');
    ce.assign('L', ce.box(['List', ...L]));
    const value = ce.parse('s(u(L))').evaluate();
    expect(value.isValid).toBe(true);
    const out = numbers(value);
    expect(out.length).toBe(64);
    out.forEach((x, k) => expect(x).toBeCloseTo(reference[k], 12));
  });

  test('box route: s(u(L)) evaluates to the compiled values', () => {
    const ce = engine('real');
    ce.assign('L', ce.box(['List', ...L]));
    const value = ce.box(['s', ['u', 'L']]).evaluate();
    expect(value.isValid).toBe(true);
    const out = numbers(value);
    expect(out.length).toBe(64);
    out.forEach((x, k) => expect(x).toBeCloseTo(reference[k], 12));
  });

  test('a list<integer> parameter admits the same argument', () => {
    const ce = engine('integer');
    const compiled = compile(ce.parse('s(u(L))'), {
      to: 'javascript',
      fallback: false,
    });
    expect(compiled.success).toBe(true);
    const expected = compiled.run!({ L }) as number[];
    expect(expected).toEqual(reference);
    ce.assign('L', ce.box(['List', ...L]));
    const value = ce.parse('s(u(L))').evaluate();
    expect(value.isValid).toBe(true);
    const out = numbers(value);
    expect(out.length).toBe(64);
    out.forEach((x, k) => expect(x).toBeCloseTo(expected[k], 12));
  });

  test.each([
    ['s(["a"])', 'list<string^1>'],
    ['s([(1,2)])', 'list<tuple<integer, integer>^1>'],
  ])('%s is still refused', (latex, argType) => {
    const ce = engine('real');
    const value = ce.parse(latex).evaluate();
    expect(value.isValid).toBe(false);
    expect(value.toString()).toContain('incompatible-type');
    expect(value.toString()).toContain(argType);
  });

  test('an eager list with a NaN element is still refused', () => {
    // The `nan` arm is waived only for a LAZY collection, where it records
    // the possibility of an out-of-range read. An eager list holds the NaN.
    const ce = engine('real');
    const value = ce.box(['s', ['List', 1, 'NaN']]).evaluate();
    expect(value.isValid).toBe(false);
    expect(value.toString()).toContain('incompatible-type');
  });
});
