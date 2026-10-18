import { ComputeEngine } from '../../src/compute-engine';

// Under `.N()`, an exact non-integer operand of an elementary function
// (`1/3`, `√2`, `e`) is read with guard digits: its float at the working
// precision has a rounding error that reached the last digit of the result
// (`Ln(1/3).N()` at 50 digits ended in `…228`, not `…227`). A float or an
// integer operand has no such error and is read as it is.
//
// The expected values are the values of mpmath 1.3.0 at 90 digits, rounded
// to the working precision (`mp.nstr(value, 50)`, `mp.nstr(value, 21)`).
// Each value was wrong in its last digit before the change.

const ce = new ComputeEngine();
ce.precision = 50;

function n(json: unknown): string {
  return ce
    .box(json as any)
    .N()
    .toString();
}

describe('AN ELEMENTARY FUNCTION OF AN EXACT OPERAND UNDER N() IS CORRECTLY ROUNDED', () => {
  test.each([
    [
      ['Ln', ['Rational', 1, 3]],
      '-1.0986122886681096913952452369225257046474905578227',
    ],
    [
      ['Ln', ['Rational', 5, 9]],
      '-0.58778666490211900818973114061886376976937976137698',
    ],
    [
      ['Exp', ['Rational', 2, 7]],
      '1.3307121974473499773031853365782988606137411883549',
    ],
    [
      ['Log', ['Rational', 2, 7]],
      '-0.54406804435027563549847736386814316671538251486186',
    ],
    [
      ['Log', ['Rational', 5, 9], 2],
      '-0.84799690655495001503715845840624284165479742236038',
    ],
    [
      ['Tan', ['Rational', 5, 9]],
      '0.62077529536454345886555359820484897930467410620782',
    ],
    [
      ['Csc', ['Rational', 3, 13]],
      '4.3720351832105790834416148581719681679257390188615',
    ],
    [
      ['Cot', ['Rational', 2, 7]],
      '3.4042395394717525492970059995303570413048199364072',
    ],
    [
      ['Sinh', ['Rational', 7, 11]],
      '0.68019188361512869869827811426831256129805310833167',
    ],
    [
      ['Cosh', ['Rational', 5, 9]],
      '1.1583312096854452973998133862781895995809836291802',
    ],
    [
      ['Tanh', ['Rational', 2, 7]],
      '0.27818549032570244047180008724146610677969449455154',
    ],
    [
      ['Sech', ['Rational', 1, 3]],
      '0.94690525376349792655895228013981164719686555412721',
    ],
    [
      ['Csch', ['Rational', 3, 13]],
      '4.2951094225364483122194714762763937462727854235997',
    ],
    [
      ['Coth', ['Rational', 2, 7]],
      '3.5947237896167398554820029135024718797707810270287',
    ],
    [
      ['Arcsin', ['Rational', 1, 3]],
      '0.33983690945412193709639251339176406638824469033246',
    ],
    [
      ['Arccos', ['Rational', 7, 11]],
      '0.88102132600939695912128557167084691864188521883698',
    ],
    [
      ['Arctan', ['Rational', 2, 7]],
      '0.27829965900511135132823027023266975751327061557555',
    ],
    [
      ['Arsinh', ['Rational', 1, 3]],
      '0.32745015023725844332253525998825812770052452899077',
    ],
    [
      ['Artanh', ['Rational', 2, 7]],
      '0.29389333245105950409486557030943188488468988068849',
    ],
    [
      ['Arcosh', ['Rational', 4, 3]],
      '0.79536546122390563052789093314780630097658256371437',
    ],
    [
      ['Arcsec', ['Rational', 11, 7]],
      '0.88102132600939695912128557167084691864188521883698',
    ],
    [
      ['Arccsc', ['Rational', 4, 3]],
      '0.84806207898148100805294433899841808007336621326311',
    ],
    [
      ['Arcoth', ['Rational', 11, 7]],
      '0.75203869838813703668662917619343742060974049064262',
    ],
    [
      ['Sinc', ['Rational', 3, 13]],
      '0.99114786403689796760936291343323485413043212888633',
    ],
    [
      ['Root', ['Rational', 2, 7], 3],
      '0.65863375600834950995352801399152499035691079985883',
    ],
    [
      ['Arctan2', ['Rational', 7, 11], ['Rational', 5, 7]],
      '0.72776973591997434616654689862565060017167220497557',
    ],
    [
      ['Sin', ['Sqrt', 2]],
      '0.98776594599273552706913407207894265590679312951604',
    ],
    [
      ['Ln', ['Add', 1, ['Sqrt', 2]]],
      '0.88137358701954302523260932497979230902816032826164',
    ],
    [
      ['Sinh', 'ExponentialE'],
      '7.5441371028169758263418200425165327402949857443017',
    ],
    [
      ['Power', ['Sqrt', 2], ['Sqrt', 3]],
      '1.8226346549662422143937682155941423788288842047026',
    ],
  ])('%j at 50 digits', (json, expected) => {
    expect(n(json)).toBe(expected);
  });

  test.each([
    [['Haversine', ['Rational', 1, 3]], '0.0275215268426311678059'],
    [['Power', 2, ['Rational', 7, 11]], '1.55440628177091931958'],
    [
      ['Power', ['Rational', 1, 3], ['Rational', 2, 3]],
      '0.480749856769136127441',
    ],
    [
      ['Exp', ['Divide', ['Ln', ['Rational', 1, 3]], 3]],
      '0.693361274350634704843',
    ],
  ])('%j at 21 digits', (json, expected) => {
    const saved = ce.precision;
    ce.precision = 21;
    try {
      expect(n(json)).toBe(expected);
    } finally {
      ce.precision = saved;
    }
  });

  test('the parse route', () => {
    expect(ce.parse('\\ln\\frac{1}{3}').N().toString()).toBe(
      '-1.0986122886681096913952452369225257046474905578227'
    );
    expect(ce.parse('\\arctan\\frac{2}{7}').N().toString()).toBe(
      '0.27829965900511135132823027023266975751327061557555'
    );
  });

  test('a float operand is read as it is', () => {
    // The float `0.3` is the value of the operand: its digits are not
    // read again.
    expect(n(['Sin', 0.3])).toBe(ce.number(ce.bignum('0.3').sin()).toString());
  });

  test('evaluate() keeps an exact operand symbolic', () => {
    expect(ce.box(['Ln', ['Rational', 1, 3]]).evaluate().operator).toBe('Ln');
    expect(ce.box(['Sin', ['Rational', 1, 3]]).evaluate().operator).toBe('Sin');
  });

  test('exact special values stay exact values', () => {
    expect(n(['Sin', ['Divide', 'Pi', 6]])).toBe('0.5');
    expect(n(['Ln', 1])).toBe('0');
    expect(n(['Sqrt', ['Rational', 1, 4]])).toBe('0.5');
  });

  test('a user declaration of ExponentialE is not e in a power', () => {
    // `e^y` under `.N()` is computed as `exp(y)` only when the base is the
    // library constant `e`. A nested-scope declaration of the name with
    // another value is a number like any other: 2.7185^2 = 7.39024225.
    ce.pushScope();
    try {
      ce.declare('ExponentialE', { value: 2.7185 });
      expect(n(['Power', 'ExponentialE', 2])).toBe('7.39024225');
    } finally {
      ce.popScope();
    }
    expect(n(['Power', 'ExponentialE', 2])).toBe(
      ce.number(ce.bignum(2).exp()).toString()
    );
  });

  test('a nested call does not read its operands again at each level', () => {
    // Each level of guard digits approximated its operand again, and that
    // operand approximated its own operand again: the cost doubled with
    // each level (18 levels of `Erf` took about 25 s). A call inside a
    // guarded evaluation does not add guard digits again.
    let json: unknown = ['Rational', 1, 3];
    for (let i = 0; i < 18; i++) json = ['Erf', json];
    const start = Date.now();
    expect(ce.box(json as any).N().isFinite).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('GUARD DIGITS ON TWO ENGINES', () => {
  test('a guarded evaluation does not remove the guard digits of another engine', () => {
    // `Sin(G(1/3)).N()` on `a` approximates `G(1/3)` again with guard
    // digits, at 60 digits. The handler of `G` evaluates on `b`, whose
    // precision is 60 digits too. Before, the record of the guarded
    // evaluation was shared by the engines, and `b` took its own evaluations
    // as already guarded: some of the values lost their last digit.
    const a = new ComputeEngine();
    const b = new ComputeEngine();
    a.precision = 50;
    b.precision = 60;
    const operands = [
      [1, 3],
      [5, 9],
      [2, 7],
      [3, 13],
      [7, 11],
      [4, 9],
      [10, 11],
      [1, 7],
      [13, 17],
      [5, 6],
    ];
    const ln = (p: number, q: number) =>
      b
        .box(['Ln', ['Rational', p, q]])
        .N()
        .toString();
    let inside: string[] = [];
    a.declare('G', {
      signature: '(number) -> number',
      pure: true,
      evaluate: (ops, { numericApproximation }) => {
        if (numericApproximation) inside = operands.map(([p, q]) => ln(p, q));
        return ops[0];
      },
    });
    a.box(['Sin', ['G', ['Rational', 1, 3]]]).N();
    expect(inside).toEqual(operands.map(([p, q]) => ln(p, q)));
  });
});
