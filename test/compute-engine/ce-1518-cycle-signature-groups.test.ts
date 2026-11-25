import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { signatureWorkCounts } from '../../src/compute-engine/boxed-expression/declared-parameter-result';
import { MAX_GROUP_ROUNDS } from '../../src/compute-engine/boxed-expression/signature-group';

//
// CE-1518. The functions of a cycle of calls, each declared with a
// signature whose result is derived (`function` or `(unknown) -> unknown`),
// have their signatures derived together, by one fixpoint iteration
// (`signature-group.ts`). Before, reading the type of `b_2(m)` first ran
// about 18,000 derivations and took 13 s, and the types of the heads
// depended on which one was read first.
//

const call = (name: string): MathJsonExpression => [name, ['Subtract', 'n', 1]];

/** The work of `thunk`, as the counts of `signatureWorkCounts`. */
function work<T>(thunk: () => T): {
  value: T;
  counts: typeof signatureWorkCounts;
} {
  const before = { ...signatureWorkCounts };
  const value = thunk();
  const counts = Object.fromEntries(
    Object.entries(signatureWorkCounts).map(([k, v]) => [
      k,
      v - before[k as keyof typeof signatureWorkCounts],
    ])
  ) as typeof signatureWorkCounts;
  return { value, counts };
}

/** CE-1515's cycle: `a_2` calls `c_2` and `b_2`, `b_2` calls `c_2`, `c_2`
 * calls `a_2`, each with an integer base case (or `[1]` with `list`), and
 * `d_2` calls the cycle. */
function cycle(declaration: string, list = false): ComputeEngine {
  const ce = new ComputeEngine();
  const heads = ['a_2', 'b_2', 'c_2'] as const;
  for (const name of [...heads, 'd_2']) ce.declare(name, declaration);
  const steps: Record<(typeof heads)[number], MathJsonExpression> = list
    ? {
        a_2: ['Join', call('c_2'), call('b_2')],
        b_2: ['Join', ['List', 2], call('c_2')],
        c_2: ['Join', ['List', 3], call('a_2')],
      }
    : {
        a_2: ['Add', call('c_2'), call('b_2')],
        b_2: ['Add', call('c_2'), ['Square', 'n']],
        c_2: call('a_2'),
      };
  for (const name of heads)
    ce.assign(name, [
      'Function',
      ['If', ['LessEqual', 'n', 0], list ? ['List', 1] : 1, steps[name]],
      'n',
    ]);
  ce.assign(
    'd_2',
    list
      ? ['Function', ['Join', ['a_2', 'n'], ['List', 4]], 'n']
      : ['Function', ['Add', ['a_2', 3], ['Square', 'x']], 'x']
  );
  return ce;
}

const ORDERS = [
  ['a_2', 'b_2', 'c_2'],
  ['a_2', 'c_2', 'b_2'],
  ['b_2', 'a_2', 'c_2'],
  ['b_2', 'c_2', 'a_2'],
  ['c_2', 'a_2', 'b_2'],
  ['c_2', 'b_2', 'a_2'],
];

describe('CE-1518: a cycle of three heads', () => {
  for (const declaration of ['function', '(unknown) -> unknown'])
    test.each(ORDERS)(
      `declared ${declaration}, read in the order %s, %s, %s`,
      (...order: string[]) => {
        const ce = cycle(declaration);
        const first = work(() => ce.box([order[0], 'm']).type.toString());
        expect(first.value).toBe('number');
        // One group derivation at most, bounded by its rounds.
        expect(first.counts.groups).toBeLessThanOrEqual(1);
        expect(first.counts.groupBodies).toBeLessThanOrEqual(
          (MAX_GROUP_ROUNDS + 2) * 3
        );
        expect(first.counts.tainted).toBe(0);
        for (const head of order.slice(1))
          expect(ce.box([head, 'm']).type.toString()).toBe('number');
        const caller = ce.box(['d_2', 1]);
        expect(caller.type.toString()).toBe('number');
        expect(caller.evaluate().re).toBe(8);
      }
    );

  test.each(['function', '(unknown) -> unknown'])(
    'a cycle of lists, declared %s',
    (declaration) => {
      const ce = cycle(declaration, true);
      expect(ce.box(['d_2', 'm']).type.toString()).toBe('list<integer>');
      expect(ce.box(['a_2', 'm']).type.toString()).toBe('list<integer>');
      expect(ce.box(['d_2', 2]).evaluate().json).toEqual([
        'List',
        3,
        1,
        2,
        1,
        4,
      ]);
    }
  );

  test('the assignments of heads declared (unknown) -> unknown are bounded', () => {
    const { counts } = work(() => cycle('(unknown) -> unknown'));
    // Before, the four assignments ran about 15,000 derivations.
    expect(counts.derivations).toBeLessThan(200);
    expect(counts.tainted).toBe(0);
  });
});

