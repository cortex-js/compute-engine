import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

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
      ? ['Block', ['Declare', 'q'], ['Assign', 'q', value], 'q']
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
  expr: MathJsonExpression,
  limit = 50_000
) {
  const boxed = ce.expr(expr);
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
  test.each([9, 10, 12])(
    'depth %i keeps compilation and emission bounded',
    (depth) => {
      const ce = sharedGraph(depth);
      const r = compileBounded(ce, [
        'AsRgb',
        ['Hsv', [`f_${depth}`, 'x'], 1, 1],
      ]);
      const source = (r.preamble ?? '') + (r.code ?? '');
      expect(source.length).toBeLessThan(2000);
      expect(r.preamble).toContain(`const _fn_f_${depth}`);
      for (const x of [-1, 0, 0.25, 2]) {
        let slope = 1;
        let offset = 1;
        for (let i = 0; i < depth; i++) {
          slope *= 3;
          offset *= 2;
        }
        const expected = compile(
          ce.expr(['AsRgb', ['Hsv', slope * x + offset, 1, 1]])
        );
        expect(expected.success).toBe(true);
        expect(r.run!({ x })).toEqual(expected.run!({}));
      }
    }
  );

  test('asymmetric shared paths keep compilation bounded', () => {
    const ce = sharedGraph(20, false, true);
    // Different remaining depths need separate proofs. This larger graph
    // gets a higher work bound while repeated traversal still exceeds it.
    const numeric = compileBounded(ce, ['f_20', 'x'], 200_000);
    const color = compileBounded(
      ce,
      ['AsRgb', ['Hsv', ['f_20', 'x'], 1, 1]],
      200_000
    );
    for (const result of [numeric, color]) {
      const source = (result.preamble ?? '') + (result.code ?? '');
      expect(source.length).toBeLessThan(4000);
      expect(result.preamble).toContain('const _fn_f_20');
    }
    let [previousSlope, slope] = [1, 3];
    let [previousOffset, offset] = [1, 2];
    for (let i = 2; i <= 20; i++) {
      [previousSlope, slope] = [slope, slope + 2 * previousSlope];
      [previousOffset, offset] = [offset, offset + previousOffset];
    }
    for (const x of [-1, 0, 0.25, 2]) {
      const value = slope * x + offset;
      expect(numeric.run!({ x })).toBe(value);
      const expected = compile(ce.expr(['AsRgb', ['Hsv', value, 1, 1]]));
      expect(expected.success).toBe(true);
      expect(color.run!({ x })).toEqual(expected.run!({}));
    }
  });

  test('shared helpers retain block local bindings', () => {
    const ce = sharedGraph(12, true);
    const r = compileBounded(ce, ['f_12', 'x']);
    expect((r.preamble ?? '').length).toBeLessThan(4000);
    expect(r.preamble).toMatch(/let q/);
    expect(r.run!({ x: 0.25 })).toBe(3 ** 12 * 0.25 + 2 ** 12);
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
