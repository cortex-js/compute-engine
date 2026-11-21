import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// CE-1455. A transformer (`Expand`, `Factor`, `Together`, `TrigExpand`, …)
// replaces a symbol of its operand by the stored value of the symbol
// (`resolveBoundSymbols()`, `boxed-expression/utils.ts`), and then the symbols
// of that value. A symbol of a stored value is the variable of the scope
// where the value was assigned (`docs/SCOPING-MODEL.md`, "Free names"), not
// the variable that its name has where the transformer is evaluated: with
// `y := Sin(x)`, `Expand(y)` in a function with a parameter `x` is `Sin(x)`
// with the global `x`, whatever the argument.
//

/** The value of the last of `steps`, each evaluated in order on one engine. */
function run(...steps: MathJsonExpression[]): MathJsonExpression {
  const ce = new ComputeEngine();
  let last: MathJsonExpression = 'Nothing';
  for (const step of steps) last = ce.box(step).evaluate().json;
  return last;
}

/** `f := x ↦ body` */
const defineF = (body: MathJsonExpression): MathJsonExpression => [
  'Assign',
  'f',
  ['Function', body, 'x'],
];

const Y_IS_SIN_X: MathJsonExpression = ['Assign', 'y', ['Sin', 'x']];
const Y_IS_SQUARE: MathJsonExpression = [
  'Assign',
  'y',
  ['Power', ['Add', 'x', 1], 2],
];

describe('CE-1455: a symbol of a stored value is not the parameter of the same name', () => {
  test.each([
    'Expand',
    'ExpandAll',
    'Factor',
    'Together',
    'Distribute',
    'TrigExpand',
    'TrigReduce',
  ])('%s(y) in a function with a parameter x', (head) => {
    expect(run(Y_IS_SIN_X, defineF([head, 'y']), ['f', 2])).toEqual([
      'Sin',
      'x',
    ]);
  });

  test('TrigToExp(y) in a function with a parameter x', () => {
    const inFunction = run(Y_IS_SIN_X, defineF(['TrigToExp', 'y']), ['f', 2]);
    expect(inFunction).toEqual(run(['TrigToExp', ['Sin', 'x']]));
    expect(JSON.stringify(inFunction)).toContain('"x"');
  });

  test('the same value as the body with no transformer', () => {
    expect(run(Y_IS_SIN_X, defineF(['Expand', 'y']), ['f', 2])).toEqual(
      run(Y_IS_SIN_X, defineF(['Add', 'y', 0]), ['f', 2])
    );
  });

  test('x is declared before the value is assigned', () => {
    expect(
      run(
        ['Declare', 'x', { str: 'real' }],
        Y_IS_SIN_X,
        defineF(['Expand', 'y']),
        ['f', 2]
      )
    ).toEqual(['Sin', 'x']);
  });

  test('the parameter and the variable of the stored value in one operand', () => {
    // `x·y` is `2·(x + 1)²`: the first `x` is the parameter.
    expect(
      run(Y_IS_SQUARE, defineF(['Expand', ['Multiply', 'x', 'y']]), ['f', 2])
    ).toEqual(['Add', ['Multiply', 2, ['Power', 'x', 2]], ['Multiply', 4, 'x'], 2]);
  });

  test('the free variable of the body of a function that the operand calls', () => {
    // `g(x)` is `(2 + x)²`: the `x` of the body of `g` is the global `x`.
    expect(
      run(
        ['Assign', 'g', ['Function', ['Power', ['Add', 't', 'x'], 2], 't']],
        defineF(['Expand', ['g', 'x']]),
        ['f', 2]
      )
    ).toEqual(['Add', ['Power', 'x', 2], ['Multiply', 4, 'x'], 4]);
  });
});

describe('CE-1455: a symbol of a stored value is not the local of the same name', () => {
  const inBlock = (body: MathJsonExpression): MathJsonExpression[] => [
    Y_IS_SIN_X,
    ['Assign', 'x', 1],
    ['Block', ['Declare', 'x', { str: 'integer' }], ['Assign', 'x', 2], body],
  ];

  test('Expand(y) in a block with a local x reads the global x', () => {
    expect(run(...inBlock(['Expand', 'y']))).toEqual(['Sin', 1]);
    expect(run(...inBlock(['Expand', 'y']))).toEqual(run(...inBlock('y')));
  });

  test('TrigToExp(y) in a block with a local x reads the global x', () => {
    expect(run(...inBlock(['TrigToExp', 'y']))).toEqual(
      run(['TrigToExp', ['Sin', 1]])
    );
  });

  test('an operand that names the local reads the local', () => {
    expect(
      run(...inBlock(['Expand', ['Power', ['Add', 'x', 1], 2]]))
    ).toEqual(9);
  });
});

