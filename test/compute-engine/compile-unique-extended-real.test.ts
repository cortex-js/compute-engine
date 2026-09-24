import { ComputeEngine, compile } from '../../src/compute-engine';

/**
 * A host declares a plot axis or a list seam `real | signed_infinity | nan`.
 * `Unique` compiles to `[...new Set(L)]`, and SameValueZero equates each of
 * `Infinity`, `-Infinity` and `NaN` with itself, as the interpreter's
 * structural comparison does, so the extended reals are admitted like `real`.
 */
describe('Unique over a list of extended reals compiles on JavaScript', () => {
  const U = 'real | signed_infinity | nan';

  test('the declared union is admitted', () => {
    const ce = new ComputeEngine();
    ce.declare('L', `list<${U}>`);
    const r = compile(ce.box(['Unique', 'L']), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    const out = r.run!({
      L: [1, 1, 2, Infinity, Infinity, -Infinity, NaN, NaN] as never,
    }) as number[];
    expect(out).toEqual([1, 2, Infinity, -Infinity, NaN]);
    // The interpreter answers the same elements.
    expect(
      ce
        .box([
          'Unique',
          [
            'List',
            1,
            1,
            2,
            'PositiveInfinity',
            'PositiveInfinity',
            'NegativeInfinity',
            'NaN',
            'NaN',
          ],
        ])
        .evaluate()
        .toString()
    ).toBe('[1,2,+oo,-oo,NaN]');
  });

  test('a complex element type is still refused', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<complex>');
    expect(() =>
      compile(ce.box(['Unique', 'L']), { to: 'javascript', fallback: false })
    ).toThrow(/compares elements/);
  });
});
