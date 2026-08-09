import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { takeProvisionalDependents } from '../../src/compute-engine/boxed-expression/provisional-application';

//
// Regression tests for the 2026-08-07 "JSON parser" bug cluster: an
// unannotated function parameter used as a collection must ACCUMULATE that
// evidence on the parameter's own binding, so the inferred signature reflects
// the use and the lambda auto-broadcast binds a collection argument WHOLE
// instead of mapping the function over its elements.
//
// Three mechanisms, three fixes:
//
// 1. A parameter referenced from a NESTED Block scope (an `if` branch, a
//    `while` body) auto-declared a fresh shadow binding per scope, so the
//    type evidence inference wrote (`cs[j]` ⇒ indexed collection) landed on a
//    throwaway binding: the literal's parameter stayed `unknown` and the
//    function broadcast. Bare parameters now share ONE cached binding for the
//    whole body canonicalization (the caching annotated parameters already
//    had), and the parameter declaration adopts it
//    (`engine-expression-entrypoints.ts`, `canonicalFunctionLiteralArguments`).
//
// 2. Calls to user functions with INFERRED signatures skip argument
//    validation, which also silenced its narrowing side-channel — so a
//    function that merely forwards its parameter (`g(xs) = f(xs)`) learned
//    nothing. `narrowArgsFromInferredSignature` (box.ts) now propagates a
//    collection-only callee parameter type onto an unknown symbol argument.
//
// 3. `Length`'s parameter is deliberately `any` (Length(5) stays symbolic),
//    so validation contributes no inference; its canonical handler now treats
//    `Length(x)` on a not-yet-typed symbol as collection evidence.
//
// The sibling mechanism — a CALL SITE annotating an inline callback literal's
// parameter with the element type of the collection it is applied to — lives
// in `lambda-param-element-inference.test.ts`.
//
// Also covered here: the nullary makeLambda path swept its stale
// canonicalization bindings (a zero-arg function's `while` loop never
// terminated), and the Kleene handling of `boolean | missing` conditions in
// `And`/`Or`/`Not` (a guarded loop condition `j <= n && cs[j] == "a"` was
// rejected at canonicalization with `incompatible-type`).
//

function run(source: string): string {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  return r.value?.toString() ?? '<no value>';
}

/** The inferred signature of `f` after executing `source`. */
function signatureOf(source: string, name = 'f'): string {
  const ce = new ComputeEngine();
  executeEpsil(ce, source);
  return signatureIn(ce, name);
}

/** The inferred signature currently installed for `name` on `ce`. */
function signatureIn(ce: ComputeEngine, name: string): string {
  const def = ce.lookupDefinition(name);
  if (def && 'operator' in def && def.operator)
    return def.operator.signature?.toString() ?? '<none>';
  return '<no definition>';
}

describe('collection evidence reaches the parameter binding', () => {
  test('indexing in an if condition (single nested scope)', () => {
    expect(
      signatureOf('function f(cs) { if cs[1] == "a" { 1 } else { 2 } }')
    ).toMatch(/indexed_collection/);
  });

  test('indexing in a doubly-nested if', () => {
    expect(
      signatureOf(
        'function f(cs) { if 1 < 2 { if cs[1] == "a" { 1 } else { 2 } } else { 0 } }'
      )
    ).toMatch(/indexed_collection/);
  });

  test('indexing in a while condition', () => {
    expect(
      signatureOf(
        'function f(cs) { let j = 1\nwhile cs[j] != "z" { j = j + 1 }\nj }'
      )
    ).toMatch(/indexed_collection/);
  });

  test('Length-only use infers collection', () => {
    expect(signatureOf('function f(cs) { Length(cs) }')).toMatch(/collection/);
  });

  test('forwarding to a collection-consuming callee propagates', () => {
    expect(
      signatureOf('function h(cs) { cs[1] }\nfunction f(xs) { h(xs) }')
    ).toMatch(/indexed_collection/);
  });

  test('a scalar-bodied lambda still infers scalar-friendly (broadcast preserved)', () => {
    // The ratified vectorization default: no collection evidence, parameter
    // stays unknown, and the function maps over a list argument.
    expect(run('f(x) = x * 2\nf([1, 2, 3])')).toBe('[2,4,6]');
  });
});

