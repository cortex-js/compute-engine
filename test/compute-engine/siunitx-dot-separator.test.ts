import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const ce = new ComputeEngine();

describe('SIUNITX PRODUCT SEPARATOR "."', () => {
  // In the unit argument of a siunitx command, a `.` between two units is a
  // product of the units: `m.s^{-1}` is `m·s⁻¹`.
  test.each<[string, string, MathJsonExpression]>([
    [
      '\\qty{3}{m.s^{-1}}',
      '\\qty{3}{m\\cdot s^{-1}}',
      ['Quantity', 3, ['Divide', 'm', 's']],
    ],
    [
      '\\SI{3}{m.s^{-1}}',
      '\\SI{3}{m\\cdot s^{-1}}',
      ['Quantity', 3, ['Divide', 'm', 's']],
    ],
    [
      '\\qty{3}{kg.m^2.s^{-2}}',
      '\\qty{3}{kg\\cdot m^2\\cdot s^{-2}}',
      [
        'Quantity',
        3,
        ['Divide', ['Multiply', 'kg', ['Power', 'm', 2]], ['Power', 's', 2]],
      ],
    ],
    [
      '\\qty{3}{kg.m^{2}.s^{-2}}',
      '\\qty{3}{kg\\cdot m^{2}\\cdot s^{-2}}',
      [
        'Quantity',
        3,
        ['Divide', ['Multiply', 'kg', ['Power', 'm', 2]], ['Power', 's', 2]],
      ],
    ],
    [
      '\\qty{3}{N.m}',
      '\\qty{3}{N\\cdot m}',
      ['Quantity', 3, ['Multiply', 'N', 'm']],
    ],
    [
      '\\qty{3}{m . s^{-1}}',
      '\\qty{3}{m\\cdot s^{-1}}',
      ['Quantity', 3, ['Divide', 'm', 's']],
    ],
    [
      '\\qty[parse-numbers=false]{2\\sqrt{2}}{N.m}',
      '\\qty[parse-numbers=false]{2\\sqrt{2}}{N\\cdot m}',
      ['Quantity', ['Multiply', 2, ['Sqrt', 2]], ['Multiply', 'N', 'm']],
    ],
  ])('%s', (latex, withCdot, json) => {
    const q = ce.parse(latex);
    expect(q.json).toEqual(json);
    expect(q.isSame(ce.parse(withCdot))).toBe(true);
  });

  test('\\unit and \\si', () => {
    for (const cmd of ['\\unit', '\\si']) {
      const u = ce.parse(`${cmd}{m.s^{-1}}`);
      expect(u.isValid).toBe(true);
      expect(u.isSame(ce.parse(`${cmd}{m\\cdot s^{-1}}`))).toBe(true);
    }
  });

  test('a decimal magnitude and a prefixed unit', () => {
    expect(ce.parse('\\qty{3.5}{m}').json).toEqual(['Quantity', 3.5, 'm']);
    expect(ce.parse('\\qty{3.5}{km.h^{-1}}').json).toEqual([
      'Quantity',
      3.5,
      ['Divide', 'km', 'h'],
    ]);
    expect(ce.parse('\\qty{3}{mm.s^{-1}}').json).toEqual([
      'Quantity',
      3,
      ['Divide', 'mm', 's'],
    ]);
  });

  test('a decimal point in an exponent is not a separator', () => {
    expect(ce.parse('\\qty{2}{m^{1.5}}').json).toEqual([
      'Quantity',
      2,
      ['Power', 'm', 1.5],
    ]);
    expect(
      ce
        .parse('\\qty{2}{m^{1.5}.s}')
        .isSame(ce.parse('\\qty{2}{m^{1.5}\\cdot s}'))
    ).toBe(true);
  });

  test('the abbreviation "in." is not a separator', () => {
    expect(ce.parse('\\qty{3}{in.}').json).toEqual(['Quantity', 3, 'in']);
  });

  test('a "." with no unit on one side is not a product', () => {
    for (const latex of ['\\qty{3}{.m}', '\\qty{3}{m.}', '\\qty{3}{m..s}'])
      expect(ce.parse(latex).isValid).toBe(false);
  });

  test('round trip', () => {
    for (const latex of [
      '\\qty{3}{m.s^{-1}}',
      '\\qty{3}{kg.m^2.s^{-2}}',
      '\\qty{\\pi}{kg.m^2.s^{-2}}',
    ]) {
      const q = ce.parse(latex);
      expect(q.latex).not.toContain('.');
      expect(ce.parse(q.latex).isSame(q)).toBe(true);
    }
    expect(ce.parse('\\qty{3}{m.s^{-1}}').latex).toBe('3\\,\\mathrm{m/s}');
    expect(ce.parse('\\qty{\\pi}{kg.m^2.s^{-2}}').latex).toBe(
      '\\qty[parse-numbers=false]{\\pi}{kg\\cdot m^{2}/s^{2}}'
    );
  });
});

