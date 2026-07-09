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
});

describe('PIPELINE OPERATOR — infix `x |> f`', () => {
  test.each(['\\rhd', '\\triangleright', '\\vartriangleright', '|>', '⊳'])(
    'infix %s applies the RHS function to the LHS',
    (op) => {
      expect(json(`2${op}\\ln`)).toBe(`["Apply","Ln",2]`);
      expect(json(`9${op}\\sqrt`)).toBe(`["Apply","Sqrt",9]`);
    }
  );

  test('infix pipeline evaluates', () => {
    expect(ce.parse('9\\rhd\\sqrt').evaluate().json).toEqual(3);
    expect(ce.parse('e\\rhd\\ln').evaluate().json).toEqual(1);
  });
});

describe('PIPELINE OPERATOR — prefix `|> f` (anonymous unary function)', () => {
  test.each(['\\rhd', '\\triangleright', '\\vartriangleright', '|>', '⊳'])(
    'prefix %s builds a unary lambda over the topic',
    (op) => {
      expect(json(`${op}\\ln`)).toBe(`["Function",["Apply","Ln","_"],"_"]`);
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
