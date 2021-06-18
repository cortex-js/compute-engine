import { ComputeEngine } from '../src/compute-engine';

export const ce = new ComputeEngine();

describe.skip('is() values', () => {
  ce.assume(['Greater', 'x', 4]);
  ce.assume(['Equal', 'a', 1]);
  ce.assume('o', 1);

  test(`> 0`, () => {
    expect(ce.is(['Greater', 'x', 0])).toBeFalsy();
    expect(ce.is(['Greater', 'a', 0])).toBeTruthy();
  });

  test(`= 0`, () => {
    expect(ce.is(['Equal', 'x', 0])).toBeFalsy();
    expect(ce.is(['Equal', 'a', 0])).toBeFalsy();
  });

  test(`= 1`, () => {
    expect(ce.is(['Equal', 'x', 1])).toBeFalsy();
    expect(ce.is(['Equal', 'a', 1])).toBeTruthy();
    expect(ce.is(['Equal', 'o', 1])).toBeTruthy();
  });

  test(`!= 1`, () => {
    expect(ce.is(['NotEqual', 'x', 1])).toBeTruthy();
    expect(ce.is(['NotEqual', 'a', 1])).toBeFalsy();
    expect(ce.is(['NotEqual', 'o', 1])).toBeFalsy();
  });

  test(`< 0`, () => {
    expect(ce.is(['Less', 'x', 0])).toBeFalsy();
    expect(ce.is(['Less', 'a', 0])).toBeFalsy();
  });
});

describe.skip('is() values', () => {
  ce.assume('n', 'Integer');
  ce.assume('p', 11);
  ce.assume('r', ['Interval', ['Open', 0], +Infinity]);

  test(`is prime`, () => {
    expect(ce.is(['Element', 'n', 'PrimeNumber'])).toBeFalsy();
    expect(ce.is(['Element', 'p', 'PrimeNumber'])).toBeTruthy();
  });

  test(`is composite`, () => {
    expect(ce.is(['Element', 'n', 'CompositeNumber'])).toBeTruthy();
    expect(ce.is(['Element', 'p', 'CompositeNumber'])).toBeFalsy();
  });

  test(`is positive`, () => {
    expect(ce.is(['Element', 'r', 'RealNumber'])).toBeTruthy();
    expect(ce.is(['Greater', 'r', 0])).toBeTruthy();
  });
});

describe.skip('canonical domains', () => {
  ce.assume(['Element', 'm', ['Range', '-Infinity', 'Infinity']]);
  ce.assume(['Element', 'n', ['Range', 0, 'Infinity']]);
  ce.assume(['Element', 'q', ['Range', '-Infinity', 0]]);

  ce.assume(['Greater', 't', 0]);
  ce.assume(['Greater', 's', 5]);

  test(`Range domains`, () => {
    expect(ce.domain('m')).toMatchInlineSnapshot(`"RealNumber"`);
    expect(ce.domain('n')).toMatchInlineSnapshot(`"RealNumber"`);
    expect(ce.domain('q')).toMatchInlineSnapshot(`"RealNumber"`);
  });

  test(`Interval domains`, () => {
    expect(ce.domain('t')).toMatchInlineSnapshot(`"RealNumber"`);
    expect(ce.domain('s')).toMatchInlineSnapshot(`"RealNumber"`);
  });
});
