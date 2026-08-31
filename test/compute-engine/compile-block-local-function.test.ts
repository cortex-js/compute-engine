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
    // The local is bound to the lazy stream pipeline…
    expect(code).toContain('let g = ((k) =>');
    // …and the call, whose argument is constant, folds (see below).
    expect(code).toContain('return 14');
  });

  it('emits the CALL when the argument is not constant', () => {
    const { compiled, code } = both(
      'const g = (k) => Sum(Take(Map( _ => _^2, 1..oo), k))\ng(n)',
      { vars: { n: 3 } }
    );
    expect(code).toContain('g(');
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
    // JavaScript would bind the missing parameter to `undefined` and compute
    // NaN; the interpreter reports an error, so the compilation must not
    // silently disagree.
    expect(() => both('const h = (a, b) => a + b\nh(1)')).toThrow(
      /declared with 2 parameters but called with 1/
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
    expect(code).toContain('let h = ((k) =>');
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
    expect(scalar.code).toContain('let gd = ((x) => 2 * x)');
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
    ).toThrow(/DefineFunction: cannot compile/);
  });

  it('Python still fails closed on a call of a lambda-bound local', () => {
    expect(() =>
      both('const h = (k) => k + 1\nh(3)', { to: 'python' })
    ).toThrow(/Unknown operator `h`/);
  });
});
