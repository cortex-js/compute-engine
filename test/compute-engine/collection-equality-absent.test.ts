/**
 * A whole-collection `Equal`/`NotEqual` whose element recursion meets a pair
 * with an absent cell (`Missing`).
 *
 * A comparison is two-valued (user decision of 2026-11-02, two-valued
 * comparisons, `docs/ERROR-MODEL.md`): an absent cell is undefined, as a
 * `NaN` cell is, so such a pair makes the whole `Equal` `False` and the
 * whole `NotEqual` `True`. As a branch condition, the comparison takes its
 * arm like any other boolean.
 *
 * From the user ruling of 2026-09-21 to 2026-11-02 such a comparison was
 * UNDECIDED: the interpreter answered `Missing`, the branch took no arm.
 *
 * The compiled JavaScript kernel still answers `NaN` for such a comparison
 * (`eqTensor`, `compilation/javascript-runtime.ts`). A compiled value
 * computed from an absent value is not specified
 * (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code"), so the compiled
 * assertions below record the current output and are not a contract.
 *
 * What did not change:
 *  - two collections whose element pairs are ALL decided keep their answer;
 *  - a length mismatch is `False`;
 *  - the ELEMENT-WISE shape (a collection against a scalar) compares each
 *    cell: the absent cells are `False`;
 *  - a pair left undecided by FREE VARIABLES is not absence: `[x] = [y]`
 *    stays inert, exactly as the scalar `x = y` does.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function engine(): ComputeEngine {
  return new ComputeEngine();
}

/** What the interpreter answers, under `evaluate()`. */
function ev(ce: ComputeEngine, expr: unknown): string {
  return ce.box(expr as any).evaluate().toString();
}

/** What the interpreter answers, under `.N()`. */
function nv(ce: ComputeEngine, expr: unknown): string {
  return ce.box(expr as any).N().toString();
}

/** What the compiled JavaScript kernel answers. */
function js(ce: ComputeEngine, expr: unknown): unknown {
  const r = compile(ce.box(expr as any), {
    to: 'javascript',
    fallback: false,
  });
  if (!r.success) throw new Error(r.error?.message ?? 'declined');
  return r.run!({});
}

describe('whole-collection Equal with an absent cell', () => {
  test('two absent cells at the same position make it False', () => {
    const ce = engine();
    const e = ['Equal', ['List', 1, 'Missing'], ['List', 1, 'Missing']];
    expect(ev(ce, e)).toBe('"False"');
    expect(nv(ce, e)).toBe('"False"');
  });

  test('an absent cell against a present one makes it False', () => {
    const ce = engine();
    const e = ['Equal', ['List', 1, 'Missing'], ['List', 1, 2]];
    expect(ev(ce, e)).toBe('"False"');
    expect(nv(ce, e)).toBe('"False"');
  });

  test('a pair with an absent cell is False, as an unequal pair is', () => {
    const ce = engine();
    const e = ['Equal', ['List', 1, 'Missing', 3], ['List', 2, 'Missing', 3]];
    expect(ev(ce, e)).toBe('"False"');
  });

  test('a nested collection with an absent cell is False', () => {
    const ce = engine();
    const e = [
      'Equal',
      ['List', ['List', 1, 'Missing']],
      ['List', ['List', 1, 2]],
    ];
    expect(ev(ce, e)).toBe('"False"');
  });

  test('an absent cell opposite a nested collection is False', () => {
    const ce = engine();
    const e = ['Equal', ['List', ['List', 1, 2]], ['List', 'Missing']];
    expect(ev(ce, e)).toBe('"False"');
  });
});

describe('whole-collection NotEqual with an absent cell', () => {
  test('the negation of Equal: True', () => {
    const ce = engine();
    const e = ['NotEqual', ['List', 1, 'Missing'], ['List', 1, 'Missing']];
    expect(ev(ce, e)).toBe('"True"');
    expect(nv(ce, e)).toBe('"True"');
  });

  test('an absent cell against a present one', () => {
    const ce = engine();
    const e = ['NotEqual', ['List', 1, 'Missing'], ['List', 1, 2]];
    expect(ev(ce, e)).toBe('"True"');
  });
});

