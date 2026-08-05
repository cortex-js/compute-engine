import { ComputeEngine } from '../../src/compute-engine';

//
// ATTRIBUTES-BAG ENCODING PARITY
//
// An attributes bag reaches an operator in either of two MathJSON dictionary
// encodings, and the boxer does NOT normalize their values:
//
//   ["Dictionary", ["KeyValuePair", "'constant'", "True"]]  → value is a SYMBOL
//   {dict: {constant: 'True'}}                              → value is a STRING
//   {dict: {constant: true}}                                → value is a SYMBOL
//
// (the `{dict: …}` shorthand reads a JS string as a STRING literal, so the
// unquoted `True` a host naturally writes there is NOT the `True` symbol).
//
// A reader that uses only one accessor therefore silently misreads one of the
// encodings. These tests pin all three spellings of each boolean-ish flag.
//

/** The three spellings of `key -> True`. */
const bags = (key: string, rest: Record<string, unknown> = {}): [string, any][] => [
  [
    'operator Dictionary (symbol value)',
    [
      'Dictionary',
      ['KeyValuePair', `'${key}'`, 'True'],
      ...Object.entries(rest).map(([k, v]) => ['KeyValuePair', `'${k}'`, v]),
    ],
  ],
  ['{dict: …} shorthand (string value)', { dict: { [key]: 'True', ...rest } }],
  ['{dict: …} shorthand (JS boolean)', { dict: { [key]: true, ...rest } }],
];

describe('Declare `constant` attribute — encoding parity', () => {
  for (const [label, attrs] of bags('constant', { value: 5 })) {
    test(`${label} declares a constant`, () => {
      const ce = new ComputeEngine();
      ce.box(['Declare', 'k', attrs]).evaluate();

      // A constant refuses reassignment; a plain variable accepts it.
      expect(() => ce.box(['Assign', 'k', 7]).evaluate()).toThrow();
      expect(ce.box('k').evaluate().isSame(5)).toBe(true);
    });
  }

  test('no `constant` entry leaves the symbol assignable', () => {
    const ce = new ComputeEngine();
    ce.box(['Declare', 'k', { dict: { value: 5 } }]).evaluate();
    ce.box(['Assign', 'k', 7]).evaluate();
    expect(ce.box('k').evaluate().isSame(7)).toBe(true);
  });
});

describe('DeclareType `alias` attribute — encoding parity', () => {
  for (const [label, attrs] of bags('alias')) {
    test(`${label} declares a structural alias`, () => {
      const ce = new ComputeEngine();
      ce.box([
        'DeclareType',
        "'pt'",
        "'tuple<integer, integer>'",
        attrs,
      ]).evaluate();
      // A structural alias is interchangeable with its definition; a NOMINAL
      // type (the default, i.e. a dropped `alias` flag) is not.
      expect(ce.type('pt').matches('tuple<integer, integer>')).toBe(true);
    });
  }

  test('no `alias` entry declares a NOMINAL type', () => {
    const ce = new ComputeEngine();
    ce.box(['DeclareType', "'pt'", "'tuple<integer, integer>'"]).evaluate();
    expect(ce.type('pt').matches('tuple<integer, integer>')).toBe(false);
  });
});

describe('Annotated `border` attribute — encoding parity', () => {
  for (const [label, style] of bags('border')) {
    test(`${label} emits \\boxed`, () => {
      const ce = new ComputeEngine();
      expect(ce.box(['Annotated', 'x', style]).latex).toBe('\\boxed{x}');
    });
  }
});
