import { ComputeEngine } from '../../src/compute-engine';

/**
 * List-parameter indexing — Tycho 0.100.0 adoption item 2 (root cause of their
 * item 116). A user function whose body INDEXES its parameter (`v[1]`, `v_1`)
 * was broken at three stacked levels:
 *
 * (a) **Parse.** The subscript-vs-index decision is made at parse time from the
 *     base symbol's known type, but a function definition's parameters were not
 *     bound while its body was read. `h(v) := v_1 + v_2` therefore captured
 *     `v_1`/`v_2` as compound symbols unrelated to the parameter — even when
 *     `h` was already declared `(list<real>) -> real`. Fixed by
 *     `parseFunctionDefinitionBody` (`latex-syntax/dictionary/definitions-core.ts`),
 *     which binds each parameter at its DECLARED type in a parser-local symbol
 *     table. The BRACKET spelling `v[1]` always reached `At` and is pinned here
 *     so it stays that way.
 *
 * (b) **Inference.** A body applying `At` to its parameter still produced an
 *     `(unknown) -> …` arrow, so `paramsAreScalar` was true and a list argument
 *     BROADCAST (`h([3,4])` → `[h(3), h(4)]`) instead of being applied. Fixed by
 *     `inferredCollectionParameterType` (`boxed-expression/effects-inference.ts`),
 *     used by both signature builders — the literal's own arrow and the operator
 *     definition's inferred signature.
 *
 * (c) **Compile.** The JS `At` handler gated on "provably an indexed
 *     collection", which an indexed parameter (typed `indexed_collection |
 *     dictionary`) never satisfies, so every such function failed closed (D6) at
 *     the call site AND by reference. Fixed by `couldBeIndexedCollectionOperand`
 *     (`compilation/javascript-target.ts`) — the runtime-projection rule:
 *     `_SYS.at` already dispatches on the runtime shape.
 *
 * The interpreter with an explicit declaration was already correct; these tests
 * pin that it stays so. Broadcast for SCALAR-bodied functions is unaffected and
 * pinned at the bottom.
 */

/** `h([3,4])`-style compile of an expression, on the JS target. */
function jsCompile(ce: ComputeEngine, expr: any) {
  return ce.getCompilationTarget('javascript')!.compile(expr);
}

/** The two-component complex-multiply witness from Tycho's library: TWO list
 * parameters and a LIST-valued result. */
const COMPLEX_MUL = [
  'Function',
  [
    'List',
    [
      'Subtract',
      ['Multiply', ['At', 'a', 1], ['At', 'b', 1]],
      ['Multiply', ['At', 'a', 2], ['At', 'b', 2]],
    ],
    [
      'Add',
      ['Multiply', ['At', 'a', 1], ['At', 'b', 2]],
      ['Multiply', ['At', 'a', 2], ['At', 'b', 1]],
    ],
  ],
  'a',
  'b',
];

