/**
 * A `Loop` over a `Range` on the shader targets: a bound with a value known
 * at compile time is written in the `for` statement, and any other bound is
 * read once, before the loop, into an integer temporary, as the JavaScript
 * target reads it at run time. The step is read at compile time, and a
 * decline names the requirement.
 *
 * A symbol with a value (`N := 4`) gives its value through `.re`, as the
 * JavaScript target folds it. A symbolic bound with no value (`Range(1, n)`,
 * an input of the shader) and a local of the function (`Range(1, e)`) are
 * read at run time; such a bound must have the static type `integer`. The
 * value of a local is never read at compile time: `let e = 0; …; e = m;
 * for j in 1..e` ran the loop up to the value of the declaration. An
 * infinite literal bound (`Range(1, +oo)`) keeps its own message.
 *
 * The step of the range was ignored: `Range(1, 10, 3)` compiled to a loop
 * over every integer from 1 to 10, where the JavaScript target visits 1, 4, 7
 * and 10, and a negative step gave a loop with no iteration.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('x', 'real');
ce.assign('N', 4);

/** The shader code, or the message of the decline under `fallback: false`. */
function shader(expr: unknown, to: 'glsl'): string {
  try {
    const r = compile(ce.box(expr as never), { to, fallback: false });
    return r.success ? (r.code ?? '') : `DECLINED: ${r.error ?? ''}`;
  } catch (e) {
    return `DECLINED: ${(e as Error).message}`;
  }
}

const loop = (range: unknown[]) => [
  'Loop',
  ['Add', 'j', 1],
  ['Element', 'j', ['Range', ...range]],
];

/**
 * The same loop as a statement of a block whose value is `s`. A loop whose
 * value is used does not compile (its value is `Nothing`), so the tests of
 * the generated loop code put it in a statement position. The body writes
 * `s`, so the loop is not removed as dead code.
 */
const statementLoop = (range: unknown[]) => [
  'Block',
  ['Declare', 's', "'real'", 0],
  ['Loop', ['Assign', 's', ['Add', 's', 'j']], ['Element', 'j', ['Range', ...range]]],
  's',
];

describe('a Loop over a Range on a shader target', () => {
  test.each([
    ['glsl', 'int _tv1 = int(n);\nfor (int j = 1; j <= _tv1; j++) {'],
  ] as const)(
    '%s reads a symbolic integer bound with no value once, before the loop',
    (to, text) => {
      expect(shader(statementLoop([1, 'n']), to)).toContain(text);
    }
  );

  test.each(['glsl'] as const)(
    '%s reads a bound that `vars` maps to an input from that input, not from its stored value',
    (to) => {
      const engine = new ComputeEngine();
      engine.declare('N', 'integer');
      engine.assign('N', 4);
      const r = compile(engine.box(statementLoop([1, 'N']) as never), {
        to,
        fallback: false,
        vars: { N: 'u_N' },
      });
      expect(r.success).toBe(true);
      expect(r.code).toContain('int(u_N)');
      expect(r.code).not.toContain('j <= 4;');
    }
  );

  test.each(['glsl'] as const)(
    '%s puts the statements that a run-time bound hoists in the prologue of its clause',
    (to) => {
      // The bound `Sum` of the inner clause is a loop-form sum over the
      // local `e`, which the body of the outer loop changes. Its loop runs
      // inside the outer loop, before the inner `for`, so that each entry
      // of the inner loop reads the value of that moment.
      // The GLSL fragment refuses a loop with two clauses.
      const engine = new ComputeEngine();
      expect(() =>
        compile(
          engine.box([
            'Block',
            ['Declare', 'e', "'integer'", 2],
            ['Declare', 's', "'real'", 0],
            [
              'Loop',
              ['Block', ['Assign', 'e', ['Add', 'e', 1]], ['Assign', 's', ['Add', 's', 'j']]],
              ['Element', 'i', ['Range', 1, 2]],
              ['Element', 'j', ['Range', 1, ['Sum', ['Floor', ['Divide', 'm', 2]], ['Limits', 'm', 1, 'e']]]],
            ],
            's',
          ] as never),
          { to, fallback: false, constantFold: false }
        )
      ).toThrow(
        /`Loop` is in the GLSL fragment only as a counted loop over an integer range/
      );
    }
  );

  test.each(['glsl'] as const)(
    '%s declines a run-time bound whose static type is not integer',
    (to) => {
      expect(shader(statementLoop([1, 'x']), to)).toBe(
        'DECLINED: The upper bound `x` of `Loop` is read at run time, and the GLSL fragment admits such a bound only with the static type `integer` (it has the type `real`).'
      );
    }
  );

  test.each(['glsl'] as const)(
    '%s reads the bound that is a local of the function at run time, not from its declaration',
    (to) => {
      // `e` is declared 0 and assigned 3 in the first loop. The second loop
      // runs to the value of `e` at run time, so its bound is read before
      // it, not written as the 0 of the declaration.
      const code = shader(
        [
          'Block',
          ['Declare', 'e', "'integer'", 0],
          ['Declare', 's', "'real'", 0],
          [
            'Loop',
            ['If', ['Greater', 'm', 2], ['Block', ['Assign', 'e', 'm'], ['Break']]],
            ['Element', 'm', ['Range', 1, 5]],
          ],
          [
            'Loop',
            ['Assign', 's', ['Add', 's', 'm']],
            ['Element', 'm', ['Range', 1, 'e']],
          ],
          's',
        ],
        to
      );
      expect(code).toContain('int(e)');
      expect(code).not.toContain('m <= 0;');
    }
  );

  test.each(['glsl'] as const)(
    '%s keeps the "finite" message for an infinite literal bound',
    (to) => {
      expect(shader(loop([1, 'PositiveInfinity']), to)).toBe(
        'DECLINED: The upper bound `+oo` of `Loop` is not a finite number.'
      );
    }
  );

  test.each(['glsl'] as const)(
    '%s compiles a bound that is a symbol with a value',
    (to) => {
      expect(shader(statementLoop([1, 'N']), to)).toContain('j <= 4; j++');
    }
  );

  test.each(['glsl'] as const)(
    '%s advances the counter by the step of the Range',
    (to) => {
      expect(shader(statementLoop([1, 10, 3]), to)).toContain(
        'j <= 10; j += 3'
      );
      expect(shader(statementLoop([10, 1, -3]), to)).toContain(
        'j >= 1; j += -3'
      );
    }
  );

  test.each(['glsl'] as const)(
    '%s declines a step that is not a non-zero integer',
    (to) => {
      // The GLSL fragment refuses a loop that stands where a value is
      // expected, before the step of its range is read.
      const message =
        /^DECLINED: `Loop\(.*\)` is a statement, and it stands where a value is expected\.$/;
      expect(shader(loop([1, 10, 0.5]), to)).toMatch(message);
      expect(shader(loop([1, 10, 0]), to)).toMatch(message);
      expect(shader(loop([1, 10, 'n']), to)).toMatch(message);
    }
  );

  test('the JavaScript target compiles the symbolic bound and reads it at run time', () => {
    // `Loop` evaluates to `Nothing`; the sum is read back through a local.
    const sumTo = [
      'Block',
      ['Declare', 'c', "'integer'", 0],
      [
        'Loop',
        ['Assign', 'c', ['Add', 'c', 'j']],
        ['Element', 'j', ['Range', 1, 'n', 3]],
      ],
      'c',
    ];
    const r = compile(ce.box(sumTo as never));
    expect(r.success).toBe(true);
    // 1 + 4 + 7 + 10: the same iterations as the shader loop above.
    expect(r.run({ n: 10 })).toBe(22);
  });
});
