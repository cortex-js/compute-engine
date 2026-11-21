import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// CE-1641. A transformer (`Expand`, `Factor`, …) replaces a symbol of its
// operand by the stored value of the symbol (`resolveBoundSymbols()`,
// `boxed-expression/utils.ts`). When the operand has a binder (a `Sum`, a
// `Function`, a `Block`), the value is placed under the binder, and a free
// symbol of the value with the name of the binder's variable became that
// variable. A symbol whose value reads such a name now stays as written.
//

/** The value of the last of `steps`, each evaluated in order on one engine,
 * then evaluated once more: a transformer can return a binder unevaluated. */
function run(...steps: MathJsonExpression[]): MathJsonExpression {
  const ce = new ComputeEngine();
  let last = ce.box('Nothing');
  for (const step of steps) last = ce.box(step).evaluate();
  return last.evaluate().json;
}

const A_IS_N_PLUS_1: MathJsonExpression = ['Assign', 'a', ['Add', 'n', 1]];
const sumOverN = (body: MathJsonExpression): MathJsonExpression => [
  'Sum',
  body,
  ['Limits', 'n', 1, 3],
];

describe('CE-1641: a stored value is not captured by the index of a sum in the operand', () => {
  test.each(['Expand', 'Factor'])('%s(Sum(a·n)) with a := n + 1', (head) => {
    const sum = sumOverN(['Multiply', 'a', 'n']);
    // (1 + 2 + 3)·(n + 1), with the global `n` in the value of `a`
    expect(run(A_IS_N_PLUS_1, [head, sum])).toEqual(run(A_IS_N_PLUS_1, sum));
    expect(run(A_IS_N_PLUS_1, sum)).toEqual(['Add', ['Multiply', 6, 'n'], 6]);
  });

  test('a value that names a symbol whose value reads the index', () => {
    const steps: MathJsonExpression[] = [
      ['Assign', 'c', ['Add', 'n', 1]],
      ['Assign', 'a', ['Power', 'c', 2]],
    ];
    const sum = sumOverN(['Multiply', 'a', 'n']);
    expect(run(...steps, ['Expand', sum])).toEqual(run(...steps, sum));
  });

  test('a value with no name of the index is still replaced', () => {
    const steps: MathJsonExpression[] = [
      ['Assign', 'a', ['Power', ['Add', 'm', 1], 2]],
    ];
    const ce = new ComputeEngine();
    for (const step of steps) ce.box(step).evaluate();
    const expanded = ce
      .box(['Expand', sumOverN(['Multiply', 'a', 'n'])])
      .evaluate();
    expect(expanded.json).toEqual(
      sumOverN(['Multiply', 'n', ['Power', ['Add', 'm', 1], 2]])
    );
  });

  test('a bound of the sum reads the global binding of the index name', () => {
    // The bounds are outside the scope of the index: `b` is `n + 1 = 3`.
    expect(
      run(
        ['Assign', 'n', 2],
        ['Assign', 'b', ['Add', 'n', 1]],
        ['Expand', ['Sum', 'n', ['Limits', 'n', 1, 'b']]]
      )
    ).toEqual(6);
  });

  test('the index of an outer sum, under the function of an inner binder', () => {
    const sum = sumOverN([
      'Apply',
      ['Function', ['Multiply', 'a', 'x'], 'x'],
      'n',
    ]);
    expect(run(A_IS_N_PLUS_1, ['Expand', sum])).toEqual(
      run(A_IS_N_PLUS_1, sum)
    );
    expect(run(A_IS_N_PLUS_1, sum)).toEqual(['Add', ['Multiply', 6, 'n'], 6]);
  });
});

describe('CE-1641: a stored value is not captured by the parameter of a function in the operand', () => {
  test('Apply(Expand(x ↦ y), 2) with y := Sin(x) and x := 1', () => {
    const steps: MathJsonExpression[] = [
      ['Assign', 'y', ['Sin', 'x']],
      ['Assign', 'x', 1],
    ];
    expect(
      run(...steps, ['Apply', ['Expand', ['Function', 'y', 'x']], 2])
    ).toEqual(['Sin', 1]);
    expect(run(...steps, ['Apply', ['Function', 'y', 'x'], 2])).toEqual([
      'Sin',
      1,
    ]);
  });

  test('a value with no name of the parameter is still replaced', () => {
    expect(
      run(
        ['Assign', 'y', ['Power', ['Add', 't', 1], 2]],
        ['Apply', ['Expand', ['Function', ['Multiply', 'y', 'x'], 'x']], 2]
      )
    ).toEqual(['Multiply', 2, ['Power', ['Add', 't', 1], 2]]);
  });
});

describe('CE-1641: a stored value is not captured by the local of a block in the operand', () => {
  test('Expand(Block(x := 2, y)) with y := Sin(x) and x := 1', () => {
    const steps: MathJsonExpression[] = [
      ['Assign', 'y', ['Sin', 'x']],
      ['Assign', 'x', 1],
    ];
    const block: MathJsonExpression = [
      'Block',
      ['Declare', 'x', { str: 'integer' }],
      ['Assign', 'x', 2],
      'y',
    ];
    expect(run(...steps, ['Expand', block])).toEqual(['Sin', 1]);
    expect(run(...steps, block)).toEqual(['Sin', 1]);
  });
});

describe('CE-1641: the unknown of Solve is still protected', () => {
  test('Solve(s = 2, w) with s := x + w', () => {
    expect(
      run(['Assign', 's', ['Add', 'x', 'w']], ['Solve', ['Equal', 's', 2], 'w'])
    ).toEqual(['List', ['Add', ['Negate', 'x'], 2]]);
  });

  test('the unknown under a sum of the equation, with w := 9', () => {
    // s := Σ w·k over k = 1..3 is 6w; the unknown `w` keeps its name.
    expect(
      run(
        ['Assign', 's', ['Sum', ['Multiply', 'w', 'k'], ['Limits', 'k', 1, 3]]],
        ['Assign', 'w', 9],
        ['Solve', ['Equal', 's', 12], 'w']
      )
    ).toEqual(['List', 2]);
  });
});
