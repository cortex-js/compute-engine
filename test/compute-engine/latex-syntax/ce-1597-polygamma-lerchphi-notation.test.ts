import { ComputeEngine } from '../../../src/compute-engine';

// `\psi^{(m)}(z)` is the polygamma function and `\Phi(z, s, a)` with three
// arguments is the Lerch transcendent. Other spellings of `\psi` and `\Phi`
// keep their generic reading, and a declaration of `psi` or `Phi` wins.

describe('CE-1597 \\psi^{(m)}(z) parses as PolyGamma', () => {
  const ce = new ComputeEngine();

  test.each<[string, unknown]>([
    ['\\psi^{(1)}(1)', ['PolyGamma', 1, 1]],
    ['\\psi^{(2)}(1)', ['PolyGamma', 2, 1]],
    ['\\psi^{(0)}(z)', ['PolyGamma', 0, 'z']],
    ['\\psi^{(m)}(z)', ['PolyGamma', 'm', 'z']],
    ['\\psi^{(1)}\\left(x\\right)', ['PolyGamma', 1, 'x']],
    ['\\psi^{(1)} (x)', ['PolyGamma', 1, 'x']],
    ['\\psi^{(1)}(x)^2', ['Power', ['PolyGamma', 1, 'x'], 2]],
  ])('%s', (latex, json) => {
    expect(ce.parse(latex, { form: 'raw' }).json).toEqual(json);
    expect(ce.parse(latex).json).toEqual(json);
  });

  test('\\psi^{(1)}(1) is pi^2/6', () => {
    expect(ce.parse('\\psi^{(1)}(1)').N().re).toBeCloseTo(Math.PI ** 2 / 6, 12);
  });

  test('other spellings of \\psi keep the generic reading', () => {
    expect(ce.parse('\\psi').json).toEqual('psi');
    expect(ce.parse('\\psi(x)').json).toEqual(['psi', 'x']);
    expect(ce.parse('\\psi^2(x)', { form: 'raw' }).json).toEqual([
      'InvisibleOperator',
      ['Power', 'psi', 2],
      ['Delimiter', 'x'],
    ]);
    expect(ce.parse('\\psi^{(1)}', { form: 'raw' }).json).toEqual([
      'Power',
      'psi',
      ['Delimiter', 1],
    ]);
    expect(ce.parse('\\psi^{(1)}(x, y)', { form: 'raw' }).json).toEqual([
      'InvisibleOperator',
      ['Power', 'psi', ['Delimiter', 1]],
      ['Delimiter', ['Sequence', 'x', 'y'], "'(,)'"],
    ]);
  });

  test('a declared function psi keeps the Lagrange derivative reading', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('psi', 'function');
    expect(ce2.parse('\\psi^{(1)}(x)').json).toEqual([
      'Apply',
      ['Derivative', 'psi', 1],
      'x',
    ]);
  });

  // The serialization uses the name, not `\psi^{(m)}`, so that it reads
  // back as the same expression also when `psi` is declared.
  test('PolyGamma round-trips when psi is declared', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('psi', 'function');
    for (const json of [
      ['PolyGamma', 1, 'x'],
      ['PolyGamma', 'm', ['Add', 'x', 1]],
      ['Power', ['PolyGamma', 2, 'x'], 2],
    ] as const) {
      const e = ce2.expr(json as any);
      expect(ce2.parse(e.latex).isSame(e)).toBe(true);
    }
    expect(ce2.expr(['PolyGamma', 1, 'x']).latex).toBe(
      '\\mathrm{PolyGamma}(1, x)'
    );
  });
});

describe('CE-1597 \\Phi(z, s, a) parses as LerchPhi', () => {
  const ce = new ComputeEngine();

  test('three arguments', () => {
    expect(ce.parse('\\Phi(1,2,1)', { form: 'raw' }).json).toEqual([
      'LerchPhi',
      1,
      2,
      1,
    ]);
    expect(ce.parse('\\Phi(z, s, a)').json).toEqual([
      'LerchPhi',
      'z',
      's',
      'a',
    ]);
  });

  test('another number of arguments keeps the generic reading', () => {
    expect(ce.parse('\\Phi').json).toEqual('Phi');
    expect(ce.parse('\\Phi(x)').json).toEqual(['Phi', 'x']);
    expect(ce.parse('\\Phi(1, 2)').json).toEqual(['Phi', 1, 2]);
  });

  test('a declared Phi keeps its own reading', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('Phi', 'function');
    expect(ce2.parse('\\Phi(1,2,1)').json).toEqual(['Phi', 1, 2, 1]);
  });

  test('LerchPhi round-trips when Phi is declared', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('Phi', 'function');
    const e = ce2.expr(['LerchPhi', 'z', 's', 'a']);
    expect(e.latex).toBe('\\mathrm{LerchPhi}(z, s, a)');
    expect(ce2.parse(e.latex).isSame(e)).toBe(true);
  });
});
