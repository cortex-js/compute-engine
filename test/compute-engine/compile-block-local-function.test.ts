/**
 * Compiling a program that DEFINES a function and then CALLS it — the ordinary
 * shape of an Epsil file, and of any `Block` whose local holds a lambda:
 *
 *     const g = (k) => Sum(Take(Map(_ => _^2, 1..oo), k))
 *     g(3)
 *
 * The declaration always lowered to a value binding (`let g = ((k) => …)`),
 * but the CALL had no resolution: head lookup consults the ENGINE's
 * definitions only (`BaseCompiler.userFunctionLiteral`), which a block-local
 * declaration never enters — compiling must not mutate the engine — so `g(3)`
 * failed the whole compilation with ``Unknown operator `g` ``. A `function`
 * definition (`DefineFunction`) had no lowering on any target at all.
 *
 * Both now compile on the JavaScript family: the block records its
 * function-valued locals in `CompileTarget.localFunctions`, and a `function`
 * definition is rewritten to the equivalent `Declare` of the same literal.
 *
 * Every expected value below is the interpreter's own result for the same
 * program (probed empirically, and re-asserted here by the parity checks).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

/** Box an Epsil program in a fresh engine, without evaluating it. */
function program(source: string) {
  const [ast] = parseEpsil(source, {
    parseLatex: (latex: string) => ce.parse(latex).json,
  });
  return ce.box(ast as never);
}

/** The compiled program's result, and the interpreter's, for comparison. */
function both(
  source: string,
  options?: {
    to?: string;
    vars?: Record<string, unknown>;
    constantFold?: boolean;
  }
): { compiled: unknown; interpreted: string; code: string } {
  const expr = program(source);
  const result = compile(expr, {
    to: options?.to ?? 'javascript',
    fallback: false,
    ...(options?.constantFold === false ? { constantFold: false } : {}),
  } as never)!;
  return {
    compiled: result.run!((options?.vars ?? {}) as never),
    // A SECOND boxing, so the compilation above never saw an evaluated engine.
    interpreted: program(source).evaluate().toString(),
    code: result.code as string,
  };
}

