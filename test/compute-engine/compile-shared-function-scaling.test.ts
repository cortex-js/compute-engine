import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import type { Expression } from '../../src/compute-engine/global-types';
import { isExpression } from '../../src/compute-engine/boxed-expression/type-guards';

function sharedGraph(depth: number, locals = false, asymmetric = false) {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  for (let i = 0; i <= depth; i++) {
    const value: MathJsonExpression =
      i === 0
        ? ['Add', 'u', 1]
        : [
            'Add',
            [`f_${i - 1}`, 'u'],
            [`f_${asymmetric && i > 1 ? i - 2 : i - 1}`, ['Multiply', 2, 'u']],
          ];
    const body: MathJsonExpression = locals
      ? ['Block', ['Declare', 'q', "'unknown'", value], 'q']
      : ['Block', value];
    ce.declare(`f_${i}`, 'function');
    ce.assign(`f_${i}`, ce.box(['Function', body, 'u']));
  }
  return ce;
}

/** Abort a regressed traversal before it stalls the test worker. Counting
 * definition lookups detects repeated analysis without a timing assertion. */
function compileBounded(
  ce: ComputeEngine,
  expr: MathJsonExpression | Expression,
  limit = 50_000
) {
  const boxed = isExpression(expr) ? expr : ce.expr(expr);
  const lookup = ce.lookupDefinition.bind(ce);
  let count = 0;
  const spy = jest
    .spyOn(ce, 'lookupDefinition')
    .mockImplementation((...args) => {
      if (++count > limit)
        throw new Error(`Shared-function analysis exceeded ${limit} lookups`);
      return lookup(...args);
    });
  try {
    const result = compile(boxed, {
      to: 'javascript',
      mode: 'strict',
      scalarInputs: ['x', 'y', 'z'],
    });
    expect(result.success).toBe(true);
    expect(count).toBeLessThan(limit);
    return result;
  } finally {
    spy.mockRestore();
  }
}

describe('shared function shape analysis', () => {
  test('a folded shared complex graph keeps compilation work bounded', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.declare('x', 'real');
    let value = ce.expr(['Complex', 1, 1]);
    for (let i = 0; i < 10; i++)
      value = ce._fn('Add', [
        ce._fn('Multiply', [ce.number(0.5), value]),
        ce._fn('Multiply', [ce.number(0.25), value]),
      ]);
    const r = compileBounded(ce, ce._fn('Add', [ce.symbol('x'), value]), 25_000);
    const result = r.run!({ x: 2 }) as { re: number; im: number };
    expect(result.re).toBeCloseTo(2 + 0.75 ** 10, 14);
    expect(result.im).toBeCloseTo(0.75 ** 10, 14);
  });

  test('list calls still broadcast through the shared scalar graph', () => {
    const ce = sharedGraph(12);
    ce.declare('P', 'list<real>');
    const r = compileBounded(ce, ['f_12', 'P']);
    expect(r.run!({ P: [0, 0.25, 2] })).toEqual(
      [0, 0.25, 2].map((x) => 3 ** 12 * x + 2 ** 12)
    );
  });

  test('later compilations cannot reuse earlier function definitions', () => {
    const ce = sharedGraph(2);
    const first = compileBounded(ce, ['f_2', 'x']);
    ce.assign('f_0', ce.box(['Function', ['List', 'u', ['Add', 'u', 1]], 'u']));
    const second = compileBounded(ce, ['f_2', 'x']);
    expect(first.run!({ x: 0.25 })).toBe(3 ** 2 * 0.25 + 2 ** 2);
    expect(second.run!({ x: 0.25 })).toEqual([
      3 ** 2 * 0.25,
      3 ** 2 * 0.25 + 2 ** 2,
    ]);
  });
});
