import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

function fixture(size = 153) {
  const ce = new ComputeEngine();
  ce.assign(
    'P',
    ce.box(['List', ...Array.from({ length: size }, (_, i) => i)])
  );
  const js = (json: any, options = {}) => {
    const result = compile(ce.box(json), {
      to: 'javascript',
      fallback: false,
      ...options,
    } as any);
    expect(result.success).toBe(true);
    return result;
  };
  return { ce, js };
}

const length = ['Length', 'P'];

test.each(['Sum', 'Product'])(
  '%s folds a large list-length bound before loop emission',
  (op) => {
    const { js } = fixture();
    const r = js([op, 'x', ['Limits', 'k', 1, length]]);
    expect(r.code).toContain('const _upper = 153;');
    expect(r.code).toContain('while');
    expect(r.code).not.toContain('Math.floor');
    expect(r.code).not.toContain('Number.isFinite');
    expect(r.run!({ x: 2 })).toBe(op === 'Sum' ? 306 : 2 ** 153);
  }
);

test.each(['Sum', 'Product'])(
  '%s can unroll a folded 53-element bound',
  (op) => {
    const { js } = fixture(53);
    const r = js([op, 'x', ['Limits', 'k', 1, length]]);
    expect(r.code).not.toContain('while');
    expect(r.code).not.toContain('Math.floor');
    expect(r.run!({ x: 2 })).toBe(op === 'Sum' ? 106 : 2 ** 53);
  }
);

test.each(['Sum', 'Product'])(
  '%s respects iteration budgets for folded and literal 53-element bounds',
  (op) => {
    const { js } = fixture(53);
    for (const upper of [length, 53]) {
      for (const constantFold of [false, true]) {
        for (const iterationBudget of [10, 53]) {
          const r = js([op, 'x', ['Limits', 'k', 1, upper]], {
            constantFold,
            iterationBudget,
          });
          if (iterationBudget === 10) {
            expect(r.code).toContain('while');
            expect(r.run!({ x: 2 })).toBeNaN();
          } else {
            expect(r.run!({ x: 2 })).toBe(op === 'Sum' ? 106 : 2 ** 53);
          }
        }
      }
    }
  }
);

test('folded fractional bounds retain floor semantics, including negative values', () => {
  const { js } = fixture();
  for (const [lower, upper, expected] of [
    [['Sqrt', 2], ['Add', 152, ['Sqrt', 2]], 23562],
    [['Negate', ['Sqrt', 8]], ['Negate', ['Sqrt', 2]], -10],
  ] as const) {
    const r = js([
      'Sum',
      ['Multiply', 'k', 'x'],
      ['Limits', 'k', lower, upper],
    ]);
    expect(r.code).not.toContain('Math.floor');
    expect(r.code).not.toContain('Number.isFinite');
    expect(r.run!({ x: 2 })).toBe(expected);
  }
});

test.each(['Sum', 'Product'])('%s recognizes an empty folded range', (op) => {
  const { js } = fixture();
  const r = js([op, 'x', ['Limits', 'k', ['Add', length, 1], length]]);
  expect(r.code).toBe(op === 'Sum' ? '0' : '1');
  expect(r.run!({ x: NaN })).toBe(op === 'Sum' ? 0 : 1);
});

test('a mixed range checks only its dynamic bound', () => {
  const { js } = fixture();
  const upper = js(['Sum', 'x', ['Limits', 'k', ['Length', ['List', 1]], 'n']]);
  expect(upper.code).toContain('Number.isFinite(_upper)');
  expect(upper.code).not.toContain('Number.isFinite(k)');
  const lower = js(['Sum', 'x', ['Limits', 'k', 'n', length]]);
  expect(lower.code).not.toContain('Number.isFinite(_upper)');
  expect(lower.code).toContain('Number.isFinite(k)');
  expect(upper.run!({ x: 2, n: 3 })).toBe(6);
  expect(lower.run!({ x: 2, n: 152 })).toBe(4);
  for (const n of [NaN, Infinity, -Infinity]) {
    expect(upper.run!({ x: 2, n })).toBeNaN();
    expect(lower.run!({ x: 2, n })).toBeNaN();
  }
});

test('folding can be disabled', () => {
  const { js } = fixture();
  const r = js(['Sum', 'x', ['Limits', 'k', 1, length]], {
    constantFold: false,
  });
  expect(r.code).toContain('Math.floor');
  expect(r.code).toContain('Number.isFinite(_upper)');
  expect(r.run!({ x: 2 })).toBe(306);
});

test('caller function overrides and variable mappings keep bounds dynamic', () => {
  const { js } = fixture();
  const expr = ['Sum', 'x', ['Limits', 'k', 1, length]];
  const overridden = js(expr, { functions: { Length: '((xs) => 2)' } });
  expect(overridden.code).toContain('Math.floor');
  expect(overridden.run!({ x: 2 })).toBe(4);
  const mapped = js(expr, { vars: { P: '_.other' } });
  expect(mapped.code).toContain('Math.floor');
  expect(mapped.run!({ x: 2, other: [1, 2, 3] })).toBe(6);
  expect(mapped.run!({ x: 2, other: [1] })).toBe(2);
});

test('a lambda parameter shadows an engine value in a bound', () => {
  const { ce, js } = fixture();
  ce.assign('n', 20);
  const r = js([
    'Function',
    ['Sum', 'k', ['Limits', 'k', 1, ['Add', 'n', 1]]],
    'n',
  ]);
  expect((r.run as any)(2)).toBe(6);
  expect((r.run as any)(3)).toBe(10);
});

test('nested bounds use the enclosing loop counter', () => {
  const { js } = fixture();
  const r = js([
    'Sum',
    ['Sum', 'x', ['Limits', 'j', 1, ['Add', 'k', 1]]],
    ['Limits', 'k', 1, 3],
  ]);
  expect(r.run!({ x: 2 })).toBe(18);
});

test('dependency capture does not bake a folded bound', () => {
  const { ce } = fixture();
  const target = new JavaScriptTarget().createTarget({
    var: (id) => `_.${id}`,
  });
  target.symbolDeps = new Set();
  const code = BaseCompiler.compileRoot(
    ce.box(['Sum', 'x', ['Limits', 'k', 1, length]]),
    target
  );
  expect(code).toContain('Math.floor');
  expect(code).toContain('Number.isFinite(_upper)');
});

test('an iteration budget still guards folded bounds', () => {
  const { js } = fixture();
  const r = js(['Sum', 'x', ['Limits', 'k', 1, length]], {
    iterationBudget: 100,
  });
  expect(r.run!({ x: 2 })).toBeNaN();
});
