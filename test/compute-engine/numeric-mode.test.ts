import { engine } from '../utils';

// engine.numericMode = 'decimal';
// engine.precision = 7;

// const a = engine.parse('\\frac{\\pi}{4}');
// console.log(a);

describe('NUMERIC MODE auto 200', () => {
  beforeEach(() => {
    engine.numericMode = 'auto';
    engine.precision = 200;
  });

  test(`0.1 + 0.2`, () =>
    expect(engine.parse('0.1 + 0.2').N().json).toMatchInlineSnapshot(`0.3`));

  test(`\\sqrt{-1}`, () =>
    expect(engine.parse('\\sqrt{-1}').N().json).toMatchInlineSnapshot(
      `{num: 'NaN'}`
    ));

  test(`\\frac{1}{7}`, () =>
    expect(engine.parse('\\frac{1}{7}').N().json).toMatchInlineSnapshot(
      `{num: '0.(142857)'}`
    ));

  test(`\\frac{\\pi}{4}`, () =>
    expect(engine.parse('\\frac{\\pi}{4}').N().json).toMatchInlineSnapshot(
      `{num: '0.7853981633974483096156608458198757210492923498437764552437361480769541015715522496570087063355292669955370216283205766617734611523876455579313398520321202793625710256754846302763899111557372387325955'}`
    ));
});

describe('NUMERIC MODE auto 15', () => {
  beforeEach(() => {
    engine.numericMode = 'auto';
    engine.precision = 15;
  });

  test(`0.1 + 0.2`, () =>
    expect(engine.parse('0.1 + 0.2').N().json).toMatchInlineSnapshot(
      `0.30000000000000004`
    ));

  test(`\\sqrt{-1}`, () =>
    expect(engine.parse('\\sqrt{-1}').N().json).toMatchInlineSnapshot(
      `{num: 'NaN'}`
    ));

  test(`\\frac{1}{7}`, () =>
    expect(engine.parse('\\frac{1}{7}').N().json).toMatchInlineSnapshot(
      `0.14285714285714285`
    ));

  test(`\\frac{\\pi}{4}`, () =>
    expect(engine.parse('\\frac{\\pi}{4}').N().json).toMatchInlineSnapshot(
      `0.7853981633974483`
    ));
});

describe('NUMERIC MODE machine', () => {
  beforeEach(() => {
    engine.numericMode = 'machine';
  });

  test(`0.1 + 0.2`, () =>
    expect(engine.parse('0.1 + 0.2').N().json).toMatchInlineSnapshot(
      `0.30000000000000004`
    ));

  test(`\\sqrt{-1}`, () =>
    expect(engine.parse('\\sqrt{-1}').N().json).toMatchInlineSnapshot(
      `{num: 'NaN'}`
    ));

  test(`\\frac{1}{7}`, () =>
    expect(engine.parse('\\frac{1}{7}').N().json).toMatchInlineSnapshot(
      `0.14285714285714285`
    ));

  test(`\\frac{\\pi}{4}`, () =>
    expect(engine.parse('\\frac{\\pi}{4}').N().json).toMatchInlineSnapshot(
      `0.7853981633974483`
    ));
});

describe('NUMERIC MODE decimal 150', () => {
  beforeEach(() => {
    engine.numericMode = 'decimal';
    engine.precision = 150;
  });

  test(`0.1 + 0.2`, () =>
    expect(engine.parse('0.1 + 0.2').N().json).toMatchInlineSnapshot(`0.3`));

  test(`\\sqrt{-1}`, () =>
    expect(engine.parse('\\sqrt{-1}').N().json).toMatchInlineSnapshot(
      `{num: 'NaN'}`
    ));

  test(`\\frac{1}{7}`, () =>
    expect(engine.parse('\\frac{1}{7}').N().json).toMatchInlineSnapshot(
      `{num: '0.(142857)'}`
    ));

  test(`\\frac{\\pi}{4}`, () =>
    expect(engine.parse('\\frac{\\pi}{4}').N().json).toMatchInlineSnapshot(
      `{num: '0.785398163397448309615660845819875721049292349843776455243736148076954101571552249657008706335529266995537021628320576661773461152387645557931339852033'}`
    ));
});

describe('NUMERIC MODE decimal 7', () => {
  beforeEach(() => {
    engine.numericMode = 'decimal';
    engine.precision = 7;
  });

  test(`0.1 + 0.2`, () =>
    expect(engine.parse('0.1 + 0.2').N().json).toMatchInlineSnapshot(`0.3`));

  test(`\\sqrt{-1}`, () =>
    expect(engine.parse('\\sqrt{-1}').N().json).toMatchInlineSnapshot(
      `{num: 'NaN'}`
    ));

  test(`\\frac{1}{7}`, () =>
    expect(engine.parse('\\frac{1}{7}').N().json).toMatchInlineSnapshot(
      `{num: '0.142857142857143'}`
    ));

  test(`\\frac{\\pi}{4}`, () =>
    expect(engine.parse('\\frac{\\pi}{4}').N().json).toMatchInlineSnapshot(
      `{num: '0.785398163397448'}`
    ));
});

describe('NUMERIC MODE complex', () => {
  beforeEach(() => {
    engine.numericMode = 'complex';
  });

  test(`0.1 + 0.2`, () =>
    expect(engine.parse('0.1 + 0.2').N().json).toMatchInlineSnapshot(
      `0.30000000000000004`
    ));

  test(`\\sqrt{-1}`, () =>
    expect(engine.parse('\\sqrt{-1}').N().json).toMatchInlineSnapshot(
      `{num: 'NaN'}`
    ));

  test(`\\frac{1}{7}`, () =>
    expect(engine.parse('\\frac{1}{7}').N().json).toMatchInlineSnapshot(
      `0.14285714285714285`
    ));

  test(`\\frac{\\pi}{4}`, () =>
    expect(engine.parse('\\frac{\\pi}{4}').N().json).toMatchInlineSnapshot(
      `0.7853981633974483`
    ));
});