describe('SIUNITX PRODUCT SEPARATOR "~"', () => {
  // In siunitx, `~` is a product of two units, as `.` is. The tokenizer gives
  // the same token for `~` and for a space, and records which one it was.
  test.each<[string, string]>([
    ['\\qty{3}{m~s^{-1}}', '\\qty{3}{m.s^{-1}}'],
    ['\\SI{3}{m~s^{-1}}', '\\qty{3}{m.s^{-1}}'],
    ['\\qty{3}{kg~m^2~s^{-2}}', '\\qty{3}{kg.m^2.s^{-2}}'],
    ['\\qty{3}{m ~ s}', '\\qty{3}{m.s}'],
    ['\\unit{m~s^{-1}}', '\\unit{m.s^{-1}}'],
    ['\\si{m~s^{-1}}', '\\unit{m.s^{-1}}'],
  ])('%s', (latex, withDot) => {
    const q = ce.parse(latex);
    expect(q.isValid).toBe(true);
    expect(q.isSame(ce.parse(withDot))).toBe(true);
  });

  test('a space is not a separator', () => {
    // `m s` is printed `ms` by LaTeX: the millisecond
    expect(ce.parse('\\qty{3}{m s^{-1}}').json).toEqual([
      'Quantity',
      3,
      ['Divide', 1, 'ms'],
    ]);
  });

  test('outside a siunitx unit, "~" is a space', () => {
    expect(ce.parse('a~b').isSame(ce.parse('a b'))).toBe(true);
    expect(
      ce
        .parse('\\text{miles~per~hour}')
        .isSame(ce.parse('\\text{miles per hour}'))
    ).toBe(true);
  });
});

describe('A SIUNITX UNIT ARGUMENT THAT IS NOT A UNIT', () => {
  // The error is on the unit argument and holds its text. The parser used to
  // report an `unexpected-command` error on the siunitx command.
  test('\\qty', () => {
    expect(ce.parse('\\qty{3}{foo}').json).toEqual([
      'Quantity',
      3,
      ['Error', "'unknown-unit'", ['LatexString', "'foo'"]],
    ]);
    expect(ce.parse('\\SI{3}{m..s}').json).toEqual([
      'Quantity',
      3,
      ['Error', "'unknown-unit'", ['LatexString', "'m..s'"]],
    ]);
  });

  test('\\unit and \\si', () => {
    for (const cmd of ['\\unit', '\\si'])
      expect(ce.parse(`${cmd}{foo}`).json).toEqual([
        'Error',
        "'unknown-unit'",
        ['LatexString', "'foo'"],
      ]);
  });

  test('the rest of the input is parsed', () => {
    expect(ce.parse('\\qty{3}{foo}+1').json).toEqual([
      'Add',
      ['Quantity', 3, ['Error', "'unknown-unit'", ['LatexString', "'foo'"]]],
      1,
    ]);
  });
});
