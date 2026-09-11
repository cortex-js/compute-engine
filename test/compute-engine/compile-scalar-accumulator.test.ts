import { ComputeEngine, compile } from '../../src/compute-engine';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { isScalarValue } from '../../src/compute-engine/compilation/javascript-value-facts';
import type { MathJsonExpression } from '../../src/math-json/types';

const source = (r: { code?: string; preamble?: string }) =>
  (r.preamble ?? '') + (r.code ?? '');

function selection(
  head: 'If' | 'Which',
  condition: MathJsonExpression,
  yes: MathJsonExpression = 'x',
  no: MathJsonExpression = ['Negate', 'x']
): MathJsonExpression {
  return head === 'If'
    ? ['If', condition, yes, no]
    : ['Which', condition, yes, 'True', no];
}

function fixture(
  kind: 'Sum' | 'Product',
  value: MathJsonExpression = ['Multiply', 'i', 'x'],
  tail: MathJsonExpression[] = []
) {
  const ce = new ComputeEngine();
  ce.declare('N', 'integer');
  ce.declare('x', 'real');
  ce.declare('P', 'list<real>');
  const expr = ce.box([
    kind,
    [
      'Block',
      ['Declare', 'q', "'broadcastable<number>'"],
      ['Assign', 'q', value],
      ...tail,
      'q',
    ],
    ['Limits', 'i', 1, 'N'],
  ]);
  return { ce, expr };
}

