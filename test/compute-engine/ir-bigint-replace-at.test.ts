import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

// `ReplaceAt` of a list of integers of a length known at run time, in
// `mode: 'bigint'`, is the interpreter's list, exactly (`_SYS.bwix`).

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('k', 'integer');
ce.declare('J', 'list<integer>');

const P60 = 2n ** 60n;

const big = (json: unknown) =>
  compile(ce.box(json as never), {
    profile: 'ir',
    mode: 'bigint',
    fallback: false,
    entryChecks: false,
  } as never) as any;

const interpreted = (
  json: unknown,
  point: Record<string, number | bigint[]>
): bigint[] => {
  const subs = Object.fromEntries(
    Object.entries(point).map(([name, v]) => [
      name,
      Array.isArray(v)
        ? ce.function(
            'List',
            v.map((x) => ce.number(x))
          )
        : ce.number(v),
    ])
  );
  return [
    ...ce
      .box(json as never)
      .subs(subs)
      .evaluate()
      .each(),
  ].map((x) => BigInt(x.toString()));
};

const zeros = ['Map', ['Function', 0, 'z'], ['Range', 1, 'n']];

describe('IR bigint: ReplaceAt of a list of a run-time length', () => {
  test.each([1, -1, 2, -3])(
    'a constant index %i of a list built at run time',
    (i) => {
      const json = ['ReplaceAt', zeros, i, 7];
      const r = big(json);
      expect(r.mode).toBe('bigint');
      for (const n of [3, 4, 9])
        expect(r.run({ n })).toEqual(interpreted(json, { n }));
    }
  );

  test('the repro: the first of n zeros', () => {
    const r = big(['ReplaceAt', zeros, 1, 1]);
    expect(r.run({ n: 1 })).toEqual([1n]);
    expect(r.run({ n: 3 })).toEqual([1n, 0n, 0n]);
  });

  test.each([1, -1, 3, -3])('a constant index %i of an input list', (i) => {
    const json = ['ReplaceAt', 'J', i, 5];
    const r = big(json);
    const J = [P60, -4n, 2n ** 53n + 1n];
    expect(r.run({ J })).toEqual(interpreted(json, { J }));
    expect(J).toEqual([P60, -4n, 2n ** 53n + 1n]);
  });

  test('an element written beyond 2^53', () => {
    const r = big(['ReplaceAt', 'J', 2, ['Multiply', 'k', 'k']]);
    const J = [1n, 2n, 3n];
    expect(r.run({ J, k: P60 })).toEqual([1n, P60 * P60, 3n]);
  });

  test('an index known at run time', () => {
    const json = ['ReplaceAt', 'J', 'k', 9];
    const r = big(json);
    const J = [1n, 2n, 3n, 4n];
    for (const k of [1, 2, 4, -1, -4])
      expect(r.run({ J, k })).toEqual(interpreted(json, { J, k }));
  });

  test('an index out of range throws, where the interpreter leaves it unevaluated', () => {
    const r = big(['ReplaceAt', 'J', 'k', 9]);
    for (const k of [0, 5, -5])
      expect(() => r.run({ J: [1n, 2n, 3n, 4n], k })).toThrow(/out-of-range/);
  });
});
