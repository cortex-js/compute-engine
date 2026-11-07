import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The `evaluate` handler of `Sin`, `Cos`, `Power` and the other numeric
// operators with a `canonical` handler refuses an operand that cannot be a
// number. The error it returns names the function and the position of the
// refused operand in its breadcrumb, as the error of `Ln(w)` does: with
// `w = "s"`, `3 - Sin(w)` has the frames `Sin argument 1`, `Negate argument
// 1`, `Add argument 1`.
//

const ce = new ComputeEngine();
ce.declare('w', 'any');
ce.assign('w', ce.string('s'));

function frames(json: unknown): unknown {
  const trace = (json as unknown[]).find(
    (x) => Array.isArray(x) && x[0] === 'ErrorTrace'
  ) as unknown[] | undefined;
  return trace?.slice(1);
}

const frame = (op: string, i: number) => ['ErrorFrame', `'${op}'`, i];
const outer = [frame('Negate', 1), frame('Add', 1)];

const cases: [string, unknown, unknown][] = [
  ['Sin', ['Subtract', 3, ['Sin', 'w']], [frame('Sin', 1), ...outer]],
  ['Cos', ['Subtract', 3, ['Cos', 'w']], [frame('Cos', 1), ...outer]],
  ['Tan', ['Subtract', 3, ['Tan', 'w']], [frame('Tan', 1), ...outer]],
  ['Arctan', ['Subtract', 3, ['Arctan', 'w']], [frame('Arctan', 1), ...outer]],
  ['Sinh', ['Subtract', 3, ['Sinh', 'w']], [frame('Sinh', 1), ...outer]],
  // `Exp(w)` is `Power(ExponentialE, w)` in canonical form.
  ['Exp', ['Subtract', 3, ['Exp', 'w']], [frame('Power', 2), ...outer]],
  [
    'Power, base',
    ['Subtract', 3, ['Power', 'w', 2]],
    [frame('Power', 1), ...outer],
  ],
  [
    'Power, exponent',
    ['Subtract', 3, ['Power', 2, 'w']],
    [frame('Power', 2), ...outer],
  ],
  ['Root', ['Subtract', 3, ['Root', 'w', 3]], [frame('Root', 1), ...outer]],
  // The generic check of the evaluated operands gives this frame already.
  ['Ln', ['Subtract', 3, ['Ln', 'w']], [frame('Ln', 1), ...outer]],
  [
    'Sin in the selected branch of If',
    ['If', ['Equal', 1, 1], ['Sin', 'w'], 0],
    [frame('Sin', 1), frame('If', 2)],
  ],
];

describe('THE FRAME OF A TYPE ERROR MADE BY THE HANDLER OF AN OPERATOR', () => {
  for (const [name, input, expected] of cases) {
    test(`${name} (evaluate)`, () => {
      expect(frames(ce.box(input as any).evaluate().json)).toEqual(expected);
    });
    test(`${name} (evaluateAsync)`, async () => {
      const v = await ce.box(input as any).evaluateAsync();
      expect(frames(v.json)).toEqual(expected);
    });
  }

  test('the value of the error is the refused string', () => {
    expect(ce.box(['Sin', 'w']).evaluate().json).toEqual([
      'Error',
      ['ErrorCode', "'incompatible-type'", "'number'", "'string'"],
      "'s'",
      ['ErrorTrace', frame('Sin', 1)],
    ]);
  });

  test('two positions that hold the same operand give no frame', () => {
    // No position can be named, so the error keeps no frame of its own.
    expect(frames(ce.box(['Power', 'w', 'w']).evaluate().json)).toBeUndefined();
  });

  test('a cell of a broadcast names the position in the cell', () => {
    // As for `Ln`, `Abs` and `Floor`.
    const v = ce.box(['Sin', ['List', 1, 'w']]).evaluate().json as unknown[];
    expect(frames(v[2])).toEqual([frame('Sin', 1)]);
  });

  test('the body of a called function adds no frame, nor does the call', () => {
    const ce2 = new ComputeEngine();
    ce2.parse('g(x) := \\sin(x)').evaluate();
    const v = ce2.box(['Add', 1, ['g', "'a'"]]).evaluate();
    expect(frames(v.json)).toEqual([frame('Add', 2)]);
  });

  test('the same, with evaluateAsync and a concurrent evaluation', async () => {
    // The asynchronous route reads the context stack of its own evaluation,
    // not the stack of another evaluation that runs at the same time.
    const ce2 = new ComputeEngine();
    ce2.parse('g(x) := \\sin(x)').evaluate();
    ce2.declare('w', 'any');
    ce2.assign('w', ce2.string('s'));
    const [inBody, direct] = await Promise.all([
      ce2.box(['Add', 1, ['g', "'a'"]]).evaluateAsync(),
      ce2.box(['Add', 1, ['Sin', 'w']]).evaluateAsync(),
    ]);
    expect(frames(inBody.json)).toEqual([frame('Add', 2)]);
    expect(frames(direct.json)).toEqual([frame('Sin', 1), frame('Add', 1)]);
  });
});

describe('THE EPSIL LOCATION OF THE ERROR', () => {
  function underlines(src: string): string[] {
    const result = executeEpsil(new ComputeEngine(), src);
    const at = src.indexOf('let v');
    return result.diagnostics
      .filter(
        (d) =>
          Array.isArray(d.message) &&
          d.message[0] === 'runtime-error' &&
          d.range[0] >= at
      )
      .map((d) => src.slice(d.range[0], d.range[1]));
  }

  test.each([
    ['let v = 3 - Sin(w)', 'w'],
    ['let v = Cos(w) * 2', 'w'],
    ['let v = w^2 + 1', 'w'],
    ['let v = 2^w + 1', 'w'],
    ['let v = Max(Sin(w), 1)', 'w'],
  ])('%s underlines %s', (stmt, expected) => {
    expect(underlines(`let w: any = "s"\n${stmt}\n0`)).toEqual([expected]);
  });

  test('an error in the body of a called function underlines the call', () => {
    // The frame `Sin argument 1` of the body would select the `y` of the
    // `Sin(y)` of the statement.
    const src =
      'let y = 2\nfunction g(x) { Sin(x) }\nlet v = Sin(y) + g("a")\n0';
    expect(underlines(src)).toEqual(['g("a")']);
  });
});
