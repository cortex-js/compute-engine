import { ComputeEngine } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

/**
 * An imaginary literal with an integer coefficient is the EXACT Gaussian
 * integer on every route.
 *
 * `4i` typed as LaTeX, `["Complex", 4]` with one argument, and the
 * `-2i` spelling used to be built with `ce.complex(0, n)`, an inexact
 * floating-point value, while `i4`, `2i \cdot 3` and `["Complex", 0, 4]`
 * were exact. So `\sqrt{4i}` evaluated to a float where `\sqrt{i4}` is
 * `\sqrt2(1 + i)`, and `(4i)^2` was computed from the inexact value
 * (ROADMAP, found 2026-09-24). A coefficient with a fractional part has no
 * exact rational form and stays inexact.
 */
const ce = new ComputeEngine();

const exact = (e: any) => (isNumber(e) ? e.isExact : undefined);

describe('an integer imaginary literal is exact on every route', () => {
  test.each(['4i', 'i4', '2i', '-2i', '-3i', '4\\imaginaryI', '2i\\cdot 3'])(
    'parse %s',
    (tex) => expect(exact(ce.parse(tex))).toBe(true)
  );

  test('the one-argument Complex form', () => {
    expect(exact(ce.box(['Complex', 4]))).toBe(true);
    expect(ce.box(['Complex', 4]).json).toEqual(['Complex', 0, 4]);
    expect(exact(ce.box(['Complex', -3]))).toBe(true);
  });

  test('the three spellings of 4i are the same value', () => {
    const a = ce.parse('4i');
    expect(a.isSame(ce.parse('i4'))).toBe(true);
    expect(a.isSame(ce.box(['Complex', 0, 4]))).toBe(true);
    expect(a.isSame(ce.box(['Complex', 4]))).toBe(true);
  });
});

describe('a large, rational or radical coefficient is exact too', () => {
  test('a coefficient past the safe integers keeps every digit', () => {
    const big = { num: '12345678901234567890' };
    expect(ce.parse('12345678901234567890i').json).toEqual(['Complex', 0, big]);
    expect(exact(ce.parse('12345678901234567890i'))).toBe(true);
    expect(ce.box(['Complex', big]).json).toEqual(['Complex', 0, big]);
  });

  test('the one-argument Complex form with a rational or radical', () => {
    const half = ce.box(['Rational', 1, 2]);
    expect(ce.box(['Complex', half]).isSame(ce.box(['Complex', 0, half]))).toBe(
      true
    );
    expect(exact(ce.box(['Complex', half]))).toBe(true);
    const root = ce.box(['Sqrt', 2]);
    expect(ce.box(['Complex', root]).isSame(ce.box(['Complex', 0, root]))).toBe(
      true
    );
    expect(exact(ce.box(['Complex', root]))).toBe(true);
  });

  test('the Number canonical form agrees with boxing', () => {
    const form = { form: 'Number' } as const;
    expect(exact(ce.box(['Complex', 0, 4], form))).toBe(true);
    expect(exact(ce.box(['Complex', 4], form))).toBe(true);
  });
});

describe('a non-integer coefficient stays inexact', () => {
  test.each(['1.5i', '0.5i'])('parse %s', (tex) =>
    expect(exact(ce.parse(tex))).toBe(false)
  );
  test('the one-argument Complex form', () => {
    expect(exact(ce.box(['Complex', 1.5]))).toBe(false);
  });
});

describe('exact arithmetic follows from the exact literal', () => {
  test('√(4i) is √2(1 + i)', () => {
    expect(ce.parse('\\sqrt{4i}').evaluate().toString()).toBe(
      '(sqrt(2) + sqrt(2)i)'
    );
    // The same as the spelling that was already exact.
    expect(
      ce
        .parse('\\sqrt{4i}')
        .evaluate()
        .isSame(ce.parse('\\sqrt{i4}').evaluate())
    ).toBe(true);
  });

  test('(4i)^2 is the exact integer -16', () => {
    const p = ce.parse('(4i)^2');
    expect(p.evaluate().json).toBe(-16);
    expect(exact(p.evaluate())).toBe(true);
  });

  test('N() of an exact imaginary literal is inexact', () => {
    expect(exact(ce.parse('4i').N())).toBe(false);
  });
});

describe('an exact imaginary literal beside a float still pairs into one literal', () => {
  // The pairing of a real and an imaginary literal into one complex literal
  // (`canonicalAdd`, `arithmetic-add.ts`) skips exact complex literals so as
  // not to degrade them. An exact pure-imaginary literal beside an inexact
  // number is the exception: the sum is inexact whatever is done with the
  // exact part, so it is one inexact literal, as it was when `2i` parsed
  // inexact.
  test('1.5 + 2i is one inexact literal', () => {
    expect(ce.parse('1.5 + 2i').json).toEqual(['Complex', 1.5, 2]);
    expect(ce.parse('1.5 - 2i').json).toEqual(['Complex', 1.5, -2]);
    expect(exact(ce.parse('1.5 + 2i'))).toBe(false);
  });
  test('3i + 1.5i is one inexact literal', () => {
    expect(ce.parse('3i + 1.5i').json).toEqual(['Complex', 0, 4.5]);
  });
  test('a partner the pairing cannot use keeps the exact literal', () => {
    // An inexact complex literal with a real part is never paired with.
    const sum = ce.box(['Add', ['Complex', 1.5, 2.5], ['Complex', 0, 2]]);
    expect(sum.operator).toBe('Add');
    const twoI = sum.ops!.find((op) => op.re === 0)!;
    expect(exact(twoI)).toBe(true);
  });
  test('with no inexact partner the exact literal is kept', () => {
    expect(ce.parse('2i + 3').json).toEqual(['Complex', 3, 2]);
    expect(exact(ce.parse('2i + 3'))).toBe(true);
    expect(ce.parse('2i + x').json).toEqual(['Add', 'x', ['Complex', 0, 2]]);
    expect(exact(ce.parse('2i + x').op2)).toBe(true);
  });
});
