import { engine as ce } from '../../utils';

const parse = (s: string) => ce.parse(s, { canonical: false });
const json = (s: string) => JSON.stringify(parse(s).json);

describe('PIPELINE OPERATOR — bare function references', () => {
  // A function name with nothing following is a bare *reference* (not an
  // application with a missing argument), so it can be the right-hand side of
  // a pipeline. This must hold for the functions with custom parsers too
  // (`\ln`, `\log`, `\sqrt`), which historically grabbed a phantom argument.
  test.each([
    ['\\sin', 'Sin'],
    ['\\cos', 'Cos'],
    ['\\lg', 'Lg'],
    // `\lb` is the *binary* log: the bare reference is `Lb`, not `Log`
    // (base 10), so `12 |> \lb` computes log₂ 12.
    ['\\lb', 'Lb'],
    ['\\ln', 'Ln'],
    ['\\log', 'Log'],
    ['\\sqrt', 'Sqrt'],
  ])('%s parses to a bare function symbol', (latex, expected) => {
    expect(parse(latex).json).toEqual(expected);
    expect(parse(latex).isValid).toBe(true);
  });

  // An *explicit* missing argument is still an error (the reference behavior
  // is only for "nothing follows").
  test('explicit empty radical is still a missing-argument error', () => {
    expect(json('\\sqrt{}')).toBe(`["Sqrt",["Error","'missing'"]]`);
    expect(json('\\sqrt[3]')).toBe(`["Root",["Error","'missing'"],3]`);
  });

  // A log with a base but no argument is not a plain symbol: the topic
  // marker `\square` stands in for the argument, so a pipeline can fill the
  // hole and a standalone `\log_2` displays as `\log_2(\square)`.
  test('a based log with no argument holds a topic-marker hole', () => {
    expect(json('\\log_2')).toBe(`["Lb","topic_marker"]`);
    expect(json('\\log_5')).toBe(`["Log","topic_marker",5]`);
    expect(ce.parse('\\log_2').latex).toBe('\\log_{2}(\\square)');
  });

  test('piping into a based log fills the topic-marker hole', () => {
    expect(json('8|>\\log_2')).toBe(`["Lb",8]`);
    expect(ce.parse('8|>\\log_2').evaluate().json).toEqual(3);
    expect(ce.parse('9|>\\log_3^{-1}').evaluate().json).toEqual(19683);
    expect(json('|>\\log_2')).toBe(`["Function",["Lb","_"],"_"]`);
  });

  // A function with a superscript but no argument (`\cos^2`, `\ln^{-1}`)
  // also holds a topic-marker hole (a bare `Power(Cos, 2)` would treat the
  // function symbol as a number and fail to type).
  test('a superscripted function with no argument holds a topic-marker hole', () => {
    expect(json('\\cos^2')).toBe(`["Power",["Cos","topic_marker"],2]`);
    expect(ce.parse('4|>\\cos^2', { canonical: false }).json).toEqual([
      'Power',
      ['Cos', 4],
      2,
    ]);
    expect(json('12|>\\ln^2')).toBe(`["Power",["Ln",12],2]`);
    expect(ce.parse('12|>\\ln^{-1}').evaluate().latex).toBe(
      '\\exponentialE^{12}'
    );
    expect(ce.parse('100|>\\lg^{-1}').evaluate().json).toEqual({
      num: '1e+100',
    });
    // The InverseFunction route is unaffected
    expect(ce.parse('1|>\\sin^{-1}').evaluate().latex).toBe('\\frac{\\pi}{2}');
  });
});

describe('PIPELINE OPERATOR — infix `x |> f`', () => {
  test.each(['\\rhd', '\\triangleright', '\\vartriangleright', '|>', '⊳'])(
    'infix %s applies the RHS function to the LHS',
    (op) => {
      expect(json(`2${op}\\ln`)).toBe(`["Pipe",2,"Ln"]`);
      expect(json(`9${op}\\sqrt`)).toBe(`["Pipe",9,"Sqrt"]`);
    }
  );

  test('infix pipeline evaluates', () => {
    expect(ce.parse('9\\rhd\\sqrt').evaluate().json).toEqual(3);
    expect(ce.parse('e\\rhd\\ln').evaluate().json).toEqual(1);
  });

  test('a non-function RHS remains an inert Pipe', () => {
    expect(parse('5|>3').json).toEqual(['Pipe', 5, 3]);
    expect(parse('5|>3').evaluate().json).toEqual(['Pipe', 5, 3]);
  });
});

describe('PIPELINE OPERATOR — prefix `|> f` (anonymous unary function)', () => {
  test.each(['\\rhd', '\\triangleright', '\\vartriangleright', '|>', '⊳'])(
    'prefix %s builds a unary lambda over the topic',
    (op) => {
      expect(json(`${op}\\ln`)).toBe(`["Function",["Pipe","_","Ln"],"_"]`);
    }
  );

  // The intended usage: the caller applies the lambda to the value it wants to
  // pipe in (e.g. a notebook's previous answer).
  test('the prefix lambda applies to a supplied argument', () => {
    const lambda = parse('\\rhd\\ln').json;
    expect(ce.box(['Apply', lambda, 'ExponentialE']).evaluate().json).toEqual(1);

    const sqrtLambda = parse('\\rhd\\sqrt').json;
    expect(ce.box(['Apply', sqrtLambda, 9]).evaluate().json).toEqual(3);
  });
});