describe('COMPILE a block-local function definition', () => {
  it('compiles the call of a `const`-bound lambda (the reported program)', () => {
    const { compiled, interpreted, code } = both(
      'const g = (k) => Sum(Take(Map( _ => _^2, 1..oo), k))\ng(3)'
    );
    expect(compiled).toBe(14); // 1 + 4 + 9
    expect(interpreted).toBe('14');
    // The local is bound to the lazy stream pipeline, through the
    // broadcast-aware wrapper every scalar-parameter literal is handed out
    // under…
    expect(code).toContain('let g = ((_tv3) => (_tv4) => Array.isArray(_tv4)');
    expect(code).toContain('(((k) =>');
    // …and the call, whose argument is constant, folds (see below).
    expect(code).toContain('return 14');
  });

  it('emits the CALL when the argument is not constant', () => {
    const { compiled, code } = both(
      'const g = (k) => Sum(Take(Map( _ => _^2, 1..oo), k))\ng(n)',
      { vars: { n: 3 } }
    );
    // `n` is a caller-supplied variable, so the call takes the runtime
    // broadcast dispatch, which is handed the local `g` itself — with no
    // argument to coerce inside it, a closure would only eta-expand `g`.
    expect(code).toContain('_SYS.bcastFn(g,');
    expect(code).not.toContain('return 14');
    expect(compiled).toBe(14);
  });

  it('compiles a `let`-bound lambda the same way', () => {
    const { compiled, interpreted } = both('let h = (k) => k + 1\nh(3)');
    expect(compiled).toBe(4);
    expect(interpreted).toBe('4');
  });

  it('resolves a call from a LOOP BODY inside the same block', () => {
    const { compiled, interpreted } = both(
      'const h = (k) => k + 1\nlet s = 0\nfor k in 1..4 { s := s + h(k) }\ns'
    );
    expect(compiled).toBe(14); // 2 + 3 + 4 + 5
    expect(interpreted).toBe('14');
  });

  it('resolves a call of one local from another local', () => {
    const { compiled, interpreted } = both(
      'const h = (k) => k + 1\nconst j = (k) => h(k) * 2\nj(3)'
    );
    expect(compiled).toBe(8);
    expect(interpreted).toBe('8');
  });

  it('recurses through its own binding', () => {
    const { compiled, interpreted } = both(
      'const fact = (n) => if n <= 1 { 1 } else { n * fact(n - 1) }\nfact(5)'
    );
    expect(compiled).toBe(120);
    expect(interpreted).toBe('120');
  });

  it('BROADCASTS over a collection argument, as the interpreter does', () => {
    // A scalar callee applied to a list maps element-wise (`_SYS.bcastFn`),
    // the same dispatch an engine-level user function gets. The argument is a
    // run-time input, so this exercises the emitted dispatch rather than the
    // constant fold (which would answer `[2, 3, 4]` without it).
    const { compiled, code } = both('const h = (k) => k + 1\nh(xs)', {
      vars: { xs: [1, 2, 3] },
    });
    expect(code).toContain('_SYS.bcastFn');
    expect(compiled).toEqual([2, 3, 4]);
    // …and the same call with a LITERAL list folds to the same answer.
    expect(both('const h = (k) => k + 1\nh([1, 2, 3])')).toMatchObject({
      compiled: [2, 3, 4],
      interpreted: '[2,3,4]',
    });
  });

  it('fails closed on an ARITY mismatch', () => {
    // With fewer arguments than parameters the interpreter makes a partial
    // application, a function value, which the compiled call does not build:
    // JavaScript would bind the missing parameter to `undefined` and compute
    // NaN. With more arguments the interpreter reports an error. Either way
    // the compilation must not silently disagree.
    expect(
      program('const h = (a, b) => a + b\nh(1)').evaluate().toString()
    ).toBe('(_) => _ + 1');
    expect(() => both('const h = (a, b) => a + b\nh(1)')).toThrow(
      /declared with 2 parameters but called with 1\. The interpreter reads a call with fewer arguments than parameters as a partial application/
    );
    expect(() => both('const h = (a, b) => a + b\nh(1, 2, 3)')).toThrow(
      /declared with 2 parameters but called with 3\. The interpreter reports an error/
    );
  });

  it('resolves a call declared INSIDE a loop body', () => {
    // The loop-body statement list is compiled by its own path, which bypasses
    // `compileBlock`: without the same rewrite and scope there, a definition
    // made inside the body was still `Unknown operator`.
    const { compiled, interpreted } = both(
      'let s = 0\nfor k in 1..3 { const h = (j) => j + 1\n s := s + h(k) }\ns'
    );
    expect(compiled).toBe(9); // 2 + 3 + 4
    expect(interpreted).toBe('9');
  });

  it('a lambda BODY may call a sibling declared AFTER it', () => {
    // A body does not run until the function is called, by which point every
    // lexical binding of the block has initialized — so it resolves against
    // the whole statement list, not the part emitted so far. Compiling it
    // against the progressive scope rejected this ordinary program.
    const { compiled, interpreted } = both(
      'const f = (n) => g(n)\nconst g = (n) => n + 1\nf(2)'
    );
    expect(compiled).toBe(3);
    expect(interpreted).toBe('3');
  });

  it('a FORWARD call of a `const` lambda fails closed, not at run time', () => {
    // A `const` binding declares nothing until its own statement runs — the
    // interpreter rejects this program too — so the call must be refused at
    // compile time. Resolving it would emit `let a = g(3); let g = …`, whose
    // `g(3)` reads a JavaScript temporal dead zone: a runtime `ReferenceError`
    // behind `success: true`.
    expect(() => both('let a = g(3)\nconst g = (k) => k + 1\na')).toThrow(
      /Unknown operator/
    );
  });

  it('a declared `broadcastable<T>` parameter fails closed, as for a definition', () => {
    // `constantFold: false`: the argument is a literal list and the callee is
    // pure, so the call would otherwise fold to the interpreter's own answer
    // and never reach the gate under test.
    //
    // Emitted, this answered `[[1,2,3],[1,2,3]]` — the array bound WHOLE to
    // `x` — where the interpreter maps one rank down to `[(1,1),(2,2),(3,3)]`.
    // The engine-defined route already declined it
    // (`broadcastable-param-declaration.test.ts`); a block-local callee is no
    // more exempt from the contract than a definition is.
    expect(() =>
      both(
        'const pair = (x: broadcastable<value>) => (x, x)\npair([1, 2, 3])',
        {
          constantFold: false,
        }
      )
    ).toThrow(/declared `broadcastable<T>` parameter/);
    expect(
      program(
        'const pair = (x: broadcastable<value>) => (x, x)\npair([1, 2, 3])'
      )
        .evaluate()
        .toString()
    ).toBe('[(1, 1),(2, 2),(3, 3)]');
  });

  it('a NON-function local shadows an outer function-valued one', () => {
    // The inner `g` is a number, so `g(2)` is not a call of the outer lambda.
    expect(() =>
      both('const g = (k) => k + 1\n{ const g = 5\n g(2) }')
    ).toThrow();
  });
});