describe('scalar accumulation of collection-capable block results', () => {
  test.each(['Sum', 'Product'] as const)(
    '%s uses scalar terms directly',
    (kind) => {
      const { expr } = fixture(kind);
      const r = compile(expr);
      expect(r.success).toBe(true);
      expect(source(r)).not.toMatch(/_SYS\.bcast|Array\.isArray|\.slice\(/);
      for (const N of [0, 1, 4, 12]) {
        const values = Array.from({ length: N }, (_, i) => 0.5 * (i + 1));
        const expected = values.reduce(
          (a, b) => (kind === 'Sum' ? a + b : a * b),
          kind === 'Sum' ? 0 : 1
        );
        expect(r.run!({ N, x: 0.5 })).toBe(expected);
        expect(r.run!({ N, x: 0.5 })).toBeCloseTo(
          expr.subs({ N, x: 0.5 }).N().re,
          12
        );
      }
    }
  );

  test.each(['Sum', 'Product'] as const)(
    '%s retains first-term signed zero',
    (kind) => {
      const { expr } = fixture(kind, 'x');
      const r = compile(expr);
      expect(source(r)).not.toContain('_SYS.bcast');
      expect(Object.is(r.run!({ N: 1, x: -0 }), -0)).toBe(true);
      expect(r.run!({ N: 0, x: -0 })).toBe(kind === 'Sum' ? 0 : 1);
    }
  );

  test('non-finite terms, bounds, and iteration budgets keep their behavior', () => {
    const { expr } = fixture('Sum');
    const r = compile(expr, { iterationBudget: 4 });
    expect(r.run!({ N: 4, x: Infinity })).toBe(Infinity);
    expect(r.run!({ N: 4, x: NaN })).toBeNaN();
    for (const N of [5, NaN, Infinity]) expect(r.run!({ N, x: 2 })).toBeNaN();
    const noBudget = compile(expr);
    for (const N of [NaN, Infinity, -Infinity])
      expect(noBudget.run!({ N, x: 2 })).toBeNaN();
  });

  test('a collection assignment keeps the broadcast fold and copies its seed', () => {
    const { expr } = fixture('Sum', 'P');
    const r = compile(expr);
    const P = [2, 3];
    expect(source(r)).toContain('_SYS.bcast');
    expect(r.run!({ N: 3, P })).toEqual([6, 9]);
    const one = r.run!({ N: 1, P });
    expect(one).toEqual(P);
    expect(one).not.toBe(P);
  });

  test('conditional reassignment to a collection retains broadcasting', () => {
    const { expr } = fixture('Sum', 'x', [
      ['If', ['Greater', 'i', 1], ['Assign', 'q', 'P']],
    ]);
    const r = compile(expr);
    expect(r.success).toBe(true);
    expect(source(r)).toContain('_SYS.bcast');
    expect(r.run!({ N: 3, x: 1, P: [2, 3] })).toEqual([5, 7]);
  });

  describe.each(['If', 'Which'] as const)('%s result shapes', (head) => {
    test.each(['Sum', 'Product'] as const)(
      '%s broadcasts scalar arms selected by an array condition',
      (kind) => {
        const { expr } = fixture(kind, selection(head, ['Greater', 'P', 0]));
        const r = compile(expr);
        expect(r.success).toBe(true);
        expect(source(r)).toContain('_SYS.bcast');
        expect(r.run!({ N: 3, x: 2, P: [1, -1] })).toEqual(
          kind === 'Sum' ? [6, -6] : [8, -8]
        );
      }
    );

    test.each(['Sum', 'Product'] as const)(
      '%s still optimizes scalar conditions and Boolean constants',
      (kind) => {
        const cases: [MathJsonExpression, number, number][] = [
          [['Greater', 'i', 1], 2, -8],
          ['True', 6, 8],
          ['False', -6, -8],
        ];
        for (const [condition, sum, product] of cases) {
          const { expr } = fixture(kind, selection(head, condition));
          const r = compile(expr, { constantFold: false });
          expect(r.success).toBe(true);
          expect(source(r)).not.toContain('_SYS.bcast');
          expect(r.run!({ N: 3, x: 2 })).toBe(kind === 'Sum' ? sum : product);
        }
      }
    );

    test('nested helpers cannot hide an array condition', () => {
      const { ce, expr } = fixture('Sum', ['outer', 'x']);
      ce.declare('inner', {
        type: 'function',
        value: ce.box([
          'Function',
          selection(head, ['Greater', 'P', 0], 'u', ['Negate', 'u']),
          'u',
        ]),
      });
      ce.declare('outer', {
        type: 'function',
        value: ce.box(['Function', ['inner', 'v'], 'v']),
      });
      const r = compile(expr);
      expect(r.success).toBe(true);
      expect(source(r)).toContain('_SYS.bcast');
      expect(r.run!({ N: 3, x: 2, P: [1, -1] })).toEqual([6, -6]);
    });

    test('a point conditional requires scalar conditions for a scalar Dot proof', () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.declare('P', 'list<real>');
      const target = new JavaScriptTarget().createTarget({
        cse: { enabled: false, instances: [], harvestOptions: {} },
      });
      for (const condition of ['x', 'P']) {
        const point = ce.box(
          selection(
            head,
            ['Greater', condition, 0],
            ['Tuple', 'x', 0],
            ['Tuple', ['Negate', 'x'], 0]
          )
        );
        // Inspect the shape proof before Dot's operand validation rejects
        // the collection-valued conditional.
        const dot = ce._fn('Dot', [point, ce.box(['Tuple', 1, 0])]);
        expect(isScalarValue(dot, target)).toBe(condition === 'x');
      }
    });
  });

  test('caller mappings retain their collection result', () => {
    const { expr } = fixture('Sum', ['Sin', 'i']);
    const r = compile(expr, { functions: { Sin: '(x => [x, x + 1])' } });
    expect(r.success).toBe(true);
    expect(source(r)).toContain('_SYS.bcast');
    expect(r.run!({ N: 3 })).toEqual([6, 9]);
    const numeric = fixture('Sum', 'x');
    const mapped = compile(numeric.expr, { vars: { x: '([2, 3])' } });
    expect(source(mapped)).toContain('_SYS.bcast');
    expect(mapped.run!({ N: 3 })).toEqual([6, 9]);
  });

  test('complex terms retain complex arithmetic', () => {
    const { expr } = fixture('Sum', ['Sqrt', ['Negate', 'i']]);
    const r = compile(expr);
    expect(r.success).toBe(true);
    const value = r.run!({ N: 3 }) as { re: number; im: number };
    expect(value.re).toBe(0);
    expect(value.im).toBeCloseTo(1 + Math.sqrt(2) + Math.sqrt(3), 12);
  });
  test('scalar facts survive a helper call inside the block', () => {
    const { ce, expr } = fixture('Sum', ['helper', ['Multiply', 'i', 'x']]);
    ce.declare('helper', {
      type: 'function',
      value: ce.box(['Function', ['Sin', 'u'], 'u']),
    });
    const r = compile(expr);
    expect(r.success).toBe(true);
    expect(source(r)).not.toContain('_SYS.bcast');
    expect(r.run!({ N: 3, x: 0.5 })).toBeCloseTo(
      Math.sin(0.5) + Math.sin(1) + Math.sin(1.5),
      12
    );
  });

  test('a nested collection binder cannot inherit a scalar index fact', () => {
    const { expr } = fixture('Sum', [
      'Sum',
      ['Add', 'i', 'P'],
      ['Limits', 'i', 1, 2],
    ]);
    const r = compile(expr);
    expect(r.success).toBe(true);
    expect(source(r)).toContain('_SYS.bcast');
    expect(r.run!({ N: 3, P: [1, 2] })).toEqual([15, 21]);
  });
  test.each(['Sum', 'Product'] as const)(
    '%s still evaluates every impure term after NaN',
    (kind) => {
      const { expr } = fixture(kind, ['Random']);
      const r = compile(expr);
      expect(r.success).toBe(true);
      expect(source(r)).not.toContain('_SYS.bcast');
      const draw = jest.spyOn(Math, 'random').mockReturnValue(NaN);
      try {
        expect(r.run!({ N: 4 })).toBeNaN();
        expect(draw).toHaveBeenCalledTimes(4);
      } finally {
        draw.mockRestore();
      }
    }
  );

  test('cancellation retains left-to-right accumulation', () => {
    const { expr } = fixture('Sum', ['At', 'P', 'i']);
    const r = compile(expr);
    expect(source(r)).not.toContain('_SYS.bcast');
    expect(r.run!({ N: 3, P: [1e16, -1e16, 1] })).toBe(1);
  });
});
