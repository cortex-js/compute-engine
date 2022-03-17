import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/math-json/math-json-format';

export const engine = new ComputeEngine();

// const lhs = [
//   -7,
//   -5,
//   -1.3,
//   -1,
//   0,
//   0.12,
//   1,
//   2,
//   2.1,
//   5,
//   7,
//   { num: '7.12d' },
//   { num: '-7.12d' },
//   ['Complex', -2, -3],
//   ['Complex', 7, 0],
//   '+Infinity',
//   '-Infinity',
//   'ComplexInfinity',
//   'ImaginaryUnit',
//   'NaN',
//   'Pi',
//   'Half',
//   ['Divide', 5, 7],
//   ['Divide', 25, 35],
//   ['Divide', 19, 11],
//   ['Divide', -5, 7],
//   ['Divide', -25, 35],
//   ['Divide', -19, 11],
//   'True',
//   'False',
//   'Maybe',
// ];

// const rhs = [
//   'Number',
//   'ExtendedComplexNumber',
//   'ExtendedRealNumber',
//   'ComplexNumber',
//   'ImaginaryNumber',
//   'RealNumber',
//   'TranscendentalNumber',
//   'AlgebraicNumber',
//   'RationalNumber',
//   'Integer',

//   'Boolean',
//   'MaybeBoolean',

//   ['Range', 2, 5],
//   ['Range', 0, +Infinity],
//   ['Range', -Infinity, 0],
//   ['Range', -5, 5],

//   ['Interval', 2, 5],
//   ['Interval', 0, +Infinity],
//   ['Interval', -Infinity, 0],
//   ['Interval', -5, 5],
//   ['Interval', 2, ['Open', 5]],
//   ['Interval', ['Open'], ['Open', 5]],
//   ['Interval', 0, +Infinity],
//   ['Interval', -Infinity, 0],
//   ['Interval', -5, 5],
// ];

const tests: Expression[] = [
  ['Equal', 0, 0],
  ['Equal', 5, 5],
  ['Equal', -7, -7],

  ['Less', -7, -7],
  ['LessEqual', -7, -7],
  ['Greater', -7, -7],
  ['GreaterEqual', -7, -7],

  ['NotEqual', -7, -7],
  ['Not', ['Equal', -7, -7]],
  ['Not', ['NotEqual', -7, -7]],

  // ['And'],
  // ['Or',

  ['Element', -1, 'Integer'],
  ['Element', 0, 'Integer'],
  ['Element', 5, 'Integer'],
  ['Element', 0.12, 'Integer'],
  ['Element', { num: '7d' }, 'Integer'],
  // ['Element', , 'Integer'],
];

describe.skip('is()', () => {
  // https://jestjs.io/docs/next/api#testeachtablename-fn-timeout
  test.each(tests)('is("%p")', (prop) => {
    // expect(engine.is(prop)).toMatchSnapshot();
  });
});