describe('(a) parse: a declared parameter type reaches the body', () => {
  test('B. declared `(list<real>) -> real` head: subscripts index the parameter', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(list<real>) -> real');
    expect(ce.parse('h(v) \\coloneq v_1 + v_2', { canonical: false }).json).toEqual(
      ['Assign', 'h', ['Function', ['Add', ['At', 'v', 1], ['At', 'v', 2]], 'v']]
    );
  });

  test('B. and the definition then works, interpreted and compiled', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(list<real>) -> real');
    ce.parse('h(v) \\coloneq v_1 + v_2').evaluate();

    expect(ce.parse('h([3, 4])').evaluate().toString()).toBe('7');
    // Route parity: the box route sees the same definition.
    expect(ce.box(['h', ['List', 3, 4]]).evaluate().toString()).toBe('7');

    const r = jsCompile(ce, ce.parse('h([3, 4])'));
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(7);
  });

  test('a declared `vector<3>` parameter indexes too', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(vector<3>) -> real');
    expect(ce.parse('f(p) \\coloneq p_1 + p_3', { canonical: false }).json).toEqual(
      ['Assign', 'f', ['Function', ['Add', ['At', 'p', 1], ['At', 'p', 3]], 'p']]
    );
  });

  test('a declared SCALAR parameter does NOT index — `x_1` stays a symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('q', '(real) -> real');
    expect(ce.parse('q(x) \\coloneq x_1 + 1', { canonical: false }).json).toEqual(
      ['Assign', 'q', ['Function', ['Add', 'x_1', 1], 'x']]
    );
  });

  test('A. UNDECLARED head: the subscript spelling still captures a symbol', () => {
    // Known limitation, deliberately unchanged: with no declaration anywhere,
    // nothing at parse time says `v` is a collection, and defaulting a bare
    // parameter to one would break every scalar `f(x) := x_0 + 1`. The bracket
    // spelling below is the answer for undeclared heads.
    const ce = new ComputeEngine();
    expect(ce.parse('h(v) \\coloneq v_1 + v_2', { canonical: false }).json).toEqual(
      ['Assign', 'h', ['Function', ['Add', 'v_1', 'v_2'], 'v']]
    );
  });

  test('the BRACKET spelling reaches `At` with or without a declaration', () => {
    const declared = new ComputeEngine();
    declared.declare('v', 'list<real>');
    expect(declared.parse('v[1]').json).toEqual(['At', 'v', 1]);

    const bare = new ComputeEngine();
    expect(bare.parse('v[1]').json).toEqual(['At', 'v', 1]);
  });

  test('A′. undeclared head + bracket body: indexes, applies and compiles', () => {
    const ce = new ComputeEngine();
    ce.parse('h(v) \\coloneq v[1] + v[2]').evaluate();
    expect(ce.parse('h([3, 4])').evaluate().toString()).toBe('7');
    const r = jsCompile(ce, ce.parse('h([3, 4])'));
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(7);
  });
});

describe('(b) inference: an At-indexing body infers a non-scalar parameter', () => {
  const AT_BODY = [
    'Function',
    ['Add', ['At', 'v', 1], ['At', 'v', 2]],
    'v',
  ];

  test('D. no declaration: a list argument APPLIES, it does not broadcast', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'h', AT_BODY]).evaluate();

    // The parameter slot is no longer `unknown`, so `paramsAreScalar` is false.
    expect(ce.box('h').type.toString()).toBe(
      '(dictionary | indexed_collection) -> broadcastable<number>'
    );
    // Before the fix this was `[h(3),h(4)]`.
    expect(ce.box(['h', ['List', 3, 4]]).evaluate().toString()).toBe('7');
  });

  test('C. with a declaration: interpreter unchanged (already correct)', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(list<real>) -> real');
    ce.box(['Assign', 'h', AT_BODY]).evaluate();
    expect(ce.box('h').type.toString()).toBe('(list<real>) -> real');
    expect(ce.box(['h', ['List', 3, 4]]).evaluate().toString()).toBe('7');
  });

  test('two list parameters and a list result — no declaration', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'mul', COMPLEX_MUL]).evaluate();
    // (1+2i)(3+4i) = -5 + 10i
    expect(
      ce.box(['mul', ['List', 1, 2], ['List', 3, 4]]).evaluate().toString()
    ).toBe('[-5,10]');
  });

  test('two list parameters and a list result — declared', () => {
    const ce = new ComputeEngine();
    ce.declare('mul', '(list<real>, list<real>) -> list<real>');
    ce.box(['Assign', 'mul', COMPLEX_MUL]).evaluate();
    expect(ce.box('mul').type.toString()).toBe(
      '(list<real>, list<real>) -> list<real>'
    );
    expect(
      ce.box(['mul', ['List', 1, 2], ['List', 3, 4]]).evaluate().toString()
    ).toBe('[-5,10]');
  });

  test('chained definitions: `mod(mul(a, b))`', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'mul', COMPLEX_MUL]).evaluate();
    ce.box([
      'Assign',
      'mod',
      [
        'Function',
        [
          'Sqrt',
          ['Add', ['Power', ['At', 'z', 1], 2], ['Power', ['At', 'z', 2], 2]],
        ],
        'z',
      ],
    ]).evaluate();
    const v = ce
      .box(['mod', ['mul', ['List', 1, 2], ['List', 3, 4]]])
      .evaluate()
      .N();
    expect(v.re).toBeCloseTo(Math.hypot(5, 10), 12);
  });
});

