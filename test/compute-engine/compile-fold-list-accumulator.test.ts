/**
 * Issue #369: a fold whose accumulator is a list that each step extends with
 * `Join` evaluates but did not compile, and the consumers of such a fold
 * (`Length`, `At`) refused its `collection<any>`-typed result.
 *
 * Three pieces are pinned here:
 *
 * - the unannotated list-building fold compiles (the accumulator parameter
 *   is an inferred-type symbol, read through the run-time array check);
 * - an ANNOTATED accumulator is judged against the join of the seed's type
 *   and the combiner's result type (`BaseCompiler.foldAccumulatorArgType`):
 *   admitted when both provably satisfy the annotation, declined with the
 *   argument type named otherwise;
 * - `Length` and `At` of the fold, and of a block local holding it, compile.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { parseEpsil } from '../../src/epsil/parse-epsil';

const RANGE = ['Range', 1, ['Length', 'p'], 1];
const BODY = ['Join', 'acc', ['List', ['Multiply', 2, ['At', 'p', 'i']]]];
const fold = (fn: unknown, init: unknown) => ['Fold', fn, init, RANGE];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('p', 'list<integer>');
  return ce;
}

const js = (ce: ComputeEngine, expr: unknown) =>
  compile(ce.box(expr as any), { fallback: false });

const run = (ce: ComputeEngine, expr: unknown) =>
  js(ce, expr).run!({ p: [3, 1, 2] });

describe('issue #369: a Fold that builds a list compiles', () => {
  it('compiles with an empty seed', () => {
    const ce = engine();
    expect(run(ce, fold(['Function', BODY, 'acc', 'i'], ['List']))).toEqual([
      6, 2, 4,
    ]);
  });

  it('compiles with a non-empty seed', () => {
    const ce = engine();
    expect(run(ce, fold(['Function', BODY, 'acc', 'i'], ['List', 0]))).toEqual([
      0, 6, 2, 4,
    ]);
  });

  it('compiles with a typed seed', () => {
    const ce = engine();
    expect(
      run(
        ce,
        fold(
          ['Function', BODY, 'acc', 'i'],
          ['Typed', ['List'], 'list<integer>']
        )
      )
    ).toEqual([6, 2, 4]);
  });

  it('matches the interpreter', () => {
    const ce = engine();
    const expr = fold(['Function', BODY, 'acc', 'i'], ['List']);
    const compiled = run(ce, expr);
    const compiledLength = run(ce, ['Length', expr]);
    const compiledAt = run(ce, ['At', expr, 2]);
    ce.assign('p', ce.box(['List', 3, 1, 2]));
    expect(ce.box(expr as any).evaluate().json).toEqual(['List', ...compiled]);
    expect(ce.box(['Length', expr] as any).evaluate().json).toBe(
      compiledLength
    );
    expect(ce.box(['At', expr, 2] as any).evaluate().json).toBe(compiledAt);
  });
});

describe('issue #369: an annotated accumulator', () => {
  it('is admitted when the seed and the body provably satisfy it', () => {
    // `p[i]` is typed `integer | nan` (an index may be out of range), so
    // the body returns `list<integer | nan>`; the empty seed is
    // `list<never>`, a member of every list type.
    const ce = engine();
    expect(
      run(
        ce,
        fold(
          ['Function', BODY, ['Typed', 'acc', 'list<integer | nan>'], 'i'],
          ['List']
        )
      )
    ).toEqual([6, 2, 4]);
  });

  it('is declined, naming the argument type, when the body does not provably return it', () => {
    const ce = engine();
    expect(() =>
      js(
        ce,
        fold(
          ['Function', BODY, ['Typed', 'acc', 'list<integer>'], 'i'],
          ['List']
        )
      )
    ).toThrow(
      /callback parameter 'acc' is annotated 'list<integer>', which the argument type 'list<integer \| nan>' does not provably satisfy/
    );
  });

  it('is declined when the seed does not satisfy it', () => {
    const ce = engine();
    expect(() =>
      js(
        ce,
        fold(
          ['Function', BODY, ['Typed', 'acc', 'list<integer | nan>'], 'i'],
          ['List', 'True']
        )
      )
    ).toThrow(/callback parameter 'acc' is annotated 'list<integer \| nan>'/);
  });

  it('is admitted for a numeric accumulator over a numeric fold', () => {
    const ce = engine();
    const sum = fold(
      ['Function', ['Add', 'acc', 'i'], ['Typed', 'acc', 'integer'], 'i'],
      0
    );
    expect(run(ce, sum)).toBe(6);
  });

  it('is admitted by Scan under the same rule', () => {
    const ce = engine();
    const scan = [
      'Scan',
      RANGE,
      ['Function', BODY, ['Typed', 'acc', 'list<integer | nan>'], 'i'],
      ['List'],
    ];
    expect(run(ce, scan)).toEqual([[6], [6, 2], [6, 2, 4]]);
  });

  it('is judged the same way on the Python target', () => {
    const ce = engine();
    const admitted = compile(
      ce.box(
        fold(
          ['Function', BODY, ['Typed', 'acc', 'list<integer | nan>'], 'i'],
          ['List']
        ) as any
      ),
      { to: 'python', fallback: false }
    );
    expect(admitted.success).toBe(true);
    expect(admitted.code).toContain('functools');
    expect(() =>
      compile(
        ce.box(
          fold(
            ['Function', BODY, ['Typed', 'acc', 'list<integer>'], 'i'],
            ['List']
          ) as any
        ),
        { to: 'python', fallback: false }
      )
    ).toThrow(/callback parameter 'acc' is annotated 'list<integer>'/);
  });
});

describe('issue #369: the consumers of a list-building fold compile', () => {
  const FOLD = fold(['Function', BODY, 'acc', 'i'], ['List']);

  it('Length of the fold', () => {
    const ce = engine();
    expect(run(ce, ['Length', FOLD])).toBe(3);
  });

  it('At of the fold', () => {
    const ce = engine();
    expect(run(ce, ['At', FOLD, 2])).toBe(2);
  });

  it('a block local holding the fold, read by Length and At', () => {
    const ce = engine();
    const program = parseEpsil(
      'let q = Fold((acc, i) => Join(acc, [2 * p[i]]), [], 1..Length(p))\nLength(q) + q[1]'
    )[0];
    const r = compile(ce.box(program), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ p: [3, 1, 2] })).toBe(9);
  });

  it('a block-local combiner whose body is a block of several statements', () => {
    // The fold is typed `unknown` here (the lazy `Reduce` never binds the
    // block-local `step`), so its consumers read it from its seed and its
    // combiner's last statement.
    const ce = engine();
    const program = parseEpsil(
      'function step(acc, i) { let v = 2 * p[i]; Join(acc, [v]) }\nLength(Fold(step, [], 1..Length(p))) + Fold(step, [], 1..Length(p))[2]'
    )[0];
    const r = compile(ce.box(program), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ p: [3, 1, 2] })).toBe(5);
  });

  it('At of a block local typed as an inferred abstract collection reads it through the run-time check', () => {
    // The fold above is now typed precisely and no longer needs this; the
    // path remains for a block local the engine types `collection<any>`
    // (here from a `Join` over a symbol inferred as one). A top-level symbol
    // is narrowed by the `At` use itself and takes the "could be indexed"
    // path instead.
    const ce = engine();
    ce.declare('r', { type: 'collection<any>', inferred: true });
    const program = parseEpsil('let q = Join(r, [1])\nq[1]')[0];
    const r = compile(ce.box(program), { fallback: false });
    expect(r.code).toContain('_SYS.arr(q');
    expect(r.run!({ r: [5, 6] })).toBe(5);
  });

  it('At of such a block local declines when the index is not provably numeric', () => {
    // A `collection<any>` base may hold a dictionary at run time, where the
    // interpreter answers a keyed lookup: the run-time array check is taken
    // only with a provably numeric index.
    const ce = engine();
    ce.declare('r', { type: 'collection<any>', inferred: true });
    ce.declare('k', 'unknown');
    const program = parseEpsil('let q = Join(r, [1])\nq[k]')[0];
    expect(() => compile(ce.box(program), { fallback: false })).toThrow(
      /Could not compile `At`/
    );
  });

  it('At of a DECLARED abstract collection still declines', () => {
    // Only a type the engine inferred is read through the run-time check; a
    // declared `collection<number>` is a contract that admits a set.
    const ce = engine();
    ce.declare('r', 'collection<number>');
    expect(() => js(ce, ['At', 'r', 1])).toThrow(/Could not compile `At`/);
  });

  it('a block-local function as the combiner of a scalar fold', () => {
    const ce = engine();
    const program = parseEpsil(
      'function add(a, x) { a + x }\nFold(add, 0, p)'
    )[0];
    const r = compile(ce.box(program), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ p: [3, 1, 2] })).toBe(6);
  });

  it('a block local that is not a function shadows an engine function of the same name', () => {
    // The emitted code reads the local (`5`), so the engine's `step` must not
    // be the literal the fold is planned with: the fold declines.
    const ce = engine();
    ce.assign('step', ce.box(['Function', BODY, 'acc', 'i'] as any));
    const program = parseEpsil(
      'let step = 5\nLength(Fold(step, [], 1..Length(p)))'
    )[0];
    expect(() => compile(ce.box(program), { fallback: false })).toThrow(
      /Could not compile/
    );
  });

  it('a block-local combiner whose body has a statement that is not a declaration is not read', () => {
    const ce = engine();
    const program = parseEpsil(
      'function step(acc, i) { let v = 2 * p[i]; v = v + 0; Join(acc, [v]) }\nLength(Fold(step, [], 1..Length(p)))'
    )[0];
    expect(() => compile(ce.box(program), { fallback: false })).toThrow(
      /Could not compile `Length`/
    );
  });

  it('Scan with a block-local combiner', () => {
    const ce = engine();
    const program = parseEpsil(
      'function add(a, x) { a + x }\nScan(p, add, 0)'
    )[0];
    const r = compile(ce.box(program), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ p: [3, 1, 2] })).toEqual([3, 4, 6]);
  });

  it('a fold with a user-function combiner', () => {
    const ce = engine();
    ce.assign('step', ce.box(['Function', BODY, 'acc', 'i'] as any));
    expect(run(ce, ['Length', fold('step', ['List'])])).toBe(3);
  });
});