describe('collections whose element pairs are all decided', () => {
  test('equal lists are `True`', () => {
    const ce = engine();
    const e = ['Equal', ['List', 1, 2], ['List', 1, 2]];
    expect(ev(ce, e)).toBe('"True"');
    expect(nv(ce, e)).toBe('"True"');
    expect(js(ce, e)).toBe(true);
  });

  test('unequal lists are `False`', () => {
    const ce = engine();
    const e = ['Equal', ['List', 1, 2], ['List', 1, 3]];
    expect(ev(ce, e)).toBe('"False"');
    expect(js(ce, e)).toBe(false);
  });

  test('`NotEqual` of unequal lists is `True`', () => {
    const ce = engine();
    const e = ['NotEqual', ['List', 1, 2], ['List', 1, 3]];
    expect(ev(ce, e)).toBe('"True"');
    expect(js(ce, e)).toBe(true);
  });

  test('a `NaN` cell is a number that equals nothing, not an absent cell', () => {
    const ce = engine();
    const e = ['Equal', ['List', 1, 'NaN'], ['List', 1, 'NaN']];
    expect(ev(ce, e)).toBe('"False"');
    expect(js(ce, e)).toBe(false);
  });

  test('free variables leave the equation inert, not marked', () => {
    const ce = engine();
    expect(ev(ce, ['Equal', ['List', 'x'], ['List', 'y']])).toBe('[x] == [y]');
  });
});

// In each test below, the compiled value is `NaN` where the interpreter
// takes an arm: the compiled value is not specified (see the header).
describe('a comparison with an absent cell as a branch condition', () => {
  test('`Which` takes the default arm', () => {
    const ce = engine();
    const e = [
      'Which',
      ['Equal', ['List', 1, 'Missing'], ['List', 1, 'Missing']],
      1,
      'True',
      0,
    ];
    expect(ev(ce, e)).toBe('0');
    // A relation with a NaN operand is decided the same way: a `NotEqual`
    // with a NaN operand is `True` and takes its arm (user decision of
    // 2026-10-23), an `Equal` with a NaN operand is `False` and takes the
    // default arm (user decision of 2026-10-20).
    const nan = ['Which', ['NotEqual', 'NaN', 5], 1, 'True', 0];
    expect(ev(ce, nan)).toBe('1');
    expect(js(ce, nan)).toBe(1);
    const eq = ['Which', ['Equal', 'NaN', 5], 1, 'True', 0];
    expect(ev(ce, eq)).toBe('0');
    expect(js(ce, eq)).toBe(0);
  });

  test('`If` over `NotEqual` takes the then arm', () => {
    const ce = engine();
    const e = [
      'If',
      ['NotEqual', ['List', 1, 'Missing'], ['List', 1, 'Missing']],
      1,
      0,
    ];
    expect(ev(ce, e)).toBe('1');
  });

  test('`Not` of the comparison is True', () => {
    const ce = engine();
    const e = [
      'Which',
      ['Not', ['Equal', ['List', 1, 'Missing'], ['List', 1, 'Missing']]],
      1,
      'True',
      0,
    ];
    expect(ev(ce, e)).toBe('1');
  });

  test('a decided collection comparison still branches', () => {
    const ce = engine();
    const yes = ['Which', ['Equal', ['List', 1, 2], ['List', 1, 2]], 1, 'True', 0];
    const no = ['Which', ['Equal', ['List', 1, 2], ['List', 1, 3]], 1, 'True', 0];
    expect(ev(ce, yes)).toBe('1');
    expect(js(ce, yes)).toBe(1);
    expect(ev(ce, no)).toBe('0');
    expect(js(ce, no)).toBe(0);
  });
});