describe('COMPILE a `function` definition', () => {
  it('compiles the definition and its call', () => {
    const { compiled, interpreted, code } = both(
      'function h(k) { k + 1 }\nh(3)'
    );
    expect(compiled).toBe(4);
    expect(interpreted).toBe('4');
    expect(code).toContain('let h = ((_tv1) => (_tv2) => Array.isArray(_tv2)');
    expect(code).toContain('(((k) => k + 1))');
  });

  it('recurses', () => {
    const { compiled, interpreted } = both(
      'function fact(n) { if n <= 1 { 1 } else { n * fact(n - 1) } }\nfact(5)'
    );
    expect(compiled).toBe(120);
    expect(interpreted).toBe('120');
  });

  it('is HOISTED, so a call may precede the definition', () => {
    // `DefineFunction` declares its name as the program canonicalizes, which
    // is what lets the interpreter answer 4 here. Emitted in source position
    // the same program compiled to `let a = g(3); let g = …`, reading `g`
    // inside its own temporal dead zone — a runtime `ReferenceError` for a
    // program that interprets fine. The definition is a pure literal with no
    // side effects, so moving it to the front reorders nothing observable.
    const { compiled, interpreted, code } = both(
      'let a = g(3)\nfunction g(k) { k + 1 }\na'
    );
    expect(compiled).toBe(4);
    expect(interpreted).toBe('4');
    expect(code.indexOf('let g =')).toBeLessThan(code.indexOf('let a ='));
  });

  it('MUTUALLY recursive definitions compile', () => {
    // Each body names the other, so neither can be resolved from a scope
    // holding only the definitions emitted before it — hoisting moves the two
    // declarations but does not change the order their bodies are compiled in.
    const { compiled, interpreted } = both(
      'function isEven(n) { if n == 0 { 1 } else { isOdd(n - 1) } }\n' +
        'function isOdd(n) { if n == 0 { 0 } else { isEven(n - 1) } }\n' +
        'isEven(10)',
      { constantFold: false }
    );
    expect(compiled).toBe(1);
    expect(interpreted).toBe('1');
  });

  it('MUTUALLY recursive definitions compile inside a loop body too', () => {
    const { compiled, interpreted } = both(
      'let s = 0\nfor k in 1..2 { function eL(n) { if n == 0 { 1 } else { oL(n - 1) } }\n' +
        ' function oL(n) { if n == 0 { 0 } else { eL(n - 1) } }\n s := s + eL(4) }\ns',
      { constantFold: false }
    );
    expect(compiled).toBe(2); // eL(4) = 1, twice round the loop
    expect(interpreted).toBe('2');
  });

  it('an UNBOUNDED generic definition fails closed, as for a definition (rule G3)', () => {
    // A type variable with no declared bound names no type to compile the
    // parameter against, so the compiler can decide neither the complex
    // coercion nor the broadcast; the engine-defined route declines such a
    // callee in `ensureUserFunctionEmitted`. Both `function` spellings keep
    // the polytype through boxing, so both reach this gate.
    for (const src of [
      'function id<T>(x: T) -> T { x }\nid(3)',
      'function id(x: T) -> T where T { x }\nid([1, 2, 3])',
    ]) {
      expect(() => both(src, { constantFold: false })).toThrow(
        /GENERIC signature/
      );
      // …and the interpreter still answers.
      expect(program(src).evaluate().toString()).not.toContain('Error');
    }
  });

  it('a BOUNDED generic definition compiles at its bound, like an engine-level one', () => {
    // A bounded type variable is read at its declared bound — the reading the
    // interpreter's own broadcast gate performs — so the local is emitted once
    // as the ground function it is bounded by and its call sites get the
    // broadcast wrap that ground signature earns. Without it the two spellings
    // of one function disagreed: the engine-level `gd` compiled while the
    // block-local `gd` declined.
    const src = 'function gd(x: T) -> T where T: number { 2x }\n';
    const scalar = both(`${src}gd(5)`, { constantFold: false });
    expect(scalar.code).toContain(
      'let gd = ((_tv1) => (_tv2) => Array.isArray(_tv2) ? ' +
        '_SYS.bcastFn(_tv1, _tv2) : _tv1(_tv2))(((x) => 2 * x))'
    );
    expect(scalar.compiled).toBe(10);
    expect(scalar.interpreted).toBe('10');
    const list = both(`${src}gd([1, 2, 3])`, { constantFold: false });
    expect(list.code).toContain('_SYS.bcastFn');
    expect(list.compiled).toEqual([2, 4, 6]);
    expect(list.interpreted).toBe('[2,4,6]');
  });

  it('a COLLECTION-bounded generic definition compiles its body at the bound', () => {
    // Reading the bound settled the CALL boundary — a `list<number>`-bounded
    // parameter is handed the list WHOLE, not one element per call — but the
    // BODY canonicalized against the ERASED parameter, which analyzes as a
    // scalar. So `2x` emitted the scalar `2 * x`, which multiplies the whole
    // array as a number and answers NaN at run time, where the interpreter
    // broadcasts. The literal is now re-boxed with the ground parameter types
    // stamped on, exactly as the engine-level route does, so the body
    // canonicalizes at the type the bound proves.
    const src = 'function gd(x: T) -> T where T: list<number> { 2x }\n';
    const list = both(`${src}gd([1, 2, 3])`, { constantFold: false });
    expect(list.code).toContain('_SYS.bcast');
    expect(list.compiled).toEqual([2, 4, 6]);
    expect(list.interpreted).toBe('[2,4,6]');

    // A body that needs the list SHAPE also compiles now: `Length` lowers only
    // over something array-shaped, and the erased parameter analyzed as a bare
    // `collection`, which is not.
    const len = both(
      'function gl(x: T) -> number where T: list<number> { Length(x) }\ngl([1, 2, 3])',
      { constantFold: false }
    );
    expect(len.code).toContain('.length');
    expect(len.compiled).toBe(3);
    expect(len.interpreted).toBe('3');
  });

  it('compiles to the SAME code as the equivalent `const` binding', () => {
    // The two spellings are one block-scoped definition, so they must not
    // compile differently. They did: `DefineFunction` DECLARES its name in
    // the engine as it canonicalizes, so `g(3)` reached the folder with a
    // known head and folded to `14`, while the `const` binding declares
    // nothing and left an unfolded `g(3)` behind.
    const body = 'Sum(Take(Map( _ => _^2, 1..oo), k))';
    expect(both(`function g(k) { ${body} }\ng(3)`).code).toBe(
      both(`const g = (k) => ${body}\ng(3)`).code
    );
  });

  it('is usable as a VALUE — passed as a callback', () => {
    const { compiled, interpreted } = both(
      'function sq(k) { k^2 }\nSum(Take(Map(sq, 1..oo), 4))'
    );
    expect(compiled).toBe(30); // 1 + 4 + 9 + 16
    expect(interpreted).toBe('30');
  });

  it('fails closed on a MULTI-CLAUSE set', () => {
    // `DefineFunction` accumulates clauses and the call dispatches on the
    // argument types; a single value binding would keep only the last clause
    // and answer `2` here, where the interpreter answers `1`.
    expect(
      program('function f(n: integer) { 1 }\nfunction f(s: string) { 2 }\nf(3)')
        .evaluate()
        .toString()
    ).toBe('1');
    expect(() =>
      both('function f(n: integer) { 1 }\nfunction f(s: string) { 2 }\nf(3)')
    ).toThrow(/DefineFunction/);
  });
});

