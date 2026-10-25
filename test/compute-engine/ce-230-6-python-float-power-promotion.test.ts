import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// CE-230.6: on the Python target, a power of an unknown-sign real base with a
// float exponent (`t^0.3`) is read as promoted to the complex lane in the
// `auto` mode (the result can be complex for a negative base). Before the
// fix, it was emitted from the operator table as `t ** 0.3` in every mode, so
// the emission did not match the analysis. It is now `np.emath.power`, the
// promoted lowering that the `Power` handler gives.

const ce = new ComputeEngine();
// A declared input is read as is; an input with an inferred numeric type is
// read through a `None` test (ROADMAP CE-460). The tests check the power.
ce.declare('t', 'real');

type Options = Parameters<typeof compile>[1];

function python(latex: string, mode: 'auto' | 'strict' | 'complex') {
  const result = compile(ce.parse(latex), {
    to: 'python',
    mode,
  } as Options) as ReturnType<typeof compile> & { promoted?: boolean };
  expect(result.success).toBe(true);
  const lines = (result.code ?? '').split('\n');
  return { code: lines[lines.length - 1], promoted: result.promoted };
}

describe('CE-230.6 Python power with a float exponent', () => {
  test('auto mode: the promoted lowering', () => {
    expect(python('t^{0.3}', 'auto')).toEqual({
      code: 'np.emath.power(t, 0.3)',
      promoted: true,
    });
    expect(python('\\mathrm{Re}(t^{2.5})', 'auto')).toEqual({
      code: 'np.real(np.emath.power(t, 2.5))',
      promoted: true,
    });
  });

  test('strict mode: the real power', () => {
    expect(python('t^{0.3}', 'strict')).toEqual({
      code: 't ** 0.3',
      promoted: false,
    });
  });

  test('an integer exponent keeps the operator', () => {
    expect(python('t^{2}', 'auto')).toEqual({
      code: 't ** 2',
      promoted: false,
    });
  });
});
