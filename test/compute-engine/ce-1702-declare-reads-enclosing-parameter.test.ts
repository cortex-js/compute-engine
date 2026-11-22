/**
 * CE-1702: the value of a `Declare` in a block nested in the body of a
 * function reads the parameter of the same name, as it reads any outer
 * binding (`docs/SCOPING-MODEL.md`, "The initial value of a `Declare` is
 * computed with the outer name"). It read the new local, which had no
 * value, and the call gave a formula in the name.
 */
import { ComputeEngine } from '../../src/compute-engine';

const declare = (name: string, value: unknown) => [
  'Declare',
  name,
  "'unknown'",
  value,
];
const ce = new ComputeEngine();
const run = (expr: unknown) =>
  JSON.stringify(ce.box(expr as never).evaluate().json);

describe('the value of a Declare reads the enclosing parameter', () => {
  const shadow = [
    'Function',
    ['Block', ['Block', declare('u', ['Add', 'u', 1]), 'u']],
    'u',
  ];

  test('through Apply and a named function', () => {
    expect(run(['Apply', shadow, 2])).toBe('3');
    ce.assign('shadowed', shadow as never);
    expect(run(['shadowed', 2])).toBe('3');
  });

  test('a delimited block, as the LaTeX parse gives it', () => {
    const literal = [
      'Function',
      ['Delimiter', ['Block', declare('u', ['Add', 'u', 1]), ['Add', 'u', 1]]],
      'u',
    ];
    expect(run(['Apply', literal, 2])).toBe('4');
  });

  test('a global of the same name is not read', () => {
    ce.assign('v', 100);
    const literal = [
      'Function',
      ['Block', ['Block', declare('v', ['Add', 'v', 1]), 'v']],
      'v',
    ];
    expect(run(['Apply', literal, 2])).toBe('3');
  });

  test('a block local in between is closer than the parameter', () => {
    const literal = [
      'Function',
      [
        'Block',
        [
          'Block',
          declare('u', 9),
          ['Block', declare('u', ['Add', 'u', 1]), 'u'],
        ],
      ],
      'u',
    ];
    expect(run(['Apply', literal, 2])).toBe('10');
  });

  test('a parameter read before the block keeps its value', () => {
    const literal = [
      'Function',
      [
        'Block',
        declare('w', 'u'),
        ['Block', declare('u', ['Add', 'u', 1]), ['Add', 'u', 'w']],
      ],
      'u',
    ];
    expect(run(['Apply', literal, 2])).toBe('5');
  });

  test('the block of the body itself still refuses the name', () => {
    const literal = [
      'Function',
      ['Block', declare('u', ['Add', 'u', 1]), 'u'],
      'u',
    ];
    expect(run(['Apply', literal, 2])).toContain('variable-redeclaration');
  });
});
