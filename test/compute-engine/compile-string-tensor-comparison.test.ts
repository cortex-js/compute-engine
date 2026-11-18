import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

describe('CE-219: a comparison over broadcastable<string> compiles', () => {
  const ce = new ComputeEngine();
  ce.declare('S', 'broadcastable<string>');

  test('a mixed ordering still declines', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('S', 'broadcastable<string>');
    ce2.declare('n', 'real');
    expect(() =>
      compile(ce2.box(['Less', 'S', 'n']), {
        to: 'javascript',
        fallback: false,
      } as any)
    ).toThrow(/Could not compile/);
  });
});
