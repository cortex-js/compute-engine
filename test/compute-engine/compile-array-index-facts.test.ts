import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function fixture() {
  const ce = new ComputeEngine();
  ce.assign('P', ce.box(['List', 0, 10, 20, 30]));
  const js = (json: any, options = {}) => {
    const r = compile(ce.box(json), {
      to: 'javascript',
      fallback: false,
      constantFold: false,
      ...options,
    } as any);
    expect(r.success).toBe(true);
    return { code: r.code, run: (vars = {}) => r.run!(vars) };
  };
  return { ce, js };
}

test('positive literal indices preserve zero and absence', () => {
  const { js } = fixture();
  for (const [i, expected] of [
    [1, 0],
    [4, 30],
    [5, NaN],
  ]) {
    const r = js(['At', 'P', i]);
    expect(r.run()).toBe(expected);
  }
});

test('positive ascending and descending comprehension counters are direct indices', () => {
  const { js } = fixture();
  for (const [lo, hi, expected] of [
    [1, 5, [0, 10, 20, 30, NaN]],
    [4, 1, [30, 20, 10, 0]],
  ] as const) {
    const r = js([
      'Comprehension',
      ['At', 'P', 'k'],
      ['Element', 'k', ['Range', lo, hi]],
    ]);
    expect(r.code).not.toContain('_SYS.at');
    expect(r.run()).toEqual(expected);
  }
});

test('bounded arithmetic on counters proves positivity', () => {
  const { js } = fixture();
  const r = js([
    'Comprehension',
    ['At', 'P', ['Add', ['Multiply', 2, 'k'], 1]],
    ['Element', 'k', ['Range', 0, 2]],
  ]);
  expect(r.code).not.toContain('_SYS.at');
  expect(r.run()).toEqual([0, 20, NaN]);
});

test('a loop-form sum uses its counter bounds', () => {
  const { ce, js } = fixture();
  ce.assign('P', ce.box(['List', ...Array.from({ length: 300 }, (_, i) => i)]));
  const r = js(['Sum', ['At', 'P', 'k'], ['Limits', 'k', 1, 300]]);
  expect(r.run()).toBe((299 * 300) / 2);
});

test('negative or fractional counters keep their original index semantics', () => {
  const { js } = fixture();
  const negative = js([
    'Comprehension',
    ['At', 'P', 'k'],
    ['Element', 'k', ['Range', -2, 1]],
  ]);
  expect(negative.run()).toEqual([20, 30, NaN, 0]);
  const fractional = js([
    'Comprehension',
    ['At', 'P', 'k'],
    ['Element', 'k', ['Range', 1, 2, 0.5]],
  ]);
  expect(fractional.run()).toEqual([0, NaN, 10]);
});

test('an unbounded runtime integer declaration alone does not prove positivity', () => {
  const { ce, js } = fixture();
  ce.declare('k', 'integer');
  const r = js(['At', 'P', 'k']);
  expect(r.run({ k: -1 })).toBe(30);
});

test('overflowing counter arithmetic does not establish a safe integer range', () => {
  const { js } = fixture();
  const r = js([
    'Comprehension',
    ['At', 'P', ['Multiply', Number.MAX_SAFE_INTEGER, 'k']],
    ['Element', 'k', ['Range', 1, 2]],
  ]);
  expect(r.run()).toEqual([NaN, NaN]);
});

test('range proofs also work when common-subexpression elimination is disabled', () => {
  const { js } = fixture();
  const r = js(
    ['Comprehension', ['At', 'P', 'k'], ['Element', 'k', ['Range', 1, 3]]],
    { cse: false }
  );
  expect(r.code).not.toContain('_SYS.at');
  expect(r.run()).toEqual([0, 10, 20]);
});
