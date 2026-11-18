import { ComputeEngine, compile } from '../../src/compute-engine';

/**
 * A host declares a plot axis or a list seam `real | signed_infinity | nan`.
 * `Unique` compiles to `[...new Set(L)]`, and SameValueZero equates each of
 * `Infinity`, `-Infinity` and `NaN` with itself, as the interpreter's
 * structural comparison does, so the extended reals are admitted like `real`.
 */
describe('Unique over a list of extended reals compiles on JavaScript', () => {

  test('a complex element type is still refused', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<complex>');
    expect(() =>
      compile(ce.box(['Unique', 'L']), { to: 'javascript', fallback: false })
    ).toThrow(/Could not compile/);
  });
});