describe('COMPILE a block-local function — other targets are unchanged', () => {
  // Python and the GPU targets declare a local with a scalar type, separately
  // from its assignment, so they can bind no function-valued local: both
  // shapes keep failing closed rather than emitting source no compiler takes.
  it('Python still fails closed on a `function` definition', () => {
    expect(() =>
      both('function h(k) { k + 1 }\nh(3)', { to: 'python' })
    ).toThrow(/Could not compile `DefineFunction`: /);
  });

  it('Python still fails closed on a call of a lambda-bound local', () => {
    expect(() =>
      both('const h = (k) => k + 1\nh(3)', { to: 'python' })
    ).toThrow(/Unknown operator `h`/);
  });
});

describe('COMPILE a `Declare` followed by an `Assign` of a function literal', () => {
  // `Declare(k, "function")` then `Assign(k, Function(…))` is the shape the
  // LaTeX parser makes for `k(u) \coloneq 2u; k(x)`. The block-local scope
  // read only a `Declare` that carries its value (the `const`/`let` shape),
  // so the call `k(x)` failed with ``Unknown operator `k` `` although the
  // interpreter answers it.
  const F = (body: unknown, ...params: string[]) => [
    'Function',
    body,
    ...params,
  ];
  const twice = F(['Multiply', 2, 'u'], 'u');
  const thrice = F(['Multiply', 3, 'u'], 'u');

  /** The compiled result for `vars`, and `evaluate()` with `vars` assigned. */
  function compareJson(
    json: unknown,
    vars: Record<string, number | number[]> = {}
  ): { compiled: unknown; interpreted: string; code: string } {
    const result = compile(ce.box(json as never), {
      to: 'javascript',
      fallback: false,
    } as never)!;
    const ce2 = new ComputeEngine();
    for (const [k, v] of Object.entries(vars))
      ce2.assign(k, Array.isArray(v) ? ce2.box(['List', ...v]) : v);
    return {
      compiled: result.run!(vars as never),
      interpreted: ce2
        .box(json as never)
        .evaluate()
        .toString(),
      code: result.code as string,
    };
  }

  it('compiles the call (the reported program)', () => {
    const r = compareJson(
      [
        'Block',
        ['Declare', 'k', "'function'"],
        ['Assign', 'k', twice],
        ['k', 'x'],
      ],
      { x: 3 }
    );
    expect(r.compiled).toBe(6);
    expect(r.interpreted).toBe('6');
    expect(r.code).toContain('_SYS.bcastFn(k, _.x)');
  });

  it('folds a call with a constant argument', () => {
    const r = compareJson([
      'Block',
      ['Declare', 'k', "'function'"],
      ['Assign', 'k', twice],
      ['k', 3],
    ]);
    expect(r.compiled).toBe(6);
    expect(r.interpreted).toBe('6');
    expect(r.code).toContain('return 6');
  });

  it('compiles an `Assign` with no `Declare`', () => {
    const r = compareJson(['Block', ['Assign', 'k', twice], ['k', 'x']], {
      x: 3,
    });
    expect(r.compiled).toBe(6);
    expect(r.interpreted).toBe('6');
  });

  it('compiles with a declared signature', () => {
    const block = (arg: unknown) => [
      'Block',
      ['Declare', 'k', "'(real) -> real'"],
      ['Assign', 'k', twice],
      ['k', arg],
    ];
    expect(compareJson(block('x'), { x: 3 })).toMatchObject({
      compiled: 6,
      interpreted: '6',
    });
    expect(compareJson(block(['List', 1, 2, 3]))).toMatchObject({
      compiled: [2, 4, 6],
      interpreted: '[2,4,6]',
    });
  });

  it('BROADCASTS over a collection argument', () => {
    const r = compareJson(
      [
        'Block',
        ['Declare', 'k', "'function'"],
        ['Assign', 'k', twice],
        ['k', 'xs'],
      ],
      { xs: [1, 2, 3] }
    );
    expect(r.code).toContain('_SYS.bcastFn');
    expect(r.compiled).toEqual([2, 4, 6]);
    expect(r.interpreted).toBe('[2,4,6]');
  });

  it('recurses through its own binding', () => {
    const fact = F(
      [
        'If',
        ['LessEqual', 'n', 1],
        1,
        ['Multiply', 'n', ['f', ['Subtract', 'n', 1]]],
      ],
      'n'
    );
    const r = compareJson(
      [
        'Block',
        ['Declare', 'f', "'function'"],
        ['Assign', 'f', fact],
        ['f', 'x'],
      ],
      { x: 5 }
    );
    expect(r.compiled).toBe(120);
    expect(r.interpreted).toBe('120');
  });

  it('fails closed on an ARITY mismatch', () => {
    expect(() =>
      compareJson(
        [
          'Block',
          ['Declare', 'k', "'function'"],
          ['Assign', 'k', F(['Add', 'a', 'b'], 'a', 'b')],
          ['k', 'x'],
        ],
        { x: 3 }
      )
    ).toThrow(/declared with 2 parameters but called with 1/);
  });

  it('a top-level REASSIGNMENT is followed: each call uses the current literal', () => {
    const r = compareJson(
      [
        'Block',
        ['Declare', 'k', "'function'"],
        ['Assign', 'k', twice],
        ['Declare', 'a', "'unknown'"],
        ['Assign', 'a', ['k', 'x']],
        ['Assign', 'k', thrice],
        ['Add', 'a', ['k', 'x']],
      ],
      { x: 3 }
    );
    expect(r.compiled).toBe(15); // 2·3 + 3·3
    expect(r.interpreted).toBe('15');
  });

  // A function whose value can change while the block runs is called through
  // its run-time binding, so each call uses the value the interpreter uses
  // at that point.
  const inBranch = [
    'Block',
    ['Declare', 'k', "'function'"],
    ['Assign', 'k', twice],
    ['If', ['Greater', 'x', 0], ['Assign', 'k', thrice]],
    ['k', 'x'],
  ];

  it('a reassignment INSIDE a branch is read at run time', () => {
    for (const x of [3, -3])
      expect(compareJson(inBranch, { x })).toMatchObject({
        compiled: x > 0 ? 3 * x : 2 * x,
        interpreted: String(x > 0 ? 3 * x : 2 * x),
      });
    // A rebound function is not folded, even with a constant argument: the
    // literal the compiler sees is not always the one the call runs.
    const constant = compareJson([...inBranch.slice(0, -1), ['k', 2]], {
      x: 3,
    });
    expect(constant).toMatchObject({ compiled: 6, interpreted: '6' });
    expect(constant.code).not.toContain('return 4');
    // …and it still broadcasts over a list.
    expect(
      compareJson([...inBranch.slice(0, -1), ['k', 'xs']], {
        x: 3,
        xs: [1, 2, 3],
      })
    ).toMatchObject({ compiled: [3, 6, 9], interpreted: '[3,6,9]' });
  });

  it('a reassignment INSIDE a loop body is read at run time', () => {
    const r = compareJson([
      'Block',
      ['Declare', 'k', "'function'"],
      ['Assign', 'k', twice],
      ['Declare', 's', "'unknown'"],
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          ['Assign', 's', ['Add', 's', ['k', 1]]],
          ['Assign', 'k', thrice],
        ],
        ['Element', 'j', ['Range', 1, 3]],
      ],
      's',
    ]);
    expect(r.compiled).toBe(8); // 2 + 3 + 3
    expect(r.interpreted).toBe('8');
  });

  it('a lambda body that calls a name assigned TWICE reads it at run time', () => {
    const r = compareJson(
      [
        'Block',
        ['Declare', 'k', "'function'"],
        ['Assign', 'k', twice],
        ['Declare', 'g', "'function'"],
        ['Assign', 'g', F(['k', 'v'], 'v')],
        ['Declare', 'a', "'unknown'"],
        ['Assign', 'a', ['g', 'x']],
        ['Assign', 'k', thrice],
        ['Add', 'a', ['g', 'x']],
      ],
      { x: 3 }
    );
    expect(r.compiled).toBe(15); // 2·3 + 3·3
    expect(r.interpreted).toBe('15');
  });

  it('an inner `Declare` of the same name is a different binding', () => {
    const outer = (inner: unknown[]) => [
      'Block',
      ['Declare', 'k', "'function'"],
      ['Assign', 'k', twice],
      ['Declare', 'a', "'unknown'"],
      ['Assign', 'a', ['Block', ...inner]],
      ['Add', 'a', ['k', 'x']],
    ];
    // The inner `k` is a function: 3·3 + 2·3.
    expect(
      compareJson(
        outer([
          ['Declare', 'k', "'function'"],
          ['Assign', 'k', thrice],
          ['k', 'x'],
        ]),
        { x: 3 }
      )
    ).toMatchObject({ compiled: 15, interpreted: '15' });
    // The inner `k` is a number: 5·3 + 2·3. The outer `k` is not rebound.
    expect(
      compareJson(
        outer([
          ['Declare', 'k', "'unknown'"],
          ['Assign', 'k', 5],
          ['Multiply', 'k', 'x'],
        ]),
        { x: 3 }
      )
    ).toMatchObject({ compiled: 21, interpreted: '21' });
    // With no inner `Declare`, the inner block writes the OUTER `k`: 3·3 + 3·3.
    expect(
      compareJson(
        outer([
          ['Assign', 'k', thrice],
          ['k', 'x'],
        ]),
        { x: 3 }
      )
    ).toMatchObject({ compiled: 18, interpreted: '18' });
  });

  it('recurses through a reassigned name', () => {
    const recursive = (step: unknown) =>
      F(
        [
          'If',
          ['LessEqual', 'n', 1],
          1,
          [step, 'n', ['f', ['Subtract', 'n', 1]]],
        ],
        'n'
      );
    const r = compareJson([
      'Block',
      ['Declare', 'f', "'function'"],
      ['Assign', 'f', recursive('Multiply')],
      ['Declare', 'a', "'unknown'"],
      ['Assign', 'a', ['f', 5]],
      ['Assign', 'f', recursive('Add')],
      ['Add', 'a', ['f', 5]],
    ]);
    expect(r.compiled).toBe(135); // 5! + (5 + 4 + 3 + 2 + 1)
    expect(r.interpreted).toBe('135');
  });

  it('fails closed, with the reason, when the values do not share a signature', () => {
    // The call site needs the arity and the parameter types of the callee,
    // and these differ between the two values `k` can hold.
    expect(() =>
      compareJson(
        [
          'Block',
          ['Declare', 'k', "'function'"],
          ['Assign', 'k', twice],
          [
            'If',
            ['Greater', 'x', 0],
            ['Assign', 'k', F(['Add', 'a', 'b'], 'a', 'b')],
          ],
          ['k', 'x'],
        ],
        { x: 3 }
      )
    ).toThrow(/is assigned functions with different signatures/);
    expect(() =>
      compareJson(
        [
          'Block',
          ['Declare', 'k', "'unknown'"],
          ['Assign', 'k', twice],
          ['If', ['Greater', 'x', 0], ['Assign', 'k', 5]],
          ['k', 'x'],
        ],
        { x: -3 }
      )
    ).toThrow(/also assigned a value that is not a function literal/);
  });

  it('the interval target declines a rebound function with the reason', () => {
    // A top-level reassignment: the `if` of `inBranch` declines earlier on
    // this target, on its own else-less branch.
    const result = compile(
      ce.box([
        'Block',
        ['Declare', 'k', "'function'"],
        ['Assign', 'k', twice],
        ['Declare', 'a', "'unknown'"],
        ['Assign', 'a', ['k', 'x']],
        ['Assign', 'k', thrice],
        ['Add', 'a', ['k', 'x']],
      ] as never),
      { to: 'interval-js', fallback: false } as never
    )!;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(
      /`k` is assigned more than once or inside a nested statement.*compiles a call of a block-local function only when the function is assigned once/
    );
  });

  it('compiles the LaTeX spelling', () => {
    for (const latex of [
      'k(u) \\coloneq 2u; k(x)',
      'k \\coloneq u \\mapsto 2u; k(x)',
    ]) {
      const result = compile(ce.parse(latex), {
        to: 'javascript',
        fallback: false,
      } as never)!;
      expect(result.run!({ x: 3 } as never)).toBe(6);
      const ce2 = new ComputeEngine();
      ce2.assign('x', 3);
      expect(ce2.parse(latex).evaluate().toString()).toBe('6');
    }
  });

  it('the interval target compiles it as it compiles the `const` form', () => {
    const result = compile(
      ce.box([
        'Block',
        ['Declare', 'k', "'function'"],
        ['Assign', 'k', twice],
        ['k', 'x'],
      ] as never),
      { to: 'interval-js', fallback: false } as never
    )!;
    expect(result.success).toBe(true);
    expect(result.run!({ x: 3 } as never)).toEqual({
      kind: 'interval',
      value: { lo: 6, hi: 6 },
    });
  });

  it('the GPU targets and Python fail closed, as for the `const` form', () => {
    const json = [
      'Block',
      ['Declare', 'k', "'function'"],
      ['Assign', 'k', twice],
      ['k', 'x'],
    ];
    for (const to of ['glsl', 'wgsl', 'python'])
      expect(() =>
        compile(ce.box(json as never), { to, fallback: false } as never)
      ).toThrow();
    // The GPU targets say why: they have no function values.
    for (const to of ['glsl', 'wgsl'])
      expect(() =>
        compile(ce.box(inBranch as never), { to, fallback: false } as never)
      ).toThrow(/Anonymous functions \(Function\) are not supported/);
  });
});

