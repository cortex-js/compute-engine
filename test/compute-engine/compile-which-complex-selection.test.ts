/**
 * COMPILED element-wise `Which`/`If` selection whose value ARM is complex.
 *
 * The JavaScript lowering (`_SYS.select`, see
 * `test/compute-engine/compile-elementwise-which.test.ts` for the real-armed
 * tables) used to refuse any arm whose static type was complex, on the grounds
 * that a compiled complex value is a `{ re, im }` object with no cell
 * convention inside a selection array. That premise was wrong twice over. An
 * arm such as `Sqrt(x)` over an unknown-sign `x` types complex while every
 * runtime value is real, so the refusal caught expressions that never produce a
 * complex cell at all; and where a cell IS complex, the convention already
 * exists — a compiled array mixes plain numbers with `{ re, im }` objects
 * wherever a complex helper runs element-wise, exactly as the interpreter's own
 * element-wise selection mixes real and complex cells.
 *
 * The spine of every case is INTERPRETER PARITY, projected the way a
 * JavaScript target represents a value: a real cell is a number, a complex cell
 * is `{ re, im }`, an unmatched cell is NaN.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('x', 'real');

/**
 * Interpretation, projected onto the JavaScript target's value convention: a
 * complex number is a `{ re, im }` object, every other number is a plain
 * number (the complex helpers collapse a zero imaginary part back to a number,
 * so `_SYS.csqrt({re: 6, im: 0})` is `2.449…`, not `{re: 2.449…, im: 0}`).
 */
function interpreted(expr: Expression): unknown {
  const project = (x: Expression): unknown => {
    if (x.symbol === 'True') return true;
    if (x.symbol === 'False') return false;
    if (x.symbol === 'Nothing' || x.symbol === 'Missing') return NaN;
    if (x.operator === 'Error') return NaN;
    // Iterated rather than read off `ops`: `Map` is lazy, so `.N()` of a
    // comprehension is still a `Map` node whose elements only appear when the
    // collection is walked.
    if (x.isCollection) return [...x.each()].map(project);
    return x.im !== 0 ? { re: x.re, im: x.im } : x.re;
  };
  return project(expr.N());
}

/**
 * Compile `expr` in `mode`, the complex mode by default, run it, and assert
 * it matches interpretation.
 *
 * Run with folding both ON and OFF: with folding on, the whole literal subtree
 * may be evaluated and emitted as a value, which never exercises the
 * `_SYS.select` lowering these cases are about.
 */
function parity(
  expr: Expression,
  mode: 'strict' | 'complex' = 'complex'
): unknown {
  let value: unknown;
  for (const constantFold of [true, false]) {
    const r = compile(expr, { fallback: false, constantFold, mode });
    expect(r?.success).toBe(true);
    value = r!.run!({});
    expect(value).toEqual(interpreted(expr));
  }
  return value;
}

/** The emitted source in `mode`, the complex mode by default, with
 * compile-time constant folding turned off. */
function code(
  expr: Expression,
  mode: 'strict' | 'complex' = 'complex'
): string {
  return compile(expr, { fallback: false, constantFold: false, mode })!.code ?? '';
}

const L = ['List', 4, 9, 16];

describe('a complex-TYPED arm whose runtime cells are real', () => {

  test('the same shape spelled per element with `Map` is unchanged', () => {
    // The consumer's own workaround, kept as a control: it compiled before the
    // arm-complexness refusal was lifted and must still agree cell for cell.
    const expr = ce.box([
      'Map',
      [
        'Function',
        [
          'Which',
          ['Less', '_e', 10],
          ['Sqrt', ['Subtract', '_e', 3]],
          'True',
          0,
        ],
        '_e',
      ],
      L,
    ] as any);
    expect(parity(expr)).toEqual([1, Math.sqrt(6), 0]);
  });

});