describe('CE-1455: a symbol of a stored value is not the index of the same name', () => {
  test('Expand(n·a) in a sum over n, with a := n + 1', () => {
    const a: MathJsonExpression = ['Assign', 'a', ['Add', 'n', 1]];
    const sum = (body: MathJsonExpression): MathJsonExpression => [
      'Sum',
      body,
      ['Limits', 'n', 1, 3],
    ];
    // (1 + 2 + 3)·(n + 1), with the global `n` in the value of `a`
    expect(run(a, sum(['Expand', ['Multiply', 'n', 'a']]))).toEqual([
      'Add',
      ['Multiply', 6, 'n'],
      6,
    ]);
    expect(run(a, sum(['Expand', ['Multiply', 'n', 'a']]))).toEqual(
      run(a, sum(['Multiply', 'n', 'a']))
    );
  });
});

describe('CE-1455: Solve reads a stored equation with its own variables', () => {
  test('Solve(s = 2, w) in a function with a parameter x, with s := x + w', () => {
    expect(
      run(
        ['Assign', 's', ['Add', 'x', 'w']],
        defineF(['Solve', ['Equal', 's', 2], 'w']),
        ['f', 5]
      )
    ).toEqual(['List', ['Add', ['Negate', 'x'], 2]]);
  });
});

describe('CE-1455: the values that the change must keep', () => {
  test('the parameter in the operand is replaced by the argument', () => {
    const f = defineF(['Expand', ['Multiply', 'x', ['Add', 'x', 1]]]);
    expect(run(f, ['f', 2])).toEqual(6);
    expect(run(f, ['f', ['Add', 'a', 1]])).toEqual([
      'Add',
      ['Power', 'a', 2],
      ['Multiply', 3, 'a'],
      2,
    ]);
  });

  test('an argument that names the global x', () => {
    const f = defineF(['Expand', ['Power', ['Add', 'x', 1], 2]]);
    expect(run(f, ['f', 'x'])).toEqual([
      'Add',
      ['Power', 'x', 2],
      ['Multiply', 2, 'x'],
      1,
    ]);
    expect(run(f, ['f', ['Add', 'x', 1]])).toEqual([
      'Add',
      ['Power', 'x', 2],
      ['Multiply', 4, 'x'],
      4,
    ]);
  });

  test('a stored value that names a symbol with a stored value', () => {
    expect(
      run(
        ['Assign', 'z', ['Add', 'x', 1]],
        ['Assign', 'y', ['Power', 'z', 2]],
        ['Expand', 'y']
      )
    ).toEqual(['Add', ['Power', 'x', 2], ['Multiply', 2, 'x'], 1]);
  });

  test('a value assigned to x after the formula is stored', () => {
    expect(run(Y_IS_SQUARE, ['Assign', 'x', 1], ['Expand', 'y'])).toEqual(4);
  });

  test('a stored value that names itself', () => {
    expect(run(['Assign', 'a', ['Add', 'a', 1]], ['Expand', 'a'])).toEqual([
      'Add',
      'a',
      1,
    ]);
  });

  test('the unknown of Solve keeps its name when it has a value', () => {
    const s: MathJsonExpression = [
      'Assign',
      's',
      ['Divide', ['Subtract', 9, ['Power', 'w', 2]], 4],
    ];
    const w: MathJsonExpression = ['Assign', 'w', 9];
    for (const equation of [
      ['Equal', 's', 2],
      ['Equal', ['Expand', 's'], 2],
    ] as MathJsonExpression[]) {
      expect(run(s, w, ['Solve', equation, 'w'])).toEqual(['List', 1, -1]);
      // The same equation solved in a function: the value of `w` is hidden
      // on the definition that the `w` of the value of `s` reads.
      expect(
        run(s, w, ['Assign', 'f', ['Function', ['Solve', equation, 'w'], 'q']], [
          'f',
          3,
        ])
      ).toEqual(['List', 1, -1]);
    }
  });

  test('a symbol of a held operand is read by its name', () => {
    // The operand of `Hold` is not canonical, so its symbols have no binding:
    // they are read where the transformer is evaluated, as `ReleaseHold`
    // reads them.
    const held: MathJsonExpression[] = [
      ['Assign', 'x', 7],
      ['Assign', 'y', ['Hold', ['Sin', 'x']]],
    ];
    expect(run(...held, ['Expand', 'y'])).toEqual(['Hold', ['Sin', 7]]);
    expect(run(...held, ['ReleaseHold', 'y'])).toEqual(['Sin', 7]);
  });
});
