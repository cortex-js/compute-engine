import { expression, latex } from '../utils';

describe('SERIALIZING SETS', () => {
  test('Set', () => {
    expect(latex(['Set'])).toMatchInlineSnapshot(`'\\operatorname{Set}()'`);
    expect(latex(['Set', 2, 5, 7])).toMatchInlineSnapshot(
      `'\\operatorname{Set}(2, 5, 7)'`
    );
    // With lambda-condition
    expect(
      latex(['Set', 'Number', ['Condition', ['NotEqual', '_', 0]]])
    ).toMatchInlineSnapshot(
      `'\\operatorname{Set}(\\operatorname{Number}, \\operatorname{Condition}(_\\ne0))'`
    );
    // With predicate and named arguments
    expect(
      latex([
        'Set',
        ['Element', 'x', 'Number'],
        ['Condition', ['NotEqual', 'x', 0]],
      ])
    ).toMatchInlineSnapshot(
      `'\\operatorname{Set}(x\\in\\operatorname{Number}, \\operatorname{Condition}(x\\ne0))'`
    );
  });

  test('Range', () => {});

  test('Interval', () => {});

  test('Multiple', () => {
    expect(latex(['Multiple', 'Integer'])).toMatchInlineSnapshot(`''`);
    expect(latex(['Multiple', 'Integer', 1])).toMatchInlineSnapshot(`''`);
    expect(latex(['Multiple', 'Integer', 1, 0])).toMatchInlineSnapshot(`''`);
    expect(latex(['Multiple', 'Integer', 2])).toMatchInlineSnapshot(`''`);
    expect(latex(['Multiple', 'Integer', 2, 0])).toMatchInlineSnapshot(`''`);
    expect(latex(['Multiple', 'Integer', 2, 1])).toMatchInlineSnapshot(`''`);
    expect(latex(['Multiple', 'Pi', 2, 3])).toMatchInlineSnapshot(`''`);
    expect(
      latex(['Multiple', ['Divide', 'Pi', 2], 2, 3])
    ).toMatchInlineSnapshot(`''`);
  });

  test('Union, Intersection, etc...', () => {
    expect(latex(['Union', 'Integer', 'RealNumber'])).toMatchInlineSnapshot(
      `'\\Z\\cup\\R'`
    );
    expect(
      latex(['Intersection', 'Integer', 'RealNumber'])
    ).toMatchInlineSnapshot(`'\\Z\\cap\\R'`);
    expect(latex(['Complement', 'ComplexNumber'])).toMatchInlineSnapshot(
      `'\\C'`
    );
    expect(latex(['CartesianProduct'])).toMatchInlineSnapshot(`''`);
    expect(latex(['CartesianProduct', 'Integer'])).toMatchInlineSnapshot(
      `'\\Z'`
    );
    expect(
      latex(['CartesianProduct', 'Integer', 'Integer'])
    ).toMatchInlineSnapshot(`'\\Z\\times\\Z'`);
    expect(
      latex(['CartesianProduct', 'Integer', 'RationalNumber'])
    ).toMatchInlineSnapshot(`'\\Z\\times\\Q'`);
    expect(
      latex(['CartesianProduct', 'Integer', 'Integer', 'Integer'])
    ).toMatchInlineSnapshot(`'\\Z\\times\\Z\\times\\Z'`);
    expect(latex(['CartesianPower', 'Integer', 3])).toMatchInlineSnapshot(
      `'\\operatorname{CartesianPower}(\\Z, 3)'`
    );
    expect(latex(['CartesianPower', 'Integer', 'n'])).toMatchInlineSnapshot(
      `'\\operatorname{CartesianPower}(\\Z, n)'`
    );
  });
});

describe('PARSING SETS', () => {
  test('Set', () => {
    // Empty set
    expect(expression('{}')).toMatchInlineSnapshot(`''`);

    // Finite set
    expect(expression('{1, 2, 3}')).toMatchInlineSnapshot(
      `['Error', ['LatexString', {str: '{1, 2, 3}'}], ''syntax-error'']`
    );

    // Infinite sets
    expect(expression('{1, 2, 3...}')).toMatchInlineSnapshot(
      `['Error', ['LatexString', {str: '{1, 2, 3...}'}], ''syntax-error'']`
    );
    expect(expression('{1, 2, 3, ...}')).toMatchInlineSnapshot(
      `['Error', ['LatexString', {str: '{1, 2, 3, ...}'}], ''syntax-error'']`
    );
    expect(expression('{...-2, -1, 0, 1, 2, 3...}')).toMatchInlineSnapshot(
      `['Error', ['LatexString', {str: '{...-2, -1, 0, 1, 2, 3...}'}], ''syntax-error'']`
    );
    expect(expression('{...-2, -1, 0}')).toMatchInlineSnapshot(
      `['Error', ['LatexString', {str: '{...-2, -1, 0}'}], ''syntax-error'']`
    );
  });
  test('Range', () => {});
  test('Interval', () => {});
  test('Union, Intersection, etc...', () => {
    expect(expression('\\N \\cup \\R')).toMatchInlineSnapshot(
      `['Union', 'NonNegativeInteger', 'RealNumber']`
    );
    expect(expression('\\N \\cap \\R')).toMatchInlineSnapshot(
      `['Intersection', 'NonNegativeInteger', 'RealNumber']`
    );
    expect(expression('\\N \\setminus \\R')).toMatchInlineSnapshot(
      `['SetMinus', 'NonNegativeInteger']`
    );
    expect(expression('\\N^\\complement')).toMatchInlineSnapshot(
      `['Power', 'NonNegativeInteger', ['Error', ['LatexString', {str: '\\complement'}], 'unknown-command']]`
    );
    expect(expression('\\N \\times \\N')).toMatchInlineSnapshot(
      `['Multiply', 'NonNegativeInteger', 'NonNegativeInteger']`
    );
    expect(expression('\\N^3')).toMatchInlineSnapshot(
      `['Power', 'NonNegativeInteger', 3]`
    );
    expect(expression('\\N^{n}')).toMatchInlineSnapshot(
      `['Power', 'NonNegativeInteger', 'n']`
    );
  });
});
