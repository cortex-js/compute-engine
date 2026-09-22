/**
 * A whole-collection `Equal`/`NotEqual` whose element recursion meets a pair
 * with no answer is UNDECIDED (user ruling of 2026-09-21).
 *
 * The marker is the one the absence contract already uses: `Missing` in the
 * interpreter, `NaN` in compiled code. `NotEqual` answers the SAME marker, so
 * neither operator reports a confident truth it cannot support.
 *
 * What the ruling changed:
 *  - `Equal([1, Missing], [1, Missing])` answered `True` and compiled to
 *    `false`; it now answers the marker on both lanes.
 *  - `Equal([1, Missing], [1, 2])` stayed unevaluated in the interpreter and
 *    compiled to `false`; it now answers the marker on both lanes.
 *  - An undecided pair wins over a decidedly unequal one:
 *    `Equal([1, Missing, 3], [2, Missing, 3])` is the marker, not `False`.
 *
 * What it left alone:
 *  - two collections whose element pairs are ALL decided keep their answer;
 *  - a length mismatch is `False`, because no value an absent cell could hold
 *    makes 2 elements equal 3;
 *  - the ELEMENT-WISE shape (a collection against a scalar) still marks
 *    exactly the absent positions;
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
  test('two absent cells at the same position are undecided', () => {
    const ce = engine();
    const e = ['Equal', ['List', 1, 'Missing'], ['List', 1, 'Missing']];
    expect(ev(ce, e)).toBe('"Missing"');
    expect(nv(ce, e)).toBe('"Missing"');
    expect(js(ce, e)).toBeNaN();
  });

  test('an absent cell against a present one is undecided', () => {
    const ce = engine();
    const e = ['Equal', ['List', 1, 'Missing'], ['List', 1, 2]];
    expect(ev(ce, e)).toBe('"Missing"');
    expect(nv(ce, e)).toBe('"Missing"');
    expect(js(ce, e)).toBeNaN();
  });

  test('an undecided pair wins over a decidedly unequal pair', () => {
    const ce = engine();
    const e = ['Equal', ['List', 1, 'Missing', 3], ['List', 2, 'Missing', 3]];
    expect(ev(ce, e)).toBe('"Missing"');
    expect(js(ce, e)).toBeNaN();
  });

  test('`Undefined` is an absent cell too', () => {
    const ce = engine();
    const e = ['Equal', ['List', 1, 'Undefined'], ['List', 1, 'Undefined']];
    expect(ev(ce, e)).toBe('"Missing"');
    expect(js(ce, e)).toBeNaN();
  });

  test('a nested collection carries the marker up', () => {
    const ce = engine();
    const e = [
      'Equal',
      ['List', ['List', 1, 'Missing']],
      ['List', ['List', 1, 2]],
    ];
    expect(ev(ce, e)).toBe('"Missing"');
    expect(js(ce, e)).toBeNaN();
  });

  test('an absent cell opposite a nested collection is undecided', () => {
    const ce = engine();
    const e = ['Equal', ['List', ['List', 1, 2]], ['List', 'Missing']];
    expect(ev(ce, e)).toBe('"Missing"');
    expect(js(ce, e)).toBeNaN();
  });
});

describe('whole-collection NotEqual with an absent cell', () => {
  test('the same marker, never a confident `True`', () => {
    const ce = engine();
    const e = ['NotEqual', ['List', 1, 'Missing'], ['List', 1, 'Missing']];
    expect(ev(ce, e)).toBe('"Missing"');
    expect(nv(ce, e)).toBe('"Missing"');
    expect(js(ce, e)).toBeNaN();
  });

  test('an absent cell against a present one', () => {
    const ce = engine();
    const e = ['NotEqual', ['List', 1, 'Missing'], ['List', 1, 2]];
    expect(ev(ce, e)).toBe('"Missing"');
    expect(js(ce, e)).toBeNaN();
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

  test('a length mismatch is `False`, absent cells included', () => {
    const ce = engine();
    expect(ev(ce, ['Equal', ['List', 1, 2], ['List', 1, 2, 3]])).toBe(
      '"False"'
    );
    expect(js(ce, ['Equal', ['List', 1, 2], ['List', 1, 2, 3]])).toBe(false);
    expect(ev(ce, ['Equal', ['List', 1, 'Missing'], ['List', 1, 2, 3]])).toBe(
      '"False"'
    );
    expect(js(ce, ['Equal', ['List', 1, 'Missing'], ['List', 1, 2, 3]])).toBe(
      false
    );
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

describe('the element-wise shape is unchanged', () => {
  test('a collection against a scalar marks exactly the absent positions', () => {
    const ce = engine();
    const e = ['Equal', ['List', 1, 'Missing'], 1];
    expect(ev(ce, e)).toBe('["True","Missing"]');
    expect(nv(ce, e)).toBe('["True","Missing"]');
    const compiled = js(ce, e) as unknown[];
    expect(compiled).toHaveLength(2);
    expect(compiled[0]).toBe(true);
    expect(compiled[1]).toBeNaN();
  });
});

describe('the marker as a branch condition', () => {
  test('`Which` takes no arm, as it does for a NaN comparison', () => {
    const ce = engine();
    const e = [
      'Which',
      ['Equal', ['List', 1, 'Missing'], ['List', 1, 'Missing']],
      1,
      'True',
      0,
    ];
    expect(ev(ce, e)).toBe('"Missing"');
    expect(js(ce, e)).toBeNaN();
    // The behavior this aligns with.
    const nan = ['Which', ['Equal', 'NaN', 5], 1, 'True', 0];
    expect(ev(ce, nan)).toBe('"Missing"');
    expect(js(ce, nan)).toBeNaN();
  });

  test('`If` takes no arm either', () => {
    const ce = engine();
    const e = [
      'If',
      ['NotEqual', ['List', 1, 'Missing'], ['List', 1, 'Missing']],
      1,
      0,
    ];
    expect(ev(ce, e)).toBe('"Missing"');
    expect(js(ce, e)).toBeNaN();
  });

  test('`Not` of the marker takes no arm either', () => {
    const ce = engine();
    const e = [
      'Which',
      ['Not', ['Equal', ['List', 1, 'Missing'], ['List', 1, 'Missing']]],
      1,
      'True',
      0,
    ];
    expect(ev(ce, e)).toBe('"Missing"');
    expect(js(ce, e)).toBeNaN();
  });

  test('a connective folds the marker by the Kleene table', () => {
    const ce = engine();
    const marked = ['Equal', ['List', 1, 'Missing'], ['List', 1, 'Missing']];
    const which = (cond: unknown) => ['Which', cond, 1, 'True', 0];
    // Nothing settles the connective, so no arm is taken.
    expect(ev(ce, which(['And', marked, 'True']))).toBe('"Missing"');
    expect(js(ce, which(['And', marked, 'True']))).toBeNaN();
    expect(ev(ce, which(['Or', marked, 'False']))).toBe('"Missing"');
    expect(js(ce, which(['Or', marked, 'False']))).toBeNaN();
    // A settling sibling decides the connective whatever the marker says.
    expect(ev(ce, which(['And', marked, 'False']))).toBe('0');
    expect(js(ce, which(['And', marked, 'False']))).toBe(0);
    expect(ev(ce, which(['Or', marked, 'True']))).toBe('1');
    expect(js(ce, which(['Or', marked, 'True']))).toBe(1);
  });

  test('an operand that is only POSSIBLY a collection is read the same way', () => {
    // The branch analysis classifies a condition's operands exactly as the
    // equality emitter does (`CompileTarget.collectionEqualityOperand`): one
    // operand that MAY be an array at run time — an opaque `-> unknown`
    // application, a scalar-or-list union — is enough to send the pair to
    // `_SYS.eq`, whose answer is the marker. Read off the operands instead,
    // the array `h(x)` tested as a decided value and the marker's falsiness
    // took the else arm.
    //
    // The statement form of `If` is where this shows: the expression forms
    // go through the element-wise selection helper, which reads the marker
    // correctly already.
    const loop = (cond: unknown) => [
      'Block',
      ['Declare', 'y', 'number'],
      ['Assign', 'y', 0],
      [
        'Loop',
        ['Block', ['If', cond, ['Assign', 'y', 1], ['Assign', 'y', 2]], ['Break']],
      ],
      'y',
    ];
    const jsLoop = (
      declare: (ce: ComputeEngine) => unknown,
      vars: Record<string, unknown>,
      options: Record<string, unknown> = {}
    ): unknown => {
      const ce = engine();
      const expr = ce.box(declare(ce) as any);
      const r = compile(expr, { to: 'javascript', fallback: false, ...options });
      if (!r.success) throw new Error(r.error ?? 'declined');
      return r.run!(vars as any);
    };
    // A `(number) -> unknown` host function, bound at run time to an array.
    const withH = (ce: ComputeEngine) => {
      ce.declare('h', '(number) -> unknown');
      ce.declare('x', 'number');
      ce.declare('L', 'list<number>');
      return loop(['Equal', ['h', 'x'], 'L']);
    };
    const hOptions = { functions: { h: '_.h' } };
    expect(
      jsLoop(withH, { x: 1, L: [1, 2], h: () => [1, undefined] }, hOptions)
    ).toBe(0);
    expect(jsLoop(withH, { x: 1, L: [1, 2], h: () => [1, 3] }, hOptions)).toBe(
      2
    );
    expect(jsLoop(withH, { x: 1, L: [1, 2], h: () => [1, 2] }, hOptions)).toBe(
      1
    );
    // A scalar-or-list union symbol, same three answers.
    const withUnion = (ce: ComputeEngine) => {
      ce.declare('u', 'number | list<number>');
      ce.declare('L', 'list<number>');
      return loop(['Equal', 'u', 'L']);
    };
    expect(jsLoop(withUnion, { u: [1, undefined], L: [1, 2] })).toBe(0);
    expect(jsLoop(withUnion, { u: [1, 3], L: [1, 2] })).toBe(2);
    expect(jsLoop(withUnion, { u: [1, 2], L: [1, 2] })).toBe(1);
    // The interpreter's own answers, with the values assigned instead of
    // supplied at run time: no arm, else arm, then arm.
    const interpreted = (u: unknown, L: unknown): string => {
      const ce = engine();
      ce.assign('u', ce.box(u as any));
      ce.assign('L', ce.box(L as any));
      return ce
        .box(loop(['Equal', 'u', 'L']) as any)
        .evaluate()
        .toString();
    };
    expect(interpreted(['List', 1, 'Missing'], ['List', 1, 2])).toBe('0');
    expect(interpreted(['List', 1, 3], ['List', 1, 2])).toBe('2');
    expect(interpreted(['List', 1, 2], ['List', 1, 2])).toBe('1');
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
