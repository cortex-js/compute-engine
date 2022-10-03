import { Expression } from '../../src/math-json/math-json-format';
import { engine } from '../utils';

// engine.numericMode = 'decimal';
// engine.precision = 7;

// const a = engine.parse('\\frac{\\pi}{4}');
// console.log(a);

function N(s: string): Expression {
  return engine.parse(s).N().json;
}

describe('NUMERIC MODE auto 200', () => {
  beforeEach(() => {
    engine.numericMode = 'auto';
    engine.precision = 200;
  });

  test(`0.1 + 0.2`, () => expect(N('0.1 + 0.2')).toMatchInlineSnapshot(`0.3`));

  test(`\\sqrt{-1}`, () =>
    expect(N('\\sqrt{-1}')).toMatchInlineSnapshot(`{num: "NaN"}`));

  test(`\\frac{1}{7}`, () =>
    expect(N('\\frac{1}{7}')).toMatchInlineSnapshot(`{num: "0.(142857)"}`));

  test(`\\frac{\\pi}{4}`, () =>
    expect(N('\\frac{\\pi}{4}')).toMatchInlineSnapshot(`
      {
        num: "0.7853981633974483096156608458198757210492923498437764552437361480769541015715522496570087063355292669955370216283205766617734611523876455579313398520321202793625710256754846302763899111557372387325955"
      }
    `));

  test('e^{i\\pi}', () => expect(N('e^{i\\pi}')).toMatchInlineSnapshot(`-1`));
});

//
// Auto should use machine when possible, Decimal or Complex when necessary
//
describe('NUMERIC MODE auto 15', () => {
  beforeEach(() => {
    engine.numericMode = 'auto';
    engine.precision = 15;
  });

  test(`0.1 + 0.2`, () =>
    expect(N('0.1 + 0.2')).toMatchInlineSnapshot(`0.30000000000000004`));

  test(`\\sqrt{-1}`, () =>
    expect(N('\\sqrt{-1}')).toMatchInlineSnapshot(`{num: "NaN"}`)); // @todo

  // The precision of 15 is not enought to detect the repeating decimals
  test(`\\frac{1}{7}`, () =>
    expect(N('\\frac{1}{7}')).toMatchInlineSnapshot(`0.14285714285714285`));

  test(`\\frac{\\pi}{4}`, () =>
    expect(N('\\frac{\\pi}{4}')).toMatchInlineSnapshot(`0.7853981633974483`));

  test('', () => expect(N('e^{i\\pi}')).toMatchInlineSnapshot(`-1`));
});

describe('NUMERIC MODE machine', () => {
  beforeEach(() => {
    engine.numericMode = 'machine';
  });

  test(`0.1 + 0.2`, () =>
    expect(N('0.1 + 0.2')).toMatchInlineSnapshot(`0.30000000000000004`));

  test(`\\sqrt{-1}`, () =>
    expect(N('\\sqrt{-1}')).toMatchInlineSnapshot(`{num: "NaN"}`));

  test(`\\frac{1}{7}`, () =>
    expect(N('\\frac{1}{7}')).toMatchInlineSnapshot(`0.14285714285714285`));

  test(`\\frac{\\pi}{4}`, () =>
    expect(N('\\frac{\\pi}{4}')).toMatchInlineSnapshot(`0.7853981633974483`));

  test('', () => expect(N('e^{i\\pi}')).toMatchInlineSnapshot(`{num: "NaN"}`));
});

describe('NUMERIC MODE decimal 150', () => {
  beforeEach(() => {
    engine.numericMode = 'decimal';
    engine.precision = 150;
  });

  test(`0.1 + 0.2`, () => expect(N('0.1 + 0.2')).toMatchInlineSnapshot(`0.3`));

  test(`\\sqrt{-1}`, () =>
    expect(N('\\sqrt{-1}')).toMatchInlineSnapshot(`{num: "NaN"}`));

  test(`\\frac{1}{7}`, () =>
    expect(N('\\frac{1}{7}')).toMatchInlineSnapshot(`{num: "0.(142857)"}`));

  test(`\\frac{\\pi}{4}`, () =>
    expect(N('\\frac{\\pi}{4}')).toMatchInlineSnapshot(`
      {
        num: "0.785398163397448309615660845819875721049292349843776455243736148076954101571552249657008706335529266995537021628320576661773461152387645557931339852033"
      }
    `));

  test('', () => expect(N('e^{i\\pi}')).toMatchInlineSnapshot(`{num: "NaN"}`));
});

//
// Minimum  precision is 15 digits
//
describe('NUMERIC MODE decimal 7', () => {
  beforeEach(() => {
    engine.numericMode = 'decimal';
    engine.precision = 7;
  });

  test(`0.1 + 0.2`, () => expect(N('0.1 + 0.2')).toMatchInlineSnapshot(`0.3`));

  test(`\\sqrt{-1}`, () =>
    expect(N('\\sqrt{-1}')).toMatchInlineSnapshot(`{num: "NaN"}`));

  test(`\\frac{1}{7}`, () =>
    expect(N('\\frac{1}{7}')).toMatchInlineSnapshot(
      `{num: "0.142857142857143"}`
    ));

  test(`\\frac{\\pi}{4}`, () =>
    expect(N('\\frac{\\pi}{4}')).toMatchInlineSnapshot(
      `{num: "0.785398163397448"}`
    ));

  test('', () => expect(N('e^{i\\pi}')).toMatchInlineSnapshot(`{num: "NaN"}`));
});

//
// Complex mode has the same precision as machine mode (15 digits), but
// operations on complex numbers work as well.
//
describe('NUMERIC MODE complex', () => {
  beforeEach(() => {
    engine.numericMode = 'complex';
  });

  test(`0.1 + 0.2`, () =>
    expect(N('0.1 + 0.2')).toMatchInlineSnapshot(`0.30000000000000004`));

  test(`\\frac{1}{7}`, () =>
    expect(N('\\frac{1}{7}')).toMatchInlineSnapshot(`0.14285714285714285`));

  test(`\\sqrt{-1}`, () =>
    expect(N('\\sqrt{-1}')).toMatchInlineSnapshot(`{num: "NaN"}`));

  test('', () => expect(N('1 + i^2')).toMatchInlineSnapshot(`0`));

  // 3.6286i (= i \sinh 2)
  test('', () =>
    expect(N('\\sin 2i')).toMatchInlineSnapshot(
      `["Complex", 0, 3.626860407847019]`
    ));

  test('', () =>
    expect(N('\\ln(3+3i)')).toMatchInlineSnapshot(
      `["Complex", 1.4451858789480823, 0.7853981633974483]`
    ));

  test(`\\frac{\\pi}{4}`, () =>
    expect(N('\\frac{\\pi}{4}')).toMatchInlineSnapshot(`0.7853981633974483`));

  test('', () => expect(N('e^{i\\pi}')).toMatchInlineSnapshot(`-1`));
});
