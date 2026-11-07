import { ComputeEngine } from '../../../src/compute-engine';

// CE-1033: a `d` with no variable after it is a symbol, not a differential.
// Before the fix, the body of an integral stopped at every `d` (also after a
// `\cdot` or a space), and the reading of the differential consumed the `d`
// when no variable followed it: the `d` disappeared from the result.
// `\int_0^1 \frac{x\,dx}{2} + 1 \cdot d` evaluated to 5/4, not 1/4 + d.

const ce = new ComputeEngine();
const raw = (s: string) => ce.parse(s, { form: 'raw' }).json;
const value = (s: string) => ce.parse(s).evaluate().json;

describe('CE-1033 a d with no variable after it', () => {
  test('a term after the integrand that ends with d', () => {
    expect(raw('\\int_0^1 \\frac{x\\,dx}{2} + 1 \\cdot d')).toEqual([
      'Add',
      [
        'Integrate',
        ['Divide', ['InvisibleOperator', 'x', ['HorizontalSpacing', 3]], 2],
        ['Tuple', 'x', 0, 1],
      ],
      ['Multiply', 1, 'd'],
    ]);
    expect(value('\\int_0^1 \\frac{x\\,dx}{2} + 1 \\cdot d')).toEqual(
      value('\\frac{1}{4} + d')
    );
  });

  test('a term after the differential that ends with d', () => {
    expect(value('\\int_0^1 x\\,dx + 1 \\cdot d')).toEqual(
      value('\\frac{1}{2} + d')
    );
  });

  test('a d at the end of an integral with no differential stays', () => {
    expect(raw('\\int_0^1 x \\cdot d')).toEqual([
      'Integrate',
      ['Multiply', 'x', 'd'],
      ['Tuple', 'Nothing', 0, 1],
    ]);
  });

  test('a d after the last differential of a double integral stays', () => {
    expect(raw('\\iint f\\,dx\\,d')).toEqual([
      'InvisibleOperator',
      ['Integrate', 'f', 'x'],
      ['HorizontalSpacing', 3],
      'd',
    ]);
  });

  test('a d with a subscript or a superscript is not a differential', () => {
    expect(raw('\\int_0^1 \\frac{x\\,dx}{2} + 1 \\cdot d_1')).toEqual([
      'Add',
      [
        'Integrate',
        ['Divide', ['InvisibleOperator', 'x', ['HorizontalSpacing', 3]], 2],
        ['Tuple', 'x', 0, 1],
      ],
      ['Multiply', 1, 'd_1'],
    ]);
    expect(raw('\\int_0^1 x\\,d^2')).toEqual([
      'Integrate',
      [
        'InvisibleOperator',
        'x',
        ['HorizontalSpacing', 3],
        ['Power', 'd', 2],
      ],
      ['Tuple', 'Nothing', 0, 1],
    ]);
  });

  test('a free d after the integrand keeps its diagnostic', () => {
    const dStarts = (latex: string) =>
      (new ComputeEngine().parse(latex, { diagnostics: true })
        .parseDiagnostics ?? [])
        .filter(
          (d) => d.code === 'undeclared-symbol' && d.detail?.name === 'd'
        )
        .map((d) => d.start);
    // The `d` of the differential has no diagnostic, the free `d` has one.
    const sum = '\\int \\left(\\frac{x\\,dx}{2}\\right) + d';
    const sumStarts = dStarts(sum);
    expect(sumStarts).toHaveLength(1);
    expect(sumStarts[0]).toBeGreaterThan(sum.indexOf('\\right'));
    // A null delimiter and a group that the parser does not keep do not hide
    // the free `d`.
    const open = '\\int \\left(\\frac{x\\,dx}{2}\\right. + \\frac{d}{2}';
    const openStarts = dStarts(open);
    expect(openStarts).toHaveLength(1);
    expect(openStarts[0]).toBeGreaterThan(open.indexOf('\\right'));
    const group = '\\int {\\frac{x\\,dx}{2} + d}';
    const groupStarts = dStarts(group);
    expect(groupStarts).toHaveLength(1);
    expect(groupStarts[0]).toBeGreaterThan(group.indexOf('+'));
  });

  test('a differential after a cdot or a space is still a differential', () => {
    expect(raw('\\int x \\cdot dx')).toEqual(['Integrate', 'x', 'x']);
    expect(raw('\\int x \\, \\mathrm{d}x')).toEqual(['Integrate', 'x', 'x']);
    expect(raw('\\int x\\,d\\theta')).toEqual(['Integrate', 'x', 'theta']);
    expect(raw('\\iint xy\\,dx\\,dy')).toEqual([
      'Integrate',
      ['InvisibleOperator', 'x', 'y'],
      'y',
      'x',
    ]);
  });
});