describe('COMPILE a REASSIGNED `let`-bound lambda', () => {
  // The `let` binding was resolved from its declaration only, so a call after
  // `h := …` folded with the OLD literal: these programs compiled to 4, 8 and
  // 4 where the interpreter answers 5, 9 and 13.
  it('a call after a top-level reassignment uses the new literal', () => {
    expect(both('let h = (k) => k + 1\nh := (k) => k + 2\nh(3)')).toMatchObject(
      { compiled: 5, interpreted: '5' }
    );
    expect(
      both('let h = (k) => k + 1\nlet a = h(3)\nh := (k) => k + 2\na + h(3)')
    ).toMatchObject({ compiled: 9, interpreted: '9' });
  });

  it('a reassignment inside a loop body is read at run time', () => {
    expect(
      both(
        'let h = (k) => k + 1\nlet s = 0\nfor j in 1..2 { s := s + h(1)\n h := (k) => k + 10 }\ns'
      )
    ).toMatchObject({ compiled: 13, interpreted: '13' }); // 2 + 11
  });

  it('a reassignment inside an `if` is read at run time', () => {
    const src = 'let h = (k) => k + 1\nif n > 0 { h := (k) => k + 10 }\nh(1)';
    for (const n of [1, -1]) {
      const { compiled } = both(src, { vars: { n } });
      expect(compiled).toBe(n > 0 ? 11 : 2);
    }
    expect(program(`let n = 1\n${src}`).evaluate().toString()).toBe('11');
  });

  it('a lambda that calls a reassigned local reads it at run time', () => {
    expect(
      both(
        'let h = (k) => k + 1\nconst g = (m) => h(m) * 2\nlet a = g(1)\nh := (k) => k + 10\na + g(1)'
      )
    ).toMatchObject({ compiled: 26, interpreted: '26' }); // 4 + 22
  });
});

