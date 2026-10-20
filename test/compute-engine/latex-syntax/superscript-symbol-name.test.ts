import { ComputeEngine } from '../../../src/compute-engine';

// A symbol name with a superscript part (`x__a`) is written in
// `\operatorname{}`, which reads back as the same symbol. Without it, `x^{a}`
// reads back as `Power(x, a)` and `\aleph^{+}` as `PseudoInverse(aleph)`.
//
// Inside `\operatorname{}`, the parser reads one superscript and one subscript
// after a base, and makes the name `base__sup_sub` whatever their order. A
// brace group is a base of its own, so the parts of the name are written in
// order with nested groups: `x_1__a` is `{x_1}^{a}`, and two superscripts are
// `{x^0}^{+}`, never the double superscript `x^0^+`.

const ce = new ComputeEngine();

function latexOf(name: string): string {
  return ce.symbol(name).latex;
}

function roundTrip(name: string): unknown {
  return ce.parse(ce.symbol(name).latex).json;
}

describe('SUPERSCRIPT SYMBOL NAME', () => {
  test.each([
    ['x__a', '\\operatorname{x^{a}}'],
    ['x__1', '\\operatorname{x^1}'],
    ['x__ab', '\\operatorname{x^{ab}}'],
    ['A__T', '\\operatorname{A^{T}}'],
    ['alpha__beta', '\\operatorname{\\alpha^{\\beta}}'],
    ['aleph__plus', '\\operatorname{\\aleph^{+}}'],
    ['x__star', '\\operatorname{x^{\\star}}'],
    ['mass__earth', '\\operatorname{mass^{earth}}'],
    // Two superscripts
    ['x__a__b', '\\operatorname{{x^{a}}^{b}}'],
    ['R_doublestruck__0__plus', '\\operatorname{{\\mathbb{R}^0}^{+}}'],
    // Subscripts and superscripts mixed
    ['x__a_1', '\\operatorname{x^{a}_1}'],
    ['x_1__a', '\\operatorname{{x_1}^{a}}'],
    ['x_1_2__a', '\\operatorname{{{x_1}_2}^{a}}'],
    ['x__a_1_2', '\\operatorname{{x^{a}_1}_2}'],
    ['x_1__a_2', '\\operatorname{{x_1}^{a}_2}'],
    ['speed__max_1', '\\operatorname{speed^{max}_1}'],
    // A style or an accent on the base
    ['x_bold__a', '\\operatorname{\\mathbf{x}^{a}}'],
    ['x_hat__a', '\\operatorname{\\hat{x}^{a}}'],
    ['x_prime__a', '\\operatorname{{x^{\\prime}}^{a}}'],
    // A style around the base and the parts before it
    ['x_1_bold__a', '\\operatorname{\\mathbf{x_1}^{a}}'],
    ['x__a_1_bold', '\\operatorname{\\mathbf{x^{a}_1}}'],
    ['x__10_bold', '\\operatorname{\\mathbf{x^{10}}}'],
    // A style on the superscript
    ['x__a_bold', '\\operatorname{x^{\\mathbf{a}}}'],
    // Trailing digits of the base are not a subscript
    ['x2__a', '\\operatorname{x2^{a}}'],
    // A wildcard name
    ['_x__a', '\\operatorname{\\_x^{a}}'],
    ['_x_1__a', '\\operatorname{{\\_x_1}^{a}}'],
    ['_x_bold__a', '\\operatorname{\\mathbf{\\_x}^{a}}'],
  ])('%s is written %s and reads back', (name, latex) => {
    expect(latexOf(name)).toBe(latex);
    expect(roundTrip(name)).toEqual(name);
  });

  test.each([
    'x__a_1_2_3',
    'x__a__b__c',
    'x_alpha__beta_gamma',
    'Gamma__2',
    'e__2',
    'pi__a',
    'x__a____002012',
    '____002012__a',
    'x_vec_bold__1',
    'x_bold__10_bold',
    '__x__a_1_2',
    'a__',
  ])('the symbol %s reads back as the same symbol', (name) => {
    expect(roundTrip(name)).toEqual(name);
  });

  test('the blackboard style reads back as the doublestruck style', () => {
    // `blackboard` and `doublestruck` are two names of the same style, and
    // the parser reads `\mathbb{}` as `doublestruck`.
    expect(roundTrip('R_blackboard__0__plus')).toEqual(
      'R_doublestruck__0__plus'
    );
  });

  test('the output has no double superscript or double subscript', () => {
    for (const name of [
      'x__a__b',
      'x_prime__a',
      'x_1_2__a',
      'x__a_1_2',
      'x__a_1__b',
    ]) {
      const latex = latexOf(name);
      expect(latex).not.toMatch(/\^(\{[^{}]*\}|[^{])\^/);
      expect(latex).not.toMatch(/_(\{[^{}]*\}|[^{])_/);
    }
  });

  test('a symbol with a superscript part reads back inside an expression', () => {
    for (const expr of [
      ['Power', 'x__a', 2],
      ['Multiply', 2, 'x__a'],
      ['Multiply', 'x__a', ['Add', 't', 1]],
      ['Add', 'mass__earth', 1],
      ['Prime', 'aleph__plus'],
      ['Sin', 'x_1__a'],
    ]) {
      const boxed = ce.box(expr);
      expect(ce.parse(boxed.latex).json).toEqual(boxed.json);
    }
  });

  test('a function with a superscript part in its name reads back', () => {
    const engine = new ComputeEngine();
    const expr = engine.box(['x__a', 't']);
    expect(expr.latex).toBe('\\operatorname{x^{a}}(t)');
    expect(engine.parse(expr.latex).json).toEqual(['x__a', 't']);
  });

  test('a superscript outside of a name is not changed', () => {
    expect(ce.parse('x^{a}').json).toEqual(['Power', 'x', 'a']);
    expect(ce.box(['Power', 'x', 'a']).latex).toBe('x^{a}');
    expect(ce.parse('x^{\\prime}').json).toEqual(['Prime', 'x']);
    expect(ce.box(['Prime', 'x']).latex).toBe('x^{\\prime}');
    expect(ce.box(['Derivative', 'f']).latex).toBe('f^{\\prime}');
  });

  test.each([
    ['_x_bold', '\\operatorname{\\mathbf{\\_x}}'],
    ['_x_hat', '\\operatorname{\\hat{\\_x}}'],
    ['_a_bold_1', '\\operatorname{\\mathbf{\\_a}_1}'],
    ['_x_1_bold', '\\operatorname{\\mathbf{\\_x_1}}'],
    ['_alpha_vec_bold', '\\operatorname{\\mathbf{\\vec{\\_\\alpha}}}'],
    ['_x_1', '\\operatorname{\\_x_1}'],
    ['_1_2', '\\operatorname{\\_1_2}'],
  ])(
    'the wildcard name %s is written %s, with the \\_ inside the style, and reads back',
    (name, latex) => {
      expect(latexOf(name)).toBe(latex);
      expect(roundTrip(name)).toEqual(name);
    }
  );

  test.each([
    ['x_bold_1_bold', '\\mathbf{\\mathbf{x}_1}'],
    ['x_italic_1_bold', '\\mathbf{\\mathit{x}_1}'],
    ['x_bold_1_2_bold', '\\mathbf{{\\mathbf{x}_1}_2}'],
  ])(
    'the name %s, with a style on the base and after a digit subscript, is written %s and reads back',
    (name, latex) => {
      expect(latexOf(name)).toBe(latex);
      expect(roundTrip(name)).toEqual(name);
    }
  );

  test.each([
    // An escape continues the part before it
    ['x_a____002012', 'x_{a\\unicode{"2012}}'],
    ['x_1____002012', 'x_{1\\unicode{"2012}}'],
    ['x__a____002012', '\\operatorname{x^{a\\unicode{"2012}}}'],
    ['x1____002012', '\\operatorname{x1\\unicode{"2012}}'],
    // A subscript that starts with an escape is not a superscript
    ['x_____002012', 'x_{\\unicode{"2012}}'],
    ['x_____002012_b', '{x_{\\unicode{"2012}}}_{b}'],
    ['x_b_____002012_c', '{{x_{b}}_{\\unicode{"2012}}}_{c}'],
    ['x_____002012__a', '\\operatorname{{x_{\\unicode{"2012}}}^{a}}'],
    ['x______002012', '\\operatorname{x^{\\unicode{"2012}}}'],
  ])(
    'the name %s with a unicode escape is written %s and reads back',
    (name, latex) => {
      expect(latexOf(name)).toBe(latex);
      expect(roundTrip(name)).toEqual(name);
    }
  );

  test.each([
    ['x_plus', '\\operatorname{x_{+}}'],
    ['x_minus', '\\operatorname{x_{-}}'],
    ['x_1_plus', '\\operatorname{{x_1}_{+}}'],
    ['x_a_dag', '\\operatorname{{x_{a}}_{\\dag}}'],
    ['x_star', '\\operatorname{x_{\\star}}'],
    ['x_circle', '\\operatorname{x_{\\circ}}'],
    ['x_plus_1', '\\operatorname{{x_{+}}_1}'],
    ['x_bold_plus', '\\operatorname{\\mathbf{x}_{+}}'],
    ['speed_1_plus', '\\operatorname{{speed_1}_{+}}'],
  ])(
    'the name %s, with a subscript part that is a symbol, is written %s and reads back',
    (name, latex) => {
      expect(latexOf(name)).toBe(latex);
      expect(roundTrip(name)).toEqual(name);
    }
  );

  test('the Subplus, Subminus and Substar operators are not changed', () => {
    expect(ce.box(['Subplus', 'x']).latex).toBe('x_+');
    expect(ce.parse('x_+').json).toEqual(['Subplus', 'x']);
    expect(ce.parse('x_{+}').json).toEqual(['Subplus', 'x']);
    expect(ce.box(['Subminus', 'x']).latex).toBe('x_-');
    expect(ce.parse('x_-').json).toEqual(['Subminus', 'x']);
    expect(ce.box(['Substar', 'x']).latex).toBe('x_\\star');
    expect(ce.parse('x_\\star').json).toEqual(['Substar', 'x']);
  });

  test.each([
    ['x_deg', '\\mathrm{x\\degree}'],
    ['x_deg_bold', '\\mathbf{x\\degree}'],
    ['x_deg__a', '\\operatorname{x\\degree^{a}}'],
  ])(
    'the name %s, with the deg accent, is written %s and reads back',
    (name, latex) => {
      expect(latexOf(name)).toBe(latex);
      expect(roundTrip(name)).toEqual(name);
    }
  );

  test('a degree sign outside of a name is not changed', () => {
    expect(ce.parse('x\\degree').json).toEqual(['Degrees', 'x']);
    expect(ce.parse('x^{\\circ}').json).toEqual(['Degrees', 'x']);
  });

  test('two digit subscripts with a style are written in order', () => {
    expect(latexOf('x_1_bold_1_bold')).toBe(
      '\\operatorname{\\mathbf{\\mathbf{x_1}_1}}'
    );
    expect(roundTrip('x_1_bold_1_bold')).toEqual('x_1_bold_1_bold');
  });

  test('a digit part with only the upright style is written without it', () => {
    // No spelling reads back as these names: see the comment of
    // `styledDigitSubscript()`. The nearest name is the one without
    // `_upright`.
    expect(latexOf('x__a_1_upright')).toBe('\\operatorname{x^{a}_1}');
    expect(latexOf('x__1_upright')).toBe('\\operatorname{x^1}');
  });

  test('a name without a superscript part is not changed', () => {
    expect(latexOf('x')).toBe('x');
    expect(latexOf('x_1')).toBe('x_1');
    expect(latexOf('speed_max')).toBe('\\mathrm{speed_{max}}');
    expect(latexOf('x_prime')).toBe('\\mathrm{x^{\\prime}}');
    expect(latexOf('alpha')).toBe('\\alpha');
    expect(ce.box('Pi').latex).toBe('\\pi');
    expect(ce.box('ExponentialE').latex).toBe('\\exponentialE');
    expect(ce.box('PositiveInfinity').latex).toBe('\\infty');
  });
});
