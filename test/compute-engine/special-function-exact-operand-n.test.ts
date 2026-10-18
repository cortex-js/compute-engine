import { ComputeEngine } from '../../src/compute-engine';

// Under `.N()`, an exact operand of a special function (`1/3`, `√2`, `π`)
// is read with guard digits: its float at the working precision has a
// rounding error that reached the last digit of the result
// (`Digamma(1/3).N()` at 50 digits ended in `…67205`, not `…67204`).
//
// The expected values are the values of mpmath 1.3.0 at 90 digits, rounded
// to 50 significant digits (`mp.nstr(value, 50)`).

const ce = new ComputeEngine();
ce.precision = 50;

describe('A SPECIAL FUNCTION OF AN EXACT OPERAND UNDER N() IS CORRECTLY ROUNDED', () => {
  test.each([
    [
      ['HurwitzZeta', 3, ['Rational', 1, 3]],
      '27.561061199700803776227877977407509284542095313015',
    ],
    [
      ['Zeta', 3, ['Rational', 1, 3]],
      '27.561061199700803776227877977407509284542095313015',
    ],
    [
      ['Digamma', ['Rational', 1, 3]],
      '-3.1320337800208063229964190742872688541554282967204',
    ],
    [
      ['Digamma', ['Rational', 13, 9]],
      '-0.016764187562898786564637549137761601808831495713638',
    ],
    [
      ['PolyGamma', 2, ['Rational', 1, 3]],
      '-55.12212239940160755245575595481501856908419062603',
    ],
    [
      ['Trigamma', ['Rational', 5, 3]],
      '0.81387540935871740998731723327568515323269509037341',
    ],
    [
      ['Zeta', ['Rational', 5, 3]],
      '2.123522968857583491587372588971229538185549690215',
    ],
    [
      ['Gamma', ['Rational', 2, 7]],
      '3.1491151177599365909701136646807688922297786117663',
    ],
    [
      ['GammaLn', ['Rational', 5, 3]],
      '-0.10231483296064081330215029809233810090849725148419',
    ],
    [
      ['Beta', ['Rational', 1, 3], ['Rational', 1, 7]],
      '9.4313266448268391628913479193168289709720054121631',
    ],
    [
      ['LambertW', ['Rational', 2, 7]],
      '0.22756340548747214332407065484580349770262778945064',
    ],
    [
      ['Erf', ['Rational', 1, 3]],
      '0.36264811176606293340817864014786587969214159037254',
    ],
    [
      ['Erfi', ['Rational', 5, 3]],
      '6.924110923070113018522143922695204521032194898169',
    ],
    [
      ['FresnelS', ['Rational', 5, 3]],
      '0.58135680192883620902631589812128461220510851941667',
    ],
    [
      ['BarnesG', ['Rational', 1, 3]],
      '0.40007852309076820228501451526030455792303863082842',
    ],
    [
      ['LerchPhi', ['Rational', 1, 2], 2, ['Rational', 1, 3]],
      '9.3434746593759395185555496580352932655194073216458',
    ],
    [['Digamma', 'Pi'], '0.97721330794200673329206948640618234364083460999433'],
    [
      ['Zeta', ['Sqrt', 2]],
      '3.0207376794860326682709922837004090186536775964584',
    ],
    [
      ['EllipticK', ['Rational', 1, 3]],
      '1.7339168852579350250849223256686803776207956859453',
    ],
  ])('%j', (json, expected) => {
    expect(
      ce
        .box(json as any)
        .N()
        .toString()
    ).toBe(expected);
  });

  test('the parse route', () => {
    expect(ce.parse('\\zeta(3, \\frac{1}{3})').N().toString()).toBe(
      '27.561061199700803776227877977407509284542095313015'
    );
    expect(ce.parse('\\Gamma(\\frac{2}{7})').N().toString()).toBe(
      '3.1491151177599365909701136646807688922297786117663'
    );
  });

  test('evaluate() keeps an exact operand symbolic', () => {
    expect(ce.box(['Digamma', ['Rational', 1, 3]]).evaluate().operator).toBe(
      'Digamma'
    );
  });
});
