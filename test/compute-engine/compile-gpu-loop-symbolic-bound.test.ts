/**
 * A `Loop` over a `Range` on the shader targets: the bounds and the step are
 * read at compile time, and a decline names the requirement.
 *
 * The JavaScript target reads a symbolic bound (`Range(1, n)`, `n` with no
 * value) at run time, so the loop compiles there; the GLSL and WGSL targets
 * have no such lowering. Their decline said "bounds must be finite numbers",
 * which describes an infinite literal bound (`Range(1, +oo)`), not a symbolic
 * one. A symbol with a value (`N := 4`) gives its value through `.re`, as the
 * JavaScript target folds it, and still compiles.
 *
 * The step of the range was ignored: `Range(1, 10, 3)` compiled to a loop
 * over every integer from 1 to 10, where the JavaScript target visits 1, 4, 7
 * and 10, and a negative step gave a loop with no iteration.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.assign('N', 4);

/** The shader code, or the message of the decline under `fallback: false`. */
function shader(expr: unknown, to: 'glsl' | 'wgsl'): string {
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

const BOUNDS_MESSAGE =
  'DECLINED: Could not compile `Loop` on this target: the bounds of the `Range` must be numbers known at compile time (a number literal, or a symbol with a value)';

describe('a Loop over a Range on a shader target', () => {
  test.each(['glsl', 'wgsl'] as const)(
    '%s declines a symbolic bound with no value and names the requirement',
    (to) => {
      expect(shader(loop([1, 'n']), to)).toBe(BOUNDS_MESSAGE);
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s keeps the "finite" message for an infinite literal bound',
    (to) => {
      expect(shader(loop([1, 'PositiveInfinity']), to)).toBe(
        'DECLINED: Could not compile `Loop`: bounds must be finite numbers'
      );
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s compiles a bound that is a symbol with a value',
    (to) => {
      expect(shader(loop([1, 'N']), to)).toContain('j <= 4; j++');
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s advances the counter by the step of the Range',
    (to) => {
      expect(shader(loop([1, 10, 3]), to)).toContain('j <= 10; j += 3');
      expect(shader(loop([10, 1, -3]), to)).toContain('j >= 1; j += -3');
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s declines a step that is not a non-zero integer',
    (to) => {
      const message =
        'DECLINED: Could not compile `Loop` on this target: the step of the `Range` must be a non-zero integer known at compile time';
      expect(shader(loop([1, 10, 0.5]), to)).toBe(message);
      expect(shader(loop([1, 10, 0]), to)).toBe(message);
      expect(shader(loop([1, 10, 'n']), to)).toBe(message);
    }
  );

  test('the JavaScript target compiles the symbolic bound and reads it at run time', () => {
    // `Loop` evaluates to `Nothing`; the sum is read back through a local.
    const sumTo = [
      'Block',
      ['Declare', 'c', "'integer'"],
      ['Assign', 'c', 0],
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
