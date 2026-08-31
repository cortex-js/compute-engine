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
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

/**
 * Interpretation, projected onto the JavaScript target's value convention: a
 * complex number is a `{ re, im }` object, every other number is a plain
 * number (the complex helpers collapse a zero imaginary part back to a number,
 * so `_SYS.csqrt({re: 6, im: 0})` is `2.449…`, not `{re: 2.449…, im: 0}`).
 */
function interpreted(expr: BoxedExpression): unknown {
  const project = (x: BoxedExpression): unknown => {
    if (x.symbol === 'True') return true;
    if (x.symbol === 'False') return false;
    if (x.symbol === 'Nothing' || x.symbol === 'Undefined') return NaN;
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
 * Compile `expr`, run it, and assert it matches interpretation.
 *
 * Run with folding both ON and OFF: with folding on, the whole literal subtree
 * may be evaluated and emitted as a value, which never exercises the
 * `_SYS.select` lowering these cases are about.
 */
function parity(expr: BoxedExpression): unknown {
  let value: unknown;
  for (const constantFold of [true, false]) {
    const r = compile(expr, { fallback: false, constantFold });
    expect(r?.success).toBe(true);
    value = r!.run!({});
    expect(value).toEqual(interpreted(expr));
  }
  return value;
}

/** The emitted source, with compile-time constant folding turned off. */
function code(expr: BoxedExpression): string {
  return compile(expr, { fallback: false, constantFold: false })!.code ?? '';
}

const L = ['List', 4, 9, 16];
const listCondition = ['Less', L, 10];

describe('a complex-TYPED arm whose runtime cells are real', () => {
  test('the reported shape: `Sqrt(elements - 3)` under a list condition', () => {
    // `Sqrt` of an unknown-sign operand types complex, so this arm was refused
    // even though 4, 9 and 16 all give a non-negative radicand.
    const expr = ce.box([
      'Which',
      listCondition,
      ['Sqrt', ['Subtract', L, 3]],
      'True',
      0,
    ] as any);
    expect(code(expr)).toContain('_SYS.select');
    expect(parity(expr)).toEqual([1, Math.sqrt(6), 0]);
  });

  test('the same shape spelled per element with `Map` is unchanged', () => {
    // The consumer's own workaround, kept as a control: it compiled before the
    // arm-complexness refusal was lifted and must still agree cell for cell.
    const expr = ce.box([
      'Map',
      [
        'Function',
        ['Which', ['Less', '_e', 10], ['Sqrt', ['Subtract', '_e', 3]], 'True', 0],
        '_e',
      ],
      L,
    ] as any);
    expect(parity(expr)).toEqual([1, Math.sqrt(6), 0]);
  });

  test('a provably-real arm still takes the plain real lowering', () => {
    const expr = ce.box([
      'Which',
      listCondition,
      ['Sqrt', ['Power', L, 2]],
      'True',
      0,
    ] as any);
    expect(code(expr)).toContain('Math.sqrt');
    expect(parity(expr)).toEqual([4, 9, 0]);
  });
});

describe('an arm that is genuinely complex at run time', () => {
  test('complex cells and real cells share one selection array', () => {
    const expr = ce.box([
      'Which',
      listCondition,
      ['Sqrt', ['Negate', L]],
      'True',
      0,
    ] as any);
    expect(code(expr)).toContain('_SYS.select');
    expect(parity(expr)).toEqual([{ re: 0, im: 2 }, { re: 0, im: 3 }, 0]);
  });

  test('an arm compiles the same inside a selection as on its own', () => {
    // The selection adds no coercion: the arm's own emission is what lands in
    // the cells, so the two runs must agree at every selected position.
    const arm = ce.box(['Sqrt', ['Negate', L]] as any);
    const alone = compile(arm, { fallback: false, constantFold: false })!;
    expect(alone.run!({})).toEqual([
      { re: 0, im: 2 },
      { re: 0, im: 3 },
      { re: 0, im: 4 },
    ]);
    const expr = ce.box([
      'Which',
      ['List', 'True', 'True', 'False'],
      ['Sqrt', ['Negate', L]],
      'True',
      0,
    ] as any);
    expect(parity(expr)).toEqual([{ re: 0, im: 2 }, { re: 0, im: 3 }, 0]);
  });

  test('a SCALAR complex arm lifts whole to its selected positions', () => {
    // `select` tells a per-element array arm from a lifted whole one with
    // `Array.isArray`, which a `{ re, im }` object fails — so the one complex
    // value is broadcast, not indexed apart into `re` and `im`.
    const expr = ce.box([
      'Which',
      listCondition,
      ['Sqrt', -2],
      'True',
      0,
    ] as any);
    const s = Math.sqrt(2);
    expect(parity(expr)).toEqual([{ re: 0, im: s }, { re: 0, im: s }, 0]);
  });

  test('a complex LITERAL arm over a boolean-list condition', () => {
    // This exact shape was pinned as a `Fail closed (D6)` decline until the
    // arm-complexness refusal was lifted.
    const expr = ce.box([
      'Which',
      ['List', 'True', 'False'],
      ['Complex', 1, 2],
      'True',
      0,
    ] as any);
    expect(code(expr)).toContain('_SYS.select');
    expect(parity(expr)).toEqual([{ re: 1, im: 2 }, 0]);
  });

  test('every arm complex', () => {
    const expr = ce.box([
      'Which',
      listCondition,
      ['Sqrt', ['Negate', L]],
      'True',
      ['Sqrt', -9],
    ] as any);
    expect(parity(expr)).toEqual([
      { re: 0, im: 2 },
      { re: 0, im: 3 },
      { re: 0, im: 3 },
    ]);
  });

  test('a complex arm in the `If` spelling, in either branch', () => {
    const thenArm = ce.box([
      'If',
      listCondition,
      ['Sqrt', ['Negate', L]],
      0,
    ] as any);
    expect(parity(thenArm)).toEqual([{ re: 0, im: 2 }, { re: 0, im: 3 }, 0]);
    const elseArm = ce.box([
      'If',
      listCondition,
      0,
      ['Sqrt', ['Negate', L]],
    ] as any);
    expect(parity(elseArm)).toEqual([0, 0, { re: 0, im: 4 }]);
  });

  test('a position no clause matched is still NaN (R4)', () => {
    const expr = ce.box([
      'Which',
      listCondition,
      ['Sqrt', ['Negate', L]],
    ] as any);
    expect(parity(expr)).toEqual([{ re: 0, im: 2 }, { re: 0, im: 3 }, NaN]);
  });

  test('a complex arm among three clauses', () => {
    const expr = ce.box([
      'Which',
      ['Less', L, 5],
      ['Sqrt', ['Negate', L]],
      ['Less', L, 10],
      100,
      'True',
      0,
    ] as any);
    expect(parity(expr)).toEqual([{ re: 0, im: 2 }, 100, 0]);
  });
});

describe('what still declines', () => {
  test('a complex-valued CONDITION operand fails closed', () => {
    // The complex numbers are not ordered, so the interpreter leaves the
    // comparison symbolic; lifting the arm refusal does not reach conditions.
    const expr = ce.box([
      'Which',
      ['Less', ['Sqrt', ['Negate', L]], 10],
      1,
      'True',
      0,
    ] as any);
    expect(() =>
      compile(expr, { fallback: false, constantFold: false })
    ).toThrow(/Fail closed/);
  });

  test('scalar arithmetic over a list-valued selection still fails closed', () => {
    // The JavaScript target has no list arithmetic; a complex arm does not
    // change that, and the bare arm declines the same way.
    const expr = ce.box([
      'Add',
      ['Which', listCondition, ['Sqrt', ['Negate', L]], 'True', 0],
      1,
    ] as any);
    expect(() =>
      compile(expr, { fallback: false, constantFold: false })
    ).toThrow(/Fail closed/);
  });

  test('a SCALAR complex `Which` keeps its ternary lowering', () => {
    const expr = ce.box([
      'Which',
      ['Greater', 'x', 1],
      ['Complex', 1, 2],
      'True',
      0,
    ] as any);
    const emitted = code(expr);
    expect(emitted).not.toContain('_SYS.select');
    expect(emitted).toContain('?');
  });
});
