import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/public';

export const engine = new ComputeEngine();

/*
    [a, b, compare(a,b)]
*/

const domains: Expression[] = [
  0,
  5,
  'Integer',
  'RationalNumber',
  'AlgebraicNumber',
  'RealNumber',
  'ComplexNumber',
  'Number',
  ['Range', 0, 0],
  ['Range', 1, 1],
  ['Range', -Infinity, Infinity],
  ['Range', 1, 5],
  ['Interval', 0, 0],
  ['Interval', -Infinity, Infinity],
  ['Interval', 0, Infinity],
  ['Interval', 0, 5],
  ['And', ['Greater', 0], ['Lesser', 5]],
  ['Union', ['Range', 1, 5], ['Range', 5, Infinity]],
];

describe('canonicalDomainForm', () => {
  // https://jestjs.io/docs/next/api#testeachtablename-fn-timeout
  test.each(domains)('canonicalDomainForm("%p")', (domain) => {
    expect(engine.format(domain, 'canonical-domain')).toMatchSnapshot();
  });
});
