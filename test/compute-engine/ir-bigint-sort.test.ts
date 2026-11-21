import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

// `Sort` of a list of integers in `mode: 'bigint'` is the interpreter's
// sorted list, exactly (`_SYS.bsort`).

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('J', 'list<integer>');

const P60 = 2n ** 60n;

const big = (json: unknown) =>
  compile(ce.box(json as never), {
    profile: 'ir',
    mode: 'bigint',
    fallback: false,
  } as never) as any;

/** The interpreter's sorted list, as bigints. */
const interpreted = (json: unknown, J: bigint[]): bigint[] =>
  [
    ...ce
      .box(json as never)
      .subs({
        J: ce.function(
          'List',
          J.map((x) => ce.number(x))
        ),
      })
      .evaluate()
      .each(),
  ].map((x) => BigInt(x.toString()));

describe('IR bigint: Sort', () => {
  const POINTS: bigint[][] = [
    [],
    [5n],
    [3n, 1n, 2n],
    [3n, -1n, 3n, 0n, -7n, 1n, 1n],
    [P60, -P60, P60 + 1n, 2n ** 53n, -(2n ** 53n) - 1n, 0n],
  ];

  test.each(POINTS.map((p) => [p]))('Sort(J) at %j', (J) => {
    const json = ['Sort', 'J'];
    const r = big(json);
    expect(r.mode).toBe('bigint');
    expect(r.run({ J })).toEqual(interpreted(json, J));
  });

  test('a sort that is read', () => {
    const json = ['At', ['Sort', 'J'], 1];
    const J = [4n, -2n, P60, -P60];
    expect(big(json).run({ J })).toEqual(-P60);
  });

  test('the input is not changed', () => {
    const J = [3n, 1n, 2n];
    big(['Sort', 'J']).run({ J });
    expect(J).toEqual([3n, 1n, 2n]);
  });

  test('a list built at run time', () => {
    const json = [
      'Sort',
      [
        'Map',
        ['Function', ['Mod', ['Multiply', 'i', 'i'], 7], 'i'],
        ['Range', 1, 'n'],
      ],
    ];
    const r = big(json);
    const want = (n: number) =>
      [
        ...ce
          .box(json as never)
          .subs({ n })
          .evaluate()
          .each(),
      ].map((x) => BigInt(x.toString()));
    for (const n of [1, 5, 12]) expect(r.run({ n })).toEqual(want(n));
  });
});
