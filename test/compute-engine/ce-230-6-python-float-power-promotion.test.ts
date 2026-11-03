import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// CE-230.6: on the Python target, a power of an unknown-sign real base with a
// float exponent (`t^0.3`) is read on the complex lane in the `complex`
// mode (the result can be complex for a negative base). Before the fix, it
// was emitted from the operator table as `t ** 0.3` in every mode, so the
// emission did not match the analysis. It is now `np.emath.power`, the
// complex lowering that the `Power` handler gives.

const ce = new ComputeEngine();
// A declared input is read as is; an input with an inferred numeric type is
// read through a `None` test (ROADMAP CE-460). The tests check the power.
ce.declare('t', 'real');

type Options = Parameters<typeof compile>[1];

function python(latex: string, mode: 'strict' | 'complex') {
  const result = compile(ce.parse(latex), {
    to: 'python',
    mode,
  } as Options);
  expect(result.success).toBe(true);
  const lines = (result.code ?? '').split('\n');
  return { code: lines[lines.length - 1] };
}

describe('CE-230.6 Python power with a float exponent', () => {
  test('complex mode: the complex lowering', () => {
    expect(python('t^{0.3}', 'complex')).toEqual({
      code: 'np.emath.power(t, 0.3)',
    });
    expect(python('\\mathrm{Re}(t^{2.5})', 'complex')).toEqual({
      code: 'np.real(np.emath.power(t, 2.5))',
    });
  });

  test('strict mode: the real power', () => {
    expect(python('t^{0.3}', 'strict')).toEqual({
      code: 't ** 0.3',
    });
  });

  test('an integer exponent keeps the operator', () => {
    expect(python('t^{2}', 'complex')).toEqual({
      code: 't ** 2',
    });
  });
});