describe('(c) compile: `At` over an indexed parameter', () => {
  const AT_BODY = [
    'Function',
    ['Add', ['At', 'v', 1], ['At', 'v', 2]],
    'v',
  ];

  test('C. declared list parameter — call site and by reference', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(list<real>) -> real');
    ce.box(['Assign', 'h', AT_BODY]).evaluate();

    const callSite = jsCompile(ce, ce.box(['h', ['List', 3, 4]]));
    expect(callSite.success).toBe(true);
    expect(callSite.run!()).toBe(7);

    // By reference: the compiled artifact IS the function.
    const byRef = jsCompile(ce, ce.box('h'));
    expect(byRef.success).toBe(true);
    const fn = byRef.run!() as unknown as (v: number[]) => number;
    expect(typeof fn).toBe('function');
    expect(fn([3, 4])).toBe(7);
  });

  test('D. undeclared — call site and by reference', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'h', AT_BODY]).evaluate();

    const callSite = jsCompile(ce, ce.box(['h', ['List', 3, 4]]));
    expect(callSite.success).toBe(true);
    expect(callSite.run!()).toBe(7);

    const byRef = jsCompile(ce, ce.box('h'));
    expect(byRef.success).toBe(true);
    const fn = byRef.run!() as unknown as (v: number[]) => number;
    expect(fn([3, 4])).toBe(7);
  });

  test('two list parameters, list result — compiled result is APPLIED, not broadcast', () => {
    // Tycho item 116's downstream symptom was a compiled field returning
    // `[null, null, null]` out of `_SYS.bcastFn` (`JSON.stringify(NaN)` is
    // `null`). An applied — not broadcast — list argument is what kills it.
    const ce = new ComputeEngine();
    ce.declare('mul', '(list<real>, list<real>) -> list<real>');
    ce.box(['Assign', 'mul', COMPLEX_MUL]).evaluate();

    const callSite = jsCompile(
      ce,
      ce.box(['mul', ['List', 1, 2], ['List', 3, 4]])
    );
    expect(callSite.success).toBe(true);
    expect(callSite.run!()).toEqual([-5, 10]);

    const byRef = jsCompile(ce, ce.box('mul'));
    expect(byRef.success).toBe(true);
    const fn = byRef.run!() as unknown as (
      a: number[],
      b: number[]
    ) => number[];
    expect(fn([1, 2], [3, 4])).toEqual([-5, 10]);
  });

  test('the same, with no declaration at all', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'mul', COMPLEX_MUL]).evaluate();

    const callSite = jsCompile(
      ce,
      ce.box(['mul', ['List', 1, 2], ['List', 3, 4]])
    );
    expect(callSite.success).toBe(true);
    expect(callSite.run!()).toEqual([-5, 10]);
  });
});