//
// `for x in xs` is collection evidence about `xs` in the same way `Length(xs)`
// and `xs[i]` are. The Element clauses of a `Loop`/`Comprehension` are rebuilt
// with `ce._fn('Element', …)`, which bypasses the Element canonical handler, so
// nothing narrowed the ITERATED operand: a parameter whose only use was being
// iterated stayed `unknown` and the lambda broadcast over its elements.
//
describe('for-in is collection evidence', () => {
  test('iteration-only use infers collection', () => {
    expect(signatureOf('function f(cs) { for c in cs { c } }')).toMatch(
      /collection/
    );
  });

  test('accumulating over an iterated parameter binds the list whole', () => {
    expect(
      run(
        'function f(cs) { let t = 0\nfor c in cs { t = t + c }\nt }\nf([1,2,3])'
      )
    ).toBe('6');
  });

  test('for-in nested inside an if still infers collection', () => {
    expect(
      signatureOf(
        'function f(cs) { let t = 0\nif 1 < 2 { for c in cs { t = t + c } }\nt }'
      )
    ).toMatch(/collection/);
  });

  test('a non-symbol collection expression is left alone', () => {
    expect(
      run(
        'function f(k) { let t = 0\nfor c in [1,2,3] { t = t + c * k }\nt }\nf(2)'
      )
    ).toBe('12');
    expect(
      signatureOf(
        'function f(k) { let t = 0\nfor c in [1,2,3] { t = t + c }\nt }'
      )
    ).toMatch(/\(unknown\)/);
  });
});

describe('collection arguments bind whole (no spurious broadcast)', () => {
  test('parameter passed through one frame', () => {
    expect(
      run(
        'function f(cs) { if cs[1] == "a" { "yes" } else { "no" } }\n' +
          'function g(xs) { f(xs) }\n' +
          'g(["a", "b", "c"])'
      )
    ).toBe('"yes"');
  });

  test('lazy collection argument through one frame', () => {
    expect(
      run(
        'function f(cs) { if cs[1] == "a" { "yes" } else { "no" } }\n' +
          'function g(xs) { f(xs) }\n' +
          'g(Characters("abc"))'
      )
    ).toBe('"yes"');
  });

  test('one-step wrapper over a recursive scanner', () => {
    expect(
      run(
        'function scan(cs, i, acc) {\n' +
          '  let c = cs[i]\n' +
          '  if c == "q" { (StringJoin(ListFrom(acc)), i + 1) }\n' +
          '  else { scan(cs, i + 1, Join(acc, [c])) }\n' +
          '}\n' +
          'ps(cs, i) = scan(cs, i + 1, [])\n' +
          'function jp(s) {\n' +
          '  let (v, w) = ps(Characters(s), 1)\n' +
          '  v\n' +
          '}\n' +
          'jp("xhiq")'
      )
    ).toBe('"hi"');
  });

  test('while loop over Length of a parameter', () => {
    expect(
      run(
        'function f(cs) {\n' +
          '  let j = 1\n' +
          '  while j < Length(cs) { j = j + 1 }\n' +
          '  j\n' +
          '}\n' +
          'f(Characters("abc"))'
      )
    ).toBe('3');
  });
});

describe('nullary block functions sweep stale canonicalization bindings', () => {
  test('while loop in a zero-argument function terminates', () => {
    expect(
      run(
        'function f() {\n  let j = 1\n  while j < 3 { j = j + 1 }\n  j\n}\nf()'
      )
    ).toBe('3');
  });
});

describe('Kleene absence in loop conditions', () => {
  test('guarded out-of-range read: And(False, Missing) is False', () => {
    expect(
      run(
        'let cs = Characters("  4")\n' +
          'let j = 1\n' +
          'while j <= Length(cs) && cs[j] == " " { j = j + 1 }\n' +
          'j'
      )
    ).toBe('3');
  });

  test('Not(Missing) is Missing', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Not', 'Missing']).evaluate().symbol).toBe('Missing');
  });

  test('And short-circuits False over a possibly-missing operand', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'And',
      'False',
      ['Equal', ['At', ['List', { str: 'a' }], 5], { str: 'a' }],
    ]);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().symbol).toBe('False');
  });
});

