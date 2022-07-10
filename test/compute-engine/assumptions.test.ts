import { ComputeEngine } from '../../src/compute-engine';

export const ce = new ComputeEngine();

ce.assume('a', 1);
ce.assume('i', 'Integer');
ce.assume(['Greater', 'x', 4]);
ce.assume(['Element', 'm', ['Range', -Infinity, Infinity]]);
ce.assume(['Element', 'n', ['Range', 0, Infinity]]);
ce.assume(['Equal', 'o', 1]);
ce.assume(['Equal', 'p', 11]);
ce.assume(['Element', 'q', ['Range', -Infinity, 0]]);
ce.assume(['Element', 'r', ['Interval', ['Open', 0], +Infinity]]);

ce.assume(['Greater', 's', 5]);
ce.assume(['Greater', 't', 0]);

// console.log([...ce.context!.dictionary!.symbols.keys()]);

describe('TAUTOLOGY a = 1', () => {
  test(`a.value`, () => {
    expect(ce.box('a').evaluate()).toMatchInlineSnapshot(`"\\"a\\""`);
  });
  test(`a.domain`, () => {
    expect(ce.box('a').domain.domainExpression).toMatchInlineSnapshot(
      `"ExtendedRealNumber"`
    );
  });
  test(`a > 0`, () => {
    expect(ce.assume(['Greater', 'a', 0])).toMatchInlineSnapshot();
  });
  test(`a >= 1`, () => {
    expect(ce.assume(['GreaterEqual', 'a', 1])).toMatchInlineSnapshot();
  });
  test(`a = 1`, () => {
    expect(ce.assume(['Equal', 'a', 1])).toMatchInlineSnapshot();
  });
});

describe.skip('CONTRADICTIONS', () => {
  test(`a < 0`, () => {
    expect(ce.assume(['LessThan', 'a', 0])).toMatchInlineSnapshot();
  });
});

describe.skip('is() values', () => {
  test(`> 0`, () => {
    // expect(ce.is(['Greater', 'x', 0])).toBeFalsy();
    // expect(ce.is(['Greater', 'a', 0])).toBeTruthy();
  });

  test(`= 0`, () => {
    // expect(ce.is(['Equal', 'x', 0])).toBeFalsy();
    // expect(ce.is(['Equal', 'a', 0])).toBeFalsy();
  });

  test(`= 1`, () => {
    // expect(ce.is(['Equal', 'x', 1])).toBeFalsy();
    // expect(ce.is(['Equal', 'a', 1])).toBeTruthy();
    // expect(ce.is(['Equal', 'o', 1])).toBeTruthy();
  });

  test(`!= 1`, () => {
    // expect(ce.is(['NotEqual', 'x', 1])).toBeTruthy();
    // expect(ce.is(['NotEqual', 'a', 1])).toBeFalsy();
    // expect(ce.is(['NotEqual', 'o', 1])).toBeFalsy();
  });

  test(`< 0`, () => {
    // expect(ce.is(['Less', 'x', 0])).toBeFalsy();
    // expect(ce.is(['Less', 'a', 0])).toBeFalsy();
  });
});

describe.skip('is() values', () => {
  test(`is positive`, () => {
    // expect(ce.is(['Element', 'r', 'RealNumber'])).toBeTruthy();
    // expect(ce.is(['Greater', 'r', 0])).toBeTruthy();
  });
});

describe.skip('canonical domains', () => {
  test(`Range domains`, () => {
    expect(ce.box('m').domain.domainExpression).toMatchInlineSnapshot(
      `"RealNumber"`
    );
    expect(ce.box('n').domain.domainExpression).toMatchInlineSnapshot(
      `"RealNumber"`
    );
    expect(ce.box('q').domain.domainExpression).toMatchInlineSnapshot(
      `"RealNumber"`
    );
  });

  test(`Interval domains`, () => {
    expect(ce.box('t').domain.domainExpression).toMatchInlineSnapshot(
      `"RealNumber"`
    );
    expect(ce.box('s').domain.domainExpression).toMatchInlineSnapshot(
      `"RealNumber"`
    );
  });
});