describe('(c2) a KEYED access over a could-be base fails closed', () => {
  // The admission in (c) is a union — `dictionary | indexed_collection` — and
  // the dictionary arm is real: the interpreter's `At` reads a key there, while
  // `_SYS.at` dispatches on the runtime shape and answers NaN for every
  // non-array base. Compiling a keyed access would therefore report
  // `success: true` and return NaN where the interpreter returns the stored
  // value, so a base admitted only by the could-be path additionally requires a
  // provably NUMERIC index; anything else declines (D6).
  const KEYED = ['Function', ['At', 'v', { str: 'a' }], 'v'];
  const REC = ['Dictionary', ['KeyValuePair', { str: 'a' }, 5]];

  const keyedEngine = () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'k', KEYED]).evaluate();
    return ce;
  };

  test('the interpreter reads the key', () => {
    const ce = keyedEngine();
    expect(ce.box('k').type.toString()).toBe(
      '(dictionary | indexed_collection) -> unknown'
    );
    expect(ce.box(['k', REC]).evaluate().toString()).toBe('5');
  });

  test('JS: the compile declines instead of emitting a silent NaN', () => {
    const ce = keyedEngine();
    expect(() => jsCompile(ce, ce.box(['k', REC]))).toThrow(
      /not provably numeric.*Fail closed \(D6\)/
    );
    expect(() => jsCompile(ce, ce.box('k'))).toThrow(/Fail closed \(D6\)/);
  });

  test('JS: with fallback:true the decline is reported, and run() is honest', () => {
    const ce = keyedEngine();
    const r = ce
      .getCompilationTarget('javascript')!
      .compile(ce.box(['k', REC]), { fallback: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not provably numeric/);
    // The interpreter-backed fallback returns the stored value — not NaN.
    expect(r.run!()).toBe(5);
  });

  test('Python: the same shape declines identically', () => {
    const ce = new ComputeEngine();
    const py = ce.getCompilationTarget('python')!;
    expect(() => py.compile(ce.box(KEYED))).toThrow(
      /not provably numeric.*Fail closed \(D6\)/
    );
  });

  test('a NUMERIC index over the same could-be base compiles on both targets', () => {
    const ce = new ComputeEngine();
    const NUMERIC = ce.box(['Function', ['At', 'v', 1], 'v']);
    expect(NUMERIC.type.toString()).toBe(
      '(v: dictionary | indexed_collection) -> unknown'
    );

    const js = jsCompile(ce, NUMERIC);
    expect(js.success).toBe(true);
    expect((js.run! as any)([10, 20, 30])).toBe(10);

    const py = ce.getCompilationTarget('python')!.compile(NUMERIC);
    expect(py.success).toBe(true);
    // The Python emission mirrors `_SYS.at`'s runtime shape dispatch: a base
    // that is not a sequence projects to nan rather than raising.
    expect(py.code).toContain("isinstance(_l, (list, tuple, np.ndarray))");
  });

  test('a PROVABLY indexed base is unaffected by the index gate', () => {
    // Unchanged behavior: the interpreter answers NaN for a string index into
    // a list, and so does the compiled form — no decline.
    const ce = new ComputeEngine();
    const e = ce.box(['At', ['List', 10, 20, 30], { str: 'a' }]);
    expect(e.evaluate().toString()).toBe('NaN');
    const r = jsCompile(ce, e);
    expect(r.success).toBe(true);
    expect(r.run!()).toBeNaN();
  });
});

describe('non-regressions', () => {
  test('a SCALAR-bodied function still broadcasts over a list argument', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'g', ['Function', ['Multiply', 2, 'x'], 'x']]).evaluate();
    expect(ce.box('g').type.toString()).toBe('(unknown) -> finite_number');
    expect(ce.box(['g', ['List', 1, 2, 3]]).evaluate().toString()).toBe(
      '[2,4,6]'
    );
  });

  test('an INDEX parameter is not mistaken for a collection parameter', () => {
    // `At`'s index slot is `boolean | indexed_collection | number | string`
    // (a gather index may itself be a collection), so a union merely
    // CONTAINING a collection arm must not be lifted onto the arrow — only a
    // type that excludes every scalar is.
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 10, 20, 30]));
    ce.box(['Assign', 'f', ['Function', ['Add', ['At', 'L', 't'], 1], 't']]).evaluate();
    expect(ce.box('f').type.toString()).toBe('(unknown) -> number');
    expect(ce.box(['f', 2]).evaluate().toString()).toBe('21');
  });
});