//
// Forward references: the callee is defined AFTER the caller.
//
// Fix #2 above only fires when the callee already exists. Written the other
// way round — the top-down style, and the only possible order for mutual
// recursion — the caller canonicalizes its call blind: `cs` learns nothing,
// `paramsAreScalar` stays true, and `process([10,20,30])` came back as
// `[process(10),process(20),process(30)]` (the broadcast split the list, each
// scalar hit the callee's declared list type, and the errored elements
// surfaced as inert applications).
//
// The repair reuses the juxtaposition machinery verbatim
// (`boxed-expression/provisional-application.ts`, exercised for its original
// channel by `definition-order.test.ts`): a call to a name that has no
// definition — or only a guessed signature — is NOTED on the enclosing
// `Function` literal, which is then re-derived from its RAW operands when
// that name's definition state changes. The re-canonicalization runs the
// narrowing against the callee's real signature.
//
describe('callee defined after caller', () => {
  const CALLEE_DECLARED = 'function clean(v: list<number>) { v[1] }';
  const CALLER_BARE = 'function process(cs) { clean(cs) + 1 }';

  test('the end-to-end pin: caller first matches callee first', () => {
    expect(run(`${CALLER_BARE}\n${CALLEE_DECLARED}\nprocess([10,20,30])`)).toBe(
      '11'
    );
    // The control: the same program with the definitions swapped.
    expect(run(`${CALLEE_DECLARED}\n${CALLER_BARE}\nprocess([10,20,30])`)).toBe(
      '11'
    );
  });

  test("the caller's parameter picks up the declared collection type", () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, CALLER_BARE);
    // Before the callee exists: nothing known, and the result type carries the
    // `broadcastable<>` marker that says the lambda will map over a list.
    expect(signatureIn(ce, 'process')).toBe(
      '(unknown) any -> broadcastable<number>'
    );
    executeEpsil(ce, CALLEE_DECLARED);
    expect(signatureIn(ce, 'process')).toBe('(list<number>) -> number');
  });

  test('a callee whose collection param is INFERRED from its own body', () => {
    // `clean` is unannotated: its parameter type comes from `v[1]`.
    expect(
      run(
        'function process(cs) { clean(cs) + 1 }\n' +
          'function clean(v) { v[1] }\n' +
          'process([10,20,30])'
      )
    ).toBe('11');
    expect(
      signatureOf(
        'function process(cs) { clean(cs) + 1 }\nfunction clean(v) { v[1] }',
        'process'
      )
    ).toMatch(/indexed_collection/);
  });

  test('a DECLARATION alone repairs the caller — no body needed', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, CALLER_BARE);
    ce.declare('clean', '(list<number>) -> number');
    expect(signatureIn(ce, 'process')).toBe('(list<number>) -> number');
    // ...and the program still runs once the body arrives.
    executeEpsil(ce, CALLEE_DECLARED);
    expect(executeEpsil(ce, 'process([10,20,30])').value?.toString()).toBe(
      '11'
    );
  });

  test('an ANNOTATED caller parameter is unaffected', () => {
    expect(
      run(
        'function process(cs: list<number>) { clean(cs) + 1 }\n' +
          `${CALLEE_DECLARED}\n` +
          'process([10,20,30])'
      )
    ).toBe('11');
  });

  test('a zero-argument callee in the same body', () => {
    // Nullary functions take a different `makeLambda` path; defining one must
    // still leave the forward reference to `clean` waiting.
    expect(
      run(
        'function process(cs) { clean(cs) + tag() }\n' +
          'function tag() { 1 }\n' +
          `${CALLEE_DECLARED}\n` +
          'process([10,20,30])'
      )
    ).toBe('11');
  });

  //
  // The negative: the vectorization default must survive. A callee with a
  // SCALAR parameter is not evidence about the caller's argument — an
  // inferred scalar is a broadcast-friendly guess — so the caller keeps
  // mapping over a list.
  //
  test('a SCALAR callee defined later leaves the caller broadcasting', () => {
    expect(
      run(
        'function process(cs) { twice(cs) + 1 }\n' +
          'function twice(v) { 2 * v }\n' +
          'process([10,20,30])'
      )
    ).toBe('[21,41,61]');
    expect(
      signatureOf(
        'function process(cs) { twice(cs) + 1 }\nfunction twice(v) { 2 * v }',
        'process'
      )
    ).toMatch(/\(unknown\)/);
  });

  test('a callee that never gains a definition is left alone', () => {
    expect(signatureOf(CALLER_BARE, 'process')).toBe(
      '(unknown) any -> broadcastable<number>'
    );
  });

  //
  // Recursion.
  //
  describe('recursion', () => {
    test('a self-recursive function is not re-derived against itself', () => {
      // The self-call forwards a bare, still-unknown parameter, so it notes
      // `walk` while the body canonicalizes. Installing the definition would
      // then re-derive it against itself — a full re-canonicalization that
      // can learn nothing (self-call narrowing is circular by construction),
      // and one that notes `walk` again, leaving the definition permanently
      // waiting on itself. The identity filter DROPS it instead.
      const ce = new ComputeEngine();
      executeEpsil(
        ce,
        'function walk(xs, k) { if k == 0 { 0 } else { walk(xs, k - 1) } }'
      );
      expect(takeProvisionalDependents(ce, 'walk')).toBeUndefined();
      // Still correct, and still broadcast-friendly: nothing said `xs` is a
      // collection.
      expect(executeEpsil(ce, 'walk([1,2],3)').value?.toString()).toBe('[0,0]');
    });

    test('a self-recursive collection scanner still evaluates', () => {
      expect(
        run(
          'function countdown(xs) { if Length(xs) == 0 { 0 } else { 1 + countdown(Rest(xs)) } }\n' +
            'countdown([1,2,3,4])'
        )
      ).toBe('4');
    });

    test.each([
      ['ping first', ['pingL', 'pongL']],
      ['pong first', ['pongL', 'pingL']],
    ])('mutual recursion, %s', (_label, order) => {
      const bodies: Record<string, string> = {
        pingL:
          'function pingL(xs) { if Length(xs) == 0 { 0 } else { 1 + pongL(Rest(xs)) } }',
        pongL:
          'function pongL(xs) { if Length(xs) == 0 { 0 } else { 1 + pingL(Rest(xs)) } }',
      };
      expect(
        run(`${bodies[order[0]]}\n${bodies[order[1]]}\npingL([1,2,3])`)
      ).toBe('3');
    });
  });

  //
  // Route parity. The Epsil route above; the programmatic route here. (NOT the
  // LaTeX route: `clean(cs)` with `clean` undeclared parses as a
  // MULTIPLICATION, which belongs to the juxtaposition channel.)
  //
  describe('route parity', () => {
    /** `process(cs) := clean(cs) + 1`, built by hand. */
    const assignCaller = (ce: ComputeEngine) =>
      ce.assign(
        'process',
        ce.box(['Function', ['Add', ['clean', 'cs'], 1], 'cs'])
      );

    /** `clean(v: list<number>) := v[1]`. */
    const assignCallee = (ce: ComputeEngine) =>
      ce.assign(
        'clean',
        ce.box([
          'Function',
          ['At', 'v', 1],
          ['Typed', 'v', { str: 'list<number>' }],
        ])
      );

    test('the ce.assign/box route is repaired too', () => {
      const ce = new ComputeEngine();
      assignCaller(ce);
      assignCallee(ce);
      expect(signatureIn(ce, 'process')).toBe('(list<number>) -> number');
      expect(
        ce
          .box(['process', ['List', 10, 20, 30]])
          .evaluate()
          .toString()
      ).toBe('11');
    });

    test('a caller re-derived against a SCALAR callee still waits', () => {
      // The rebuilt literal re-registers for whatever it still reads
      // provisionally, so a later REdefinition of the callee retries it.
      const ce = new ComputeEngine();
      assignCaller(ce);
      ce.assign('clean', ce.box(['Function', ['Multiply', 2, 'v'], 'v']));
      expect(signatureIn(ce, 'process')).toBe('(unknown) -> finite_number');
      assignCallee(ce);
      expect(signatureIn(ce, 'process')).toBe('(list<number>) -> number');
    });
  });

  //
  // Chains. Re-deriving a dependent IS that dependent's own name gaining a
  // better definition, but `installRebuiltLiteral` mutates the definition in
  // place and never passes through `updateDef` — so until 2026-08-08 a repair
  // stopped after one hop and `outer → middle → inner` left `outer` stale.
  // `repairProvisionalDependents` now CASCADES: it collects the definitions it
  // rebuilt and fires the repair once per installed name after the wave, so a
  // chain repairs transitively and a diamond rebuilds its apex once.
  //
  describe('forward-reference chains', () => {
    const CHAIN3 = [
      'function outer(cs) { middle(cs) + 1 }',
      'function middle(cs) { inner(cs) + 1 }',
      'function inner(v: list<number>) { v[1] }',
    ];

    test('a 3-level chain repairs transitively (Epsil route)', () => {
      const ce = new ComputeEngine();
      executeEpsil(ce, CHAIN3[0]);
      executeEpsil(ce, CHAIN3[1]);
      // Nothing known yet at either level.
      expect(signatureIn(ce, 'outer')).toBe(
        '(unknown) any -> broadcastable<number>'
      );
      executeEpsil(ce, CHAIN3[2]);
      // `inner` repairs `middle`; `middle`'s rebuild cascades to `outer`.
      expect(signatureIn(ce, 'middle')).toBe('(list<number>) -> number');
      expect(signatureIn(ce, 'outer')).toBe('(list<number>) -> number');
      // Bound whole: 10 + 1 + 1. Before the cascade this broadcast into
      // `[1 + middle(10), 1 + middle(20), 1 + middle(30)]`.
      expect(executeEpsil(ce, 'outer([10,20,30])').value?.toString()).toBe(
        '12'
      );
    });

    test('a 3-level chain repairs transitively (ce.assign/box route)', () => {
      const ce = new ComputeEngine();
      ce.assign(
        'outerB',
        ce.box(['Function', ['Add', ['middleB', 'cs'], 1], 'cs'])
      );
      ce.assign(
        'middleB',
        ce.box(['Function', ['Add', ['innerB', 'cs'], 1], 'cs'])
      );
      ce.assign(
        'innerB',
        ce.box([
          'Function',
          ['At', 'v', 1],
          ['Typed', 'v', { str: 'list<number>' }],
        ])
      );
      expect(signatureIn(ce, 'outerB')).toBe('(list<number>) -> number');
      expect(
        ce
          .box(['outerB', ['List', 10, 20, 30]])
          .evaluate()
          .toString()
      ).toBe('12');
    });

    test('a 4-level chain — beyond a single cascade hop', () => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'function lvl1(cs) { lvl2(cs) + 1 }');
      executeEpsil(ce, 'function lvl2(cs) { lvl3(cs) + 1 }');
      executeEpsil(ce, 'function lvl3(cs) { lvl4(cs) + 1 }');
      executeEpsil(ce, 'function lvl4(v: list<number>) { v[1] }');
      for (const name of ['lvl1', 'lvl2', 'lvl3'])
        expect(signatureIn(ce, name)).toBe('(list<number>) -> number');
      expect(executeEpsil(ce, 'lvl1([10,20,30])').value?.toString()).toBe('13');
    });

    test('a diamond: both forwarders current before the apex rebuilds', () => {
      // `topD` waits on `leftD` AND `rightD`, which both wait on `baseD`.
      // Installing `baseD` rebuilds the two forwarders in ONE wave, and the
      // apex is rebuilt after the wave — against two already-current
      // forwarders — rather than once per forwarder.
      const ce = new ComputeEngine();
      executeEpsil(ce, 'function topD(cs) { leftD(cs) + rightD(cs) }');
      executeEpsil(ce, 'function leftD(cs) { baseD(cs) }');
      executeEpsil(ce, 'function rightD(cs) { baseD(cs) }');
      executeEpsil(ce, 'function baseD(v: list<number>) { v[1] }');
      expect(signatureIn(ce, 'leftD')).toBe('(list<number>) -> number');
      expect(signatureIn(ce, 'rightD')).toBe('(list<number>) -> number');
      expect(signatureIn(ce, 'topD')).toBe('(list<number>) -> number');
      expect(executeEpsil(ce, 'topD([10,20,30])').value?.toString()).toBe('20');
    });

    test('mutual forward references terminate and both repair', () => {
      // `cycA` and `cycB` wait on each other AND on a shared, still-undefined
      // collection callee. Defining `baseC` rebuilds both, and each rebuild
      // cascades back into the other — which is still under the `REPAIRING`
      // guard, so the recursion bottoms out. (A hang here fails as a jest
      // timeout.)
      const ce = new ComputeEngine();
      executeEpsil(ce, 'function cycA(cs) { cycB(cs) + baseC(cs) }');
      executeEpsil(ce, 'function cycB(cs) { cycA(cs) + baseC(cs) }');
      executeEpsil(ce, 'function baseC(v: list<number>) { v[1] }');
      // Both parameters bound the collection whole (the result type still
      // carries the broadcast marker from the unresolved mutual call).
      expect(signatureIn(ce, 'cycA')).toMatch(/^\(list<number>\)/);
      expect(signatureIn(ce, 'cycB')).toMatch(/^\(list<number>\)/);
    });

    test('a sibling skipped under the repair guard is still repaired', () => {
      // `outerX` waits on BOTH `middleX` and `baseX`, and was registered on
      // `baseX` FIRST. Installing `baseX` therefore rebuilds `outerX` against
      // middleX's still-stale signature, and middleX's own cascade then finds
      // `outerX` under the `REPAIRING` guard of the enclosing wave and skips
      // it. Nothing retriggers a skipped dependent, so `outerX` kept its
      // `unknown` first parameter forever until the deferred-queue drain.
      const ce = new ComputeEngine();
      executeEpsil(ce, 'function outerX(a, b) { middleX(a) + baseX(b) }');
      executeEpsil(ce, 'function middleX(a) { baseX(a) }');
      executeEpsil(ce, 'function baseX(v: list<number>) { v[1] }');
      expect(signatureIn(ce, 'middleX')).toBe('(list<number>) -> number');
      expect(signatureIn(ce, 'outerX')).toBe(
        '(list<number>, list<number>) -> number'
      );
      // Both arguments bound WHOLE: 10 + 30.
      expect(
        executeEpsil(ce, 'outerX([10,20],[30,40])').value?.toString()
      ).toBe('40');
    });

    //
    // The negative: a chain of SCALAR forwarders must keep vectorizing. The
    // cascade re-derives, it never asserts scalarness — nothing along the
    // chain learns a collection type, so the outermost call still maps
    // elementwise.
    //
    test('an all-scalar 3-level chain still broadcasts end to end', () => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'function sc1(cs) { sc2(cs) + 1 }');
      executeEpsil(ce, 'function sc2(cs) { sc3(cs) + 1 }');
      executeEpsil(ce, 'function sc3(v) { 2 * v }');
      expect(signatureIn(ce, 'sc1')).toMatch(/^\(unknown\)/);
      expect(executeEpsil(ce, 'sc1(5)').value?.toString()).toBe('12');
      expect(executeEpsil(ce, 'sc1([10,20,30])').value?.toString()).toBe(
        '[22,42,62]'
      );
    });
  });

  test('a juxtaposition and a forward reference in ONE body', () => {
    // `2a(t)` is the juxtaposition channel (frozen as `2·a·t` while `a` is
    // undefined); `clean(t)` is the inference channel. Both are noted on the
    // same literal, and repairing one must not drop the other — in either
    // definition order.
    const build = () => {
      const ce = new ComputeEngine();
      ce.assign(
        'mixed',
        ce.box([
          'Function',
          [
            'Add',
            ['InvisibleOperator', 2, 'a', ['Delimiter', 't']],
            ['clean', 't'],
          ],
          't',
        ])
      );
      return ce;
    };
    const defineA = (ce: ComputeEngine) =>
      ce.assign('a', ce.box(['Function', ['Multiply', 2, 'u'], 'u']));
    const defineClean = (ce: ComputeEngine) =>
      ce.assign(
        'clean',
        ce.box([
          'Function',
          ['At', 'v', 1],
          ['Typed', 'v', { str: 'list<number>' }],
        ])
      );

    for (const order of [
      [defineClean, defineA],
      [defineA, defineClean],
    ]) {
      const ce = build();
      for (const define of order) define(ce);
      // The juxtaposition became an application...
      expect(
        (
          (ce.lookupDefinition('mixed') as any).operator._lambdaLiteral as any
        ).toString()
      ).toContain('a(t)');
      // ...and `mixed` binds its list argument WHOLE (`clean` sees the list;
      // only the scalar-parameter `a` broadcasts inside).
      expect(signatureIn(ce, 'mixed')).toBe('(list<number>) -> number');
      expect(
        ce
          .box(['mixed', ['List', 3, 4, 5]])
          .evaluate()
          .toString()
      ).toBe('[15,19,23]');
    }
  });
});

