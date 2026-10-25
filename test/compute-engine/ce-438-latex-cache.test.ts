import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

// ROADMAP CE-438 (Tycho row 444): the `latex` getter keeps its string for a
// boxed expression (`latexStrings`, src/compute-engine/boxed-expression/
// abstract-boxed-expression.ts) until the engine changes in a way that can
// change it; and the prettified MathJSON skips the fraction split of a
// product with no factor that can go to a denominator
// (`mayContributeDenominator`, src/compute-engine/boxed-expression/
// serialize.ts).

/** An engine whose LaTeX serializer counts its calls. */
function countingEngine(): { ce: ComputeEngine; calls: () => number } {
  const ce = new ComputeEngine();
  const syntax = (ce as any)._requireLatexSyntax();
  const serialize = syntax.serialize.bind(syntax);
  let n = 0;
  syntax.serialize = (...args: unknown[]) => {
    n++;
    return serialize(...args);
  };
  return { ce, calls: () => n };
}

describe('CE-438: the latex getter keeps its string', () => {
  test('a second read does not serialize again', () => {
    const { ce, calls } = countingEngine();
    const e = ce.parse('\\frac{a}{2}+3\\cos(\\frac{\\pi}{50})');
    const first = e.latex;
    const n = calls();
    expect(e.latex).toBe(first);
    expect(calls()).toBe(n);
  });

  test('a change of the LaTeX options in place is seen', () => {
    const { ce } = countingEngine();
    const e = ce.box(['Multiply', 1.25, 'q']);
    expect(e.latex).toBe('1.25q');
    ce.latexOptions.decimalSeparator = '{,}';
    expect(e.latex).toBe('1{,}25q');
    ce.latexOptions = { ...ce.latexOptions, decimalSeparator: '.' };
    expect(e.latex).toBe('1.25q');
  });

  test('entries added to the LaTeX dictionary are seen', () => {
    const ce = new ComputeEngine();
    ce.declare('Twice', '(number) -> number');
    const e = ce.box(['Twice', 'x']);
    const before = e.latex;
    ce.latexSyntax!.addEntries!([
      {
        name: 'Twice',
        serialize: (serializer, expr) =>
          `\\operatorname{twice}(${serializer.serialize((expr as unknown[])[1] as never)})`,
      },
    ]);
    expect(e.latex).not.toBe(before);
    expect(e.latex).toBe('\\operatorname{twice}(x)');
  });

  test('a string read in one scope is not served in another', () => {
    // In a scope where `Abs` is a function of the user's, cardinality bars
    // would parse as that function, so `Count(S)` is written in full there.
    const ce = new ComputeEngine();
    ce.declare('S', 'set<integer>');
    ce.pushScope();
    ce.declare('Abs', 'function');
    const scope = ce.context.lexicalScope;
    ce.popScope();
    const e = ce.box(['Count', 'S']);
    const global = e.latex;
    ce.pushScope(scope);
    expect(e.latex).toBe(e.toLatex());
    expect(e.latex).not.toBe(global);
    ce.popScope();
    expect(e.latex).toBe(global);
  });

  test('an array option changed in place is seen', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = {
      ...ce.latexOptions,
      digitGroupSeparator: ['\\,', '\\,'],
    };
    const e = ce.box(['Multiply', 1234567.25, 'q']);
    const before = e.latex;
    (ce.latexOptions.digitGroupSeparator as string[])[0] = '{,}';
    expect(e.latex).toBe(e.toLatex());
    expect(e.latex).not.toBe(before);
  });

  test('an expression that holds an object is not kept', () => {
    const ce = new ComputeEngine();
    const { value } = executeEpsil(
      ce,
      'type Point = object{x: real, y: real}\nlet p = Point(x: 1, y: 2)\np'
    );
    const before = value.latex;
    executeEpsil(ce, 'p.x = 5');
    expect(value.latex).not.toBe(before);
  });

  test('a declaration serializes again', () => {
    const { ce, calls } = countingEngine();
    const e = ce.parse('x+1');
    e.latex;
    const n = calls();
    ce.declare('y', 'integer');
    e.latex;
    expect(calls()).toBe(n + 1);
  });

  test('an assumption and a precision change serialize again', () => {
    const { ce, calls } = countingEngine();
    const e = ce.parse('x-1');
    e.latex;
    let n = calls();
    ce.assume(ce.parse('x > 0'));
    e.latex;
    expect(calls()).toBe(n + 1);
    n = calls();
    ce.precision = 30;
    e.latex;
    expect(calls()).toBe(n + 1);
  });

  test('a lazy collection that materializes is not kept', () => {
    const { ce } = countingEngine();
    ce.assign('n', 3);
    // `Reverse` is printed as the list it gives (it is not one of the lazy
    // heads printed in operator form), so its string reads `n`.
    const e = ce.box(['Reverse', ['List', 1, 2, 'n']]);
    expect(e.latex).toBe('\\bigl\\lbrack3, 2, 1\\bigr\\rbrack');
    ce.assign('n', 4);
    expect(e.latex).toBe('\\bigl\\lbrack4, 2, 1\\bigr\\rbrack');
  });
});

describe('CE-438: a product with no denominator', () => {
  test.each([
    ['3\\cos(x)', '3\\cos(x)'],
    ['3xy', '3xy'],
    ['x^2y', 'yx^2'],
    ['\\frac{a}{2}', '\\frac{a}{2}'],
    ['\\frac{3x}{y}', '\\frac{3x}{y}'],
    ['x^{-2}y', '\\frac{y}{x^2}'],
    ['x^ny', 'yx^{n}'],
    // `Product` splits the base of a power: these are fractions.
    ['y\\cdot(\\frac{1}{x})^2', '\\frac{y}{x^2}'],
    ['y\\cdot(\\frac{a}{x})^2', '\\frac{ya^2}{x^2}'],
  ])('%s is written %s, as before', (input, expected) => {
    expect(new ComputeEngine().parse(input).latex).toBe(expected);
  });
});