describe('CE-1518: a pair of heads', () => {
  // CE-1091: with `g` assigned before `f`, `g(m)` was typed `number`, but
  // `g(1)` is "a".
  const body: Record<'f' | 'g', MathJsonExpression> = {
    f: ['Function', ['If', ['Equal', 'n', 0], "'a'", call('g')], 'n'],
    g: ['Function', ['If', ['Equal', 'n', 0], 2, call('f')], 'n'],
  };
  for (const assigned of [
    ['f', 'g'],
    ['g', 'f'],
  ] as const)
    for (const read of [
      ['f', 'g'],
      ['g', 'f'],
    ] as const)
      test(`assigned ${assigned.join('')}, read ${read.join('')}`, () => {
        const ce = new ComputeEngine();
        for (const name of ['f', 'g']) ce.declare(name, '(unknown) -> unknown');
        ce.declare('m', 'integer');
        for (const name of assigned) ce.assign(name, body[name]);
        for (const name of read)
          expect(ce.box([name, 'm']).type.toString()).toBe('integer | string');
        expect(ce.box(['g', 1]).evaluate().json).toBe("'a'");
      });

  test('a head that reaches the other only through it', () => {
    // `G(n − 1)` reads `F` only through `G`. Before, `F(m)` was `unknown`.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('F', 'function');
    ce.declare('G', 'function');
    ce.declare('m', 'integer');
    ce.assign('F', [
      'Function',
      ['If', ['Equal', 'n', 0], ['Greater', 'x', 0], call('G')],
      'n',
    ]);
    ce.assign('G', ['Function', ['F', 'n'], 'n']);
    expect(ce.box(['F', 'm']).type.toString()).toBe('boolean');
  });

  test('a head whose body calls a function that is not defined', () => {
    // `B` reads `g`, which has no definition, so a call of `B` is a value of
    // any type: it is not left out of the join of `A` as a recursive call.
    const ce = new ComputeEngine();
    ce.declare('A', 'function');
    ce.declare('B', 'function');
    ce.assign('A', ['Function', ['If', ['Less', 'n', 1], 1, call('B')], 'n']);
    ce.assign('B', [
      'Function',
      ['If', ['Less', 'n', 1], ['g', 'n'], call('A')],
      'n',
    ]);
    // `A(1)` is `g(0)`, which can be any value.
    const { value, counts } = work(() => [
      ce.box(['A', 'm']).type.toString(),
      ce.box(['B', 'm']).type.toString(),
    ]);
    expect(value).toEqual(['any', 'any']);
    // The group ran, and reached its fixpoint before the round limit.
    expect(counts.groups).toBeGreaterThanOrEqual(1);
    expect(counts.groupRounds).toBeLessThan(MAX_GROUP_ROUNDS);
  });

  test('a head that only forwards to another waits for it', () => {
    // `B` and `C` are `unknown` in the first round only because they call
    // members whose candidates are still `unknown`: they are not `any`.
    const ce = new ComputeEngine();
    for (const name of ['B', 'C', 'D']) ce.declare(name, 'function');
    ce.assign('B', ['Function', ['C', 'n'], 'n']);
    ce.assign('C', ['Function', ['D', 'n'], 'n']);
    ce.assign('D', ['Function', ['If', ['Less', 'n', 1], 1, call('B')], 'n']);
    // Before, all three were `unknown`.
    const { value, counts } = work(() =>
      ['D', 'B', 'C'].map((name) => ce.box([name, 'm']).type.toString())
    );
    expect(value).toEqual(['number', 'number', 'number']);
    expect(counts.groups).toBeGreaterThanOrEqual(1);
    expect(counts.groupRounds).toBeLessThan(MAX_GROUP_ROUNDS);
  });

  test('a head with a declared result cuts the cycle', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(unknown) -> unknown');
    ce.declare('g', '(unknown) -> integer');
    ce.assign('f', ['Function', ['If', ['Equal', 'n', 0], 1, call('g')], 'n']);
    ce.assign('g', ['Function', ['If', ['Equal', 'n', 0], 2, call('f')], 'n']);
    const { value, counts } = work(() => ce.box(['f', 'm']).type.toString());
    // `g` is not a member: `f` is derived alone, as before.
    expect(['integer', 'number']).toContain(value);
    expect(counts.groups).toBe(0);
  });
});

describe('CE-1518: the other functions take no group derivation', () => {
  test.each(['function', '(unknown) -> unknown'])(
    'a function that does not call itself, and one that calls only itself, declared %s',
    (declaration) => {
      const ce = new ComputeEngine();
      ce.declare('p', declaration);
      ce.declare('r', declaration);
      const { counts } = work(() => {
        ce.assign('p', ['Function', ['Add', ['Square', 'n'], 1], 'n']);
        ce.assign('r', [
          'Function',
          ['If', ['LessEqual', 'n', 0], 1, ['Multiply', 'n', call('r')]],
          'n',
        ]);
        for (let i = 0; i < 3; i++) {
          expect(ce.box(['p', 'm']).type.toString()).toBe('number');
          expect(ce.box(['r', 'm']).type.toString()).toBe('number');
        }
      });
      expect(counts.groups).toBe(0);
      expect(counts.groupBodies).toBe(0);
    }
  );
});
