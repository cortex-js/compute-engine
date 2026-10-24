/**
 * ROADMAP CE-403 (Tycho row 431): the structural form of `ce.parse()` leaves
 * out a spacing command (`\,`, `\;`, `\quad`, …) between the operands of a
 * juxtaposition.
 *
 * A spacing command parses to a one-operand `HorizontalSpacing`. The
 * canonical form dropped it, but the structural form kept it as an operand
 * of an `InvisibleOperator`, so the shape depended on where the space was:
 * `\,d=2` was `["Equal", ["InvisibleOperator", ["HorizontalSpacing", 3],
 * "d"], 2]` while `d=\,2` was `["Equal", "d", 2]`. Tycho reads the structural
 * form to recognize `name = body`, and the row `\,d=2` did not define `d`.
 * The raw form keeps the node, so the LaTeX can be read back as written.
 */
import { ComputeEngine } from '../../../src/compute-engine';
import { dropSpacingOperands } from '../../../src/compute-engine/latex-syntax/drop-spacing-operands';

const ce = new ComputeEngine();
const structural = (latex: string) =>
  ce.parse(latex, { form: 'structural' }).json;
const raw = (latex: string) => ce.parse(latex, { form: 'raw' }).json;

describe('CE-403: A SPACING COMMAND IN THE STRUCTURAL FORM', () => {
  test.each([
    ['\\,d=2', ['Equal', 'd', 2]],
    ['d\\,=2', ['Equal', 'd', 2]],
    ['\\quad d=2', ['Equal', 'd', 2]],
    ['\\,\\,d=2', ['Equal', 'd', 2]],
    ['x\\,+\\,y', ['Add', 'x', 'y']],
    ['y=\\sqrt{\\,x}', ['Equal', 'y', ['Sqrt', 'x']]],
    ['x\\,', 'x'],
    // Spaces the parser already skipped: the controls of the row.
    ['\\ d=2', ['Equal', 'd', 2]],
    ['d=\\,2', ['Equal', 'd', 2]],
  ])('%s', (latex, expected) => {
    expect(structural(latex)).toEqual(expected);
  });

  test('a juxtaposition of two operands stays one', () => {
    expect(structural('a\\,b')).toEqual(['InvisibleOperator', 'a', 'b']);
    expect(structural('12\\,\\mathrm{cm}')).toEqual([
      'InvisibleOperator',
      12,
      ['__unit__', 'cm'],
    ]);
    expect(ce.parse('12\\,\\mathrm{cm}').json).toEqual(['Quantity', 12, 'cm']);
  });

  test('a space still separates tokens', () => {
    // `x\,.75e2` is `x` times `75`, not the symbol `x.75e2`.
    expect(structural('x\\,.75e2')).toEqual([
      'InvisibleOperator',
      'x',
      { num: '75.0' },
    ]);
  });

  test('a spacing command alone is kept', () => {
    expect(structural('\\,')).toEqual(['HorizontalSpacing', 3]);
  });

  test('the raw form keeps the spacing command', () => {
    expect(raw('\\,d=2')).toEqual([
      'Equal',
      ['InvisibleOperator', ['HorizontalSpacing', 3], 'd'],
      2,
    ]);
    expect(raw('x\\, y')).toEqual([
      'InvisibleOperator',
      'x',
      ['HorizontalSpacing', 3],
      'y',
    ]);
  });

  test('the operands of Hold are kept as written', () => {
    expect(structural('\\mathrm{Hold}(x\\,y)')).toEqual([
      'Hold',
      ['InvisibleOperator', 'x', ['HorizontalSpacing', 3], 'y'],
    ]);
  });

  test('the operand that replaces the juxtaposition keeps its LaTeX', () => {
    const e = ce.parse('\\,x', {
      form: 'structural',
      preserveLatex: true,
    } as any);
    expect(e.json).toEqual('x');
    expect(e.verbatimLatex).toBe('\\,x');
  });

  test('the parsed MathJSON is not changed', () => {
    // A dictionary entry can return the same MathJSON on every parse.
    const json = [
      'Equal',
      ['InvisibleOperator', 'x', ['HorizontalSpacing', 3], 'y'],
      { fn: ['InvisibleOperator', ['HorizontalSpacing', 3], 'z'], latex: 'z' },
    ];
    const copy = JSON.parse(JSON.stringify(json));
    expect(dropSpacingOperands(json as any)).toEqual([
      'Equal',
      ['InvisibleOperator', 'x', 'y'],
      { sym: 'z', latex: 'z' },
    ]);
    expect(json).toEqual(copy);
    const unchanged = ['Add', 'x', 1];
    expect(dropSpacingOperands(unchanged as any)).toBe(unchanged);
  });

  test('a deep tree does not grow the stack', () => {
    const latex = Array.from({ length: 5000 }, (_, i) => `${i}`).join('-');
    expect(() => ce.parse(latex, { form: 'structural' })).not.toThrow();
  });
});