describe('COMPILE a call of a block-local function with a tuple argument', () => {
  // The interpreter binds a tuple whole at a parameter with no declared type,
  // applies the function to each tuple of a list of tuples, and maps a call
  // over the components of a tuple at a parameter declared as a scalar. The
  // JavaScript code bound the local under its run-time broadcast, which maps
  // into a point too (`(v) => 7` applied to `p` gave `[7, 7]`), and a local
  // that shadows an engine-level function was declined, or compiled with the
  // engine-level function.
  const F = (body: unknown, ...params: unknown[]) => [
    'Function',
    body,
    ...params,
  ];
  const constForm = (literal: unknown, call: unknown) => [
    'Block',
    [
      'Declare',
      'g',
      [
        'Dictionary',
        ['KeyValuePair', 'value', literal],
        ['KeyValuePair', 'constant', 'True'],
      ],
    ],
    call,
  ];
  const assignForm = (literal: unknown, call: unknown) => [
    'Block',
    ['Declare', 'g', "'function'"],
    ['Assign', 'g', literal],
    call,
  ];
  const reboundForm = (literal: unknown, call: unknown) => [
    'Block',
    ['Declare', 'g', "'function'"],
    ['Assign', 'g', literal],
    ['If', ['Greater', 'n', 0], ['Assign', 'g', literal]],
    call,
  ];
  const VALUES = {
    p: [5, 6],
    P: [
      [1, 2],
      [3, 4],
    ],
    n: 1,
  };
  const engine = (shadow: boolean) => {
    const e = new ComputeEngine();
    e.declare('p', 'tuple<real, real>');
    e.declare('P', 'list<tuple<real, real>>');
    e.declare('n', 'real');
    if (shadow)
      e.assign('g', e.box(F(['Multiply', 2, 'u'], ['Typed', 'u', 'real'])));
    return e;
  };
  const jsValueOf = (json: unknown): unknown =>
    Array.isArray(json) && (json[0] === 'Tuple' || json[0] === 'List')
      ? json.slice(1).map(jsValueOf)
      : json;
  /** The compiled value, and the value of `evaluate()`, of `json`. */
  const compare = (json: unknown, shadow = false) => {
    const result = compile(engine(shadow).box(json as never), {
      to: 'javascript',
      fallback: false,
    } as never)!;
    const e = engine(shadow);
    e.assign('p', e.box(['Tuple', 5, 6]));
    e.assign('P', e.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    e.assign('n', 1);
    return {
      compiled: result.run!(VALUES as never),
      interpreted: jsValueOf(
        e
          .box(json as never)
          .evaluate({ materialization: true })
          .json
      ),
    };
  };
  const ARGS: [string, unknown, unknown][] = [
    ['a tuple symbol', 'p', 7],
    ['a list-of-tuples symbol', 'P', [7, 7]],
    ['a list literal of tuples', ['List', 'p', ['Tuple', 'n', 2]], [7, 7]],
  ];

  describe.each([
    ['`const`', constForm],
    ['`Declare` and `Assign`', assignForm],
  ])('the %s form', (_, form) => {
    test.each(ARGS)(
      'an untyped parameter takes %s whole',
      (_, arg, expected) => {
        for (const shadow of [false, true]) {
          const r = compare(form(F(7, 'v'), ['g', arg]), shadow);
          expect(r).toEqual({ compiled: expected, interpreted: expected });
        }
      }
    );

    test('a local shadows an engine-level function with the same name', () => {
      const r = compare(
        form(F(['Add', ['At', 'v', 1], 10], 'v'), ['g', 'p']),
        true
      );
      expect(r).toEqual({ compiled: 15, interpreted: 15 });
      const typed = compare(
        form(F(['Add', 'v', 10], ['Typed', 'v', 'real']), ['g', 'P']),
        true
      );
      expect(typed).toEqual({
        compiled: [
          [11, 12],
          [13, 14],
        ],
        interpreted: [
          [11, 12],
          [13, 14],
        ],
      });
    });

    test('an argument with an effect is evaluated once', () => {
      const literal = F('w', ['Typed', 'u', 'real'], ['Typed', 'w', 'real']);
      const { compiled, interpreted } = compare(
        form(literal, ['g', ['Tuple', 1, 2], ['Random']])
      );
      for (const v of [compiled, interpreted] as number[][]) {
        expect(v.length).toBe(2);
        expect(v[0]).toBe(v[1]);
      }
    });

    // The component calls were boxed with the ENGINE-level `g`, so with
    // `g: (string) -> number` declared in the engine each component became
    // an `incompatible-type` error and the compilation failed. With no
    // engine-level `g`, boxing them declared `g` in the engine.
    test('the component calls of a local are not checked against an engine-level function', () => {
      const literal = F(['Multiply', 2, 'u'], ['Typed', 'u', 'real']);
      const CASES: [unknown, unknown][] = [
        [['Tuple', 1, 2], [2, 4]],
        [
          ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
          [
            [2, 4],
            [6, 8],
          ],
        ],
      ];
      for (const [arg, expected] of CASES) {
        const json = form(literal, ['g', arg]);
        for (const declared of [true, false]) {
          const e = new ComputeEngine();
          if (declared) e.declare('g', '(string) -> number');
          const result = compile(e.box(json as never), {
            to: 'javascript',
            fallback: false,
          } as never)!;
          expect(result.run!({} as never)).toEqual(expected);
          if (!declared) expect(e.lookupDefinition('g')).toBeUndefined();
          expect(jsValueOf(e.box(json as never).evaluate().json)).toEqual(
            expected
          );
        }
      }
    });
  });

  test('a reassigned local with a scalar parameter maps over the tuple', () => {
    const r = compare(
      reboundForm(F(['Add', 'v', 10], ['Typed', 'v', 'real']), ['g', 'p']),
      true
    );
    expect(r).toEqual({ compiled: [15, 16], interpreted: [15, 16] });
  });

  test('a reassigned local with an untyped parameter fails closed, with the reason', () => {
    const json = reboundForm(F(7, 'v'), ['g', 'p']);
    expect(() =>
      compile(engine(false).box(json as never), {
        to: 'javascript',
        fallback: false,
      } as never)
    ).toThrow(/its value is known only at run time/);
    const e = engine(false);
    e.assign('p', e.box(['Tuple', 5, 6]));
    e.assign('n', 1);
    expect(e.box(json as never).evaluate().json).toBe(7);
  });
});
