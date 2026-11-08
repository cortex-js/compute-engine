import { ComputeEngine } from '../../src/compute-engine';

//
// THE CANONICAL SUM OF A REAL NUMBER AND AN IMAGINARY NUMBER ABOVE MACHINE
// PRECISION
//
// The canonical form of a sum combines the real number literals and the
// pure-imaginary number literals into one complex literal (`canonicalAdd()`,
// `boxed-expression/arithmetic-add.ts`). Above machine precision, an inexact
// imaginary part is a big decimal. The sum of the imaginary parts is a big
// decimal when a part is one: its double keeps only about 16 digits. These
// tests hold that the complex literal keeps every digit of each part.
//

const BIG = '0.123456789012345678901234567';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 30;
  return ce;
}

describe('CE-1096: A REAL NUMBER PLUS AN IMAGINARY NUMBER AT PRECISION 30', () => {
  test('the parsed sum keeps every digit of the imaginary part', () => {
    const ce = engine();
    expect(ce.parse(`1+${BIG}i`).json).toEqual([
      'Complex',
      1,
      { num: BIG },
    ]);
  });

  test('the MathJSON sum keeps every digit of the imaginary part', () => {
    const ce = engine();
    expect(
      ce.box(['Add', 1, ['Complex', 0, { num: BIG }]]).json
    ).toEqual(['Complex', 1, { num: BIG }]);
  });

  test('a big real part and a big imaginary part both keep their digits', () => {
    const ce = engine();
    expect(ce.parse(`1.000000000000000000000000001+${BIG}i`).json).toEqual([
      'Complex',
      { num: '1.000000000000000000000000001' },
      { num: BIG },
    ]);
  });

  test('a subtracted imaginary part keeps every digit', () => {
    const ce = engine();
    expect(ce.parse(`1-${BIG}i`).json).toEqual([
      'Complex',
      1,
      { num: `-${BIG}` },
    ]);
  });

  test('the imaginary parts are added as big decimals', () => {
    const ce = engine();
    // An integer imaginary part (`2i`) is added to the big decimal part.
    expect(ce.parse(`0.5+${BIG}i+2i`).json).toEqual([
      'Complex',
      0.5,
      { num: '2.123456789012345678901234567' },
    ]);
    // Two big decimal imaginary parts, with no real part.
    expect(ce.parse(`${BIG}i+0.1i`).json).toEqual([
      'Complex',
      0,
      { num: '0.223456789012345678901234567' },
    ]);
  });

  test('an integer imaginary part before a big decimal part is added exactly', () => {
    const ce = engine();
    expect(
      ce.box([
        'Add',
        0.5,
        ['Complex', 0, 2],
        ['Complex', 0, { num: BIG }],
      ]).json
    ).toEqual(['Complex', 0.5, { num: '2.123456789012345678901234567' }]);
  });

  test('an imaginary part too small for a double is kept', () => {
    // The double of `1e-400` is 0, but its big decimal is not.
    const ce = engine();
    expect(
      ce.box(['Add', 0.5, ['Complex', 0, { num: '1e-400' }]]).json
    ).toEqual(['Complex', 0.5, { num: '1e-400' }]);
  });

  test('big imaginary parts with a zero sum leave no complex term', () => {
    const ce = engine();
    expect(ce.parse(`x+${BIG}i-${BIG}i`).json).toEqual('x');
    expect(ce.parse(`x+1.1+${BIG}i-${BIG}i`).json).toEqual(['Add', 'x', 1.1]);
  });

  test('at machine precision the imaginary part is a double', () => {
    const ce = new ComputeEngine({ precision: 'machine' });
    expect(ce.parse('1+0.1i').json).toEqual(['Complex', 1, 0.1]);
    expect(ce.parse(`1+${BIG}i`).json).toEqual([
      'Complex',
      1,
      0.12345678901234568,
    ]);
  });
});
