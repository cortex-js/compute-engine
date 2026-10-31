/**
 * CE-655. On `interval-js`, a `Loop` or a `Comprehension` over a `Range`
 * with a bound read at run time gave the empty range: the bounds compile to
 * intervals, and the old iterable computed its length and its elements with
 * plain `-`, `/` and `+` on those objects. `Loop(c ≔ c + k, k ∈ Range(1, n))`
 * at `n = 3` gave 0; the interpreter gives 6. Now such a range iterates
 * `_IA.range`, whose elements are point intervals (`compileRangeIterable` in
 * `base-compiler.ts`). When a bound is a wide interval, the number of
 * elements is not known, and `run()` answers `entire`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** `c ≔ 0; Loop(c ≔ c + body, …clauses); c` */
function sumLoop(body: unknown, ...clauses: unknown[]) {
  return [
    'Block',
    ['Assign', 'c', 0],
    ['Loop', ['Assign', 'c', ['Add', 'c', body]], ...clauses],
    'c',
  ];
}

function compiled(json: unknown) {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('L', 'list<integer>');
  const result = compile(ce.box(json as any), { to: 'interval-js' });
  expect(result.success).toBe(true);
  return result;
}

/** The value of the interpreter with the given inputs assigned. */
function interpret(json: unknown, inputs: { n?: number; L?: number[] }) {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('L', 'list<integer>');
  if (inputs.n !== undefined) ce.assign('n', inputs.n);
  if (inputs.L !== undefined) ce.assign('L', ce.box(['List', ...inputs.L]));
  const value = ce.box(json as any).evaluate();
  return value.isCollection ? [...value.each()].map((x) => x.json) : value.json;
}

const point = (v: number) => ({ kind: 'interval', value: { lo: v, hi: v } });

describe('CE-655: interval-js loop over a Range with an input bound', () => {
  test.each([
    ['Range(1, n)', ['Range', 1, 'n'], 3, 6],
    ['Range(1, n, 2)', ['Range', 1, 'n', 2], 5, 9],
    ['Range(n, 1) counts down', ['Range', 'n', 1], 3, 6],
    ['Range(1, n) with n < 1 is empty', ['Range', 1, 'n'], 0, 1],
  ])('Loop over %s', (_, range, n, expected) => {
    const json = sumLoop('k', ['Element', 'k', range]);
    expect(interpret(json, { n })).toBe(expected);
    expect(compiled(json).run!({ n })).toEqual(point(expected));
  });

  test('a nested range bounded by the outer loop variable', () => {
    const json = sumLoop(
      'j',
      ['Element', 'k', 'L'],
      ['Element', 'j', ['Range', 1, 'k']]
    );
    expect(interpret(json, { L: [1, 2, 3] })).toBe(10);
    expect(compiled(json).run!({ L: [1, 2, 3] })).toEqual(point(10));
  });

  test('Comprehension over Range(1, n)', () => {
    const json = [
      'Comprehension',
      ['Multiply', 2, 'k'],
      ['Element', 'k', ['Range', 1, 'n']],
    ];
    expect(interpret(json, { n: 3 })).toEqual([2, 4, 6]);
    expect(compiled(json).run!({ n: 3 })).toEqual([2, 4, 6].map(point));
  });

  test('a name bound over a literal range and again over Range(1, n)', () => {
    const json = [
      'Comprehension',
      ['Add', 'k', 1],
      ['Element', 'k', ['Range', 1, 2]],
      ['Element', 'k', ['Range', 1, 'n']],
    ];
    const expected = interpret(json, { n: 2 }) as number[];
    expect(expected).toHaveLength(4);
    expect(compiled(json).run!({ n: 2 })).toEqual(expected.map(point));
  });

  test('a wide bound gives entire: the number of passes is not known', () => {
    const json = sumLoop('k', ['Element', 'k', ['Range', 1, 'n']]);
    expect(compiled(json).run!({ n: { lo: 2, hi: 4 } })).toEqual({
      kind: 'entire',
    });
  });

  test('a range with literal bounds still wraps its plain-number elements', () => {
    const json = sumLoop('k', ['Element', 'k', ['Range', 1, 3]]);
    expect(compiled(json).run!({})).toEqual(point(6));
  });
});