//
// A callee forward-DECLARED with the bare `function` wildcard
// (`ce.declare('clean', 'function')` — the documented forward-declaration
// form, `doc/06-guide-augmenting.md`).
//
// The wildcard is a widening, not a contract: it says only "this name is
// callable". It therefore installs a function-typed VALUE definition whose
// type carries no parameter types, and — unlike the no-declaration case — it
// STAYS that way when a literal is assigned (narrowing it would turn a
// permissive forward declaration into an arity/parameter contract that every
// later re-assignment would have to satisfy). Two consequences, both fixed
// here:
//
//   * the callee had no reachable signature to narrow the caller's argument
//     from, in ANY definition order — the value-def application branch now
//     reads the ASSIGNED VALUE's own type (`box.ts`);
//   * a caller canonicalized against the wildcard never registered in the
//     provisional registry (the noting gate wanted an INFERRED type), so the
//     later assignment repaired nothing.
//
// The full signatures below (result type included) rely on the wildcard-head
// application typing reading the ASSIGNED value's signature
// (`getFunctionResultType`, boxed-function.ts): a bare-`function` wildcard
// promises nothing, so before that fix the application was broadcast-typed
// (`clean([10,20,30])` typed `list<unknown^3>` while evaluating to `10`).
//
describe('wildcard-declared callees', () => {
  /** `clean(v: list<number>) := v[1]`, as MathJSON. */
  const listCallee = (ce: ComputeEngine) =>
    ce.box([
      'Function',
      ['At', 'v', 1],
      ['Typed', 'v', { str: 'list<number>' }],
    ]);

  /** `proc(cs) := clean(cs) + 1`, as MathJSON. */
  const boxCaller = (ce: ComputeEngine) =>
    ce.box(['Function', ['Add', ['clean', 'cs'], 1], 'cs']);

  describe('caller first, then the assignment (the repair path)', () => {
    test('box route', () => {
      const ce = new ComputeEngine();
      ce.declare('clean', 'function');
      ce.assign('proc', boxCaller(ce));
      // Nothing known yet: the wildcard has no parameter types. (Unlike the
      // entirely UNdeclared callee above, it also pins the effects axis — the
      // wildcard carries no effect specifier — so the caller's signature has
      // no `any` effects marker.)
      expect(signatureIn(ce, 'proc')).toBe(
        '(unknown) -> broadcastable<number>'
      );
      ce.assign('clean', listCallee(ce));
      expect(signatureIn(ce, 'proc')).toBe('(list<number>) -> number');
      expect(
        ce
          .box(['proc', ['List', 10, 20, 30]])
          .evaluate()
          .toString()
      ).toBe('11');
    });

    test('Epsil route', () => {
      const ce = new ComputeEngine();
      ce.declare('clean', 'function');
      executeEpsil(ce, 'function proc(cs) { clean(cs) + 1 }');
      expect(signatureIn(ce, 'proc')).toBe(
        '(unknown) -> broadcastable<number>'
      );
      executeEpsil(ce, 'function clean(v: list<number>) { v[1] }');
      expect(signatureIn(ce, 'proc')).toBe('(list<number>) -> number');
      expect(executeEpsil(ce, 'proc([10,20,30])').value?.toString()).toBe('11');
    });

    test('an ANNOTATED caller parameter is unaffected', () => {
      const ce = new ComputeEngine();
      ce.declare('clean', 'function');
      executeEpsil(ce, 'function proc(cs: list<number>) { clean(cs) + 1 }');
      executeEpsil(ce, 'function clean(v: list<number>) { v[1] }');
      expect(executeEpsil(ce, 'proc([10,20,30])').value?.toString()).toBe('11');
    });
  });

  describe('assignment first, then the caller (no repair needed)', () => {
    // The registry pins below are the point of "no repair needed": the
    // narrowing sink runs BEFORE the noting decision, so an argument that was
    // narrowed synchronously is no longer narrowable and the caller does NOT
    // register as a dependent. Were it to register, it would stay parked
    // forever and every later re-assignment of `clean` would re-derive an
    // already-correct literal.
    test('box route', () => {
      const ce = new ComputeEngine();
      ce.declare('clean', 'function');
      ce.assign('clean', listCallee(ce));
      ce.assign('proc', boxCaller(ce));
      expect(signatureIn(ce, 'proc')).toBe('(list<number>) -> number');
      expect(
        ce
          .box(['proc', ['List', 10, 20, 30]])
          .evaluate()
          .toString()
      ).toBe('11');
      expect(takeProvisionalDependents(ce, 'clean')).toBeUndefined();
    });

    test('Epsil route', () => {
      const ce = new ComputeEngine();
      ce.declare('clean', 'function');
      executeEpsil(ce, 'function clean(v: list<number>) { v[1] }');
      executeEpsil(ce, 'function proc(cs) { clean(cs) + 1 }');
      expect(signatureIn(ce, 'proc')).toBe('(list<number>) -> number');
      expect(executeEpsil(ce, 'proc([10,20,30])').value?.toString()).toBe('11');
      expect(takeProvisionalDependents(ce, 'clean')).toBeUndefined();
    });
  });

  //
  // The negatives. Everything the wildcard's permissiveness buys must survive:
  // no new validation, no contract created by the first assignment, and the
  // vectorization default when the assigned literal is scalar.
  //

  test('a CONCRETE declared signature still validates its arguments', () => {
    // The wildcard branch must not have loosened the neighbouring
    // explicit-signature check. Canonical pin for this behavior:
    // `application-validation-regressions.test.ts`.
    const ce = new ComputeEngine();
    ce.declare('gsig', '(integer) -> integer');
    expect(ce.box(['gsig', 0.5]).isValid).toBe(false);
    expect(ce.box(['gsig', { str: 'a' }]).isValid).toBe(false);
    expect(ce.box(['gsig', 3]).isValid).toBe(true);
  });

  test('re-assigning a wildcard-declared symbol stays unconstrained', () => {
    // The declared type is left as the wildcard on purpose: had the first
    // assignment narrowed it, the arity and parameter types of that literal
    // would have become a contract and the re-assignments below would throw.
    const ce = new ComputeEngine();
    ce.declare('rw', 'function');
    ce.assign('rw', ce.box(['Function', ['Multiply', 2, 'u'], 'u']));
    expect(ce.box(['rw', 4]).evaluate().toString()).toBe('8');
    // ...a different parameter TYPE...
    ce.assign('rw', listCallee(ce));
    expect(
      ce
        .box(['rw', ['List', 7, 8]])
        .evaluate()
        .toString()
    ).toBe('7');
    // ...and a different ARITY.
    ce.assign('rw', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
    expect(ce.box(['rw', 3, 4]).evaluate().toString()).toBe('7');
  });

  test('a SCALAR literal assigned to the wildcard leaves the caller broadcasting', () => {
    const ce = new ComputeEngine();
    ce.declare('twice', 'function');
    executeEpsil(ce, 'function bproc(cs) { twice(cs) + 1 }');
    executeEpsil(ce, 'function twice(v) { 2 * v }');
    expect(signatureIn(ce, 'bproc')).toMatch(/^\(unknown\)/);
    expect(executeEpsil(ce, 'bproc([10,20,30])').value?.toString()).toBe(
      '[21,41,61]'
    );
  });

  test('a caller re-derived against a SCALAR assignment still waits', () => {
    // The rebuilt literal re-registers on the wildcard callee, so replacing
    // the scalar body with a collection-consuming one retries it.
    const ce = new ComputeEngine();
    ce.declare('clean', 'function');
    ce.assign('proc', boxCaller(ce));
    ce.assign('clean', ce.box(['Function', ['Multiply', 2, 'v'], 'v']));
    expect(signatureIn(ce, 'proc')).toMatch(/^\(unknown\)/);
    ce.assign('clean', listCallee(ce));
    expect(signatureIn(ce, 'proc')).toBe('(list<number>) -> number');
  });

  test('a wildcard callee that is never assigned is left alone', () => {
    const ce = new ComputeEngine();
    ce.declare('never2', 'function');
    executeEpsil(ce, 'function nproc(cs) { never2(cs) + 1 }');
    expect(signatureIn(ce, 'nproc')).toBe('(unknown) -> broadcastable<number>');
    // No error, and the vectorization default holds: the call broadcasts and
    // the unresolved applications surface inert.
    expect(executeEpsil(ce, 'nproc([1,2,3])').value?.toString()).toBe(
      '[1 + never2(1),1 + never2(2),1 + never2(3)]'
    );
    // The caller IS parked on `never2` — exactly as it is for an entirely
    // UNdeclared callee (the no-def channel notes the same way), so the
    // registry holds one pending entry rather than none.
    expect(takeProvisionalDependents(ce, 'never2')).toHaveLength(1);
  });
});
