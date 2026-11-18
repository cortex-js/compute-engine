/**
 * Declarative "is this compiled result self-contained?" signal:
 * `result.freeSymbols` (identifiers the caller must supply) and
 * `result.unsupported` (operators the target cannot lower), plus `error` on a
 * failed compile. See the `CompilationResult` type and
 * `BaseCompiler.analyzeReferences`.
 *
 * Related ask B in `TYCHO_ISSUE.md`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';
import { executeEpsil } from '../../src/epsil/execute-epsil';

describe('COMPILE reference analysis (freeSymbols / unsupported)', () => {
  describe('freeSymbols on a successful compile', () => {
    it('lists the genuinely free symbols', () => {
      const ce = new ComputeEngine();
      const r = compile(ce.parse('\\sin(a x) - y'));
      expect(r.freeSymbols!.sort()).toEqual(['a', 'x', 'y']);
      expect(r.unsupported).toEqual([]);
    });

    it('omits an assigned symbol (its value is folded in)', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const r = compile(ce.parse('\\sin(a x) - y'));
      expect(r.freeSymbols!.sort()).toEqual(['x', 'y']);
    });

    it('omits constants', () => {
      const ce = new ComputeEngine();
      const r = compile(ce.parse('2 \\cos(\\pi / 5)'))!;
      expect(r.freeSymbols).toEqual([]);
      expect(r.unsupported).toEqual([]);
    });

    it('lists a vars-mapped symbol as a required external input', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const r = compile(ce.parse('\\sin(a x) - y'), { vars: { a: 'u_var_a' } });
      // The vars mapping wins over folding, so `a` is referenced and must be
      // supplied — it appears in freeSymbols even though it has a value.
      expect(r.freeSymbols!.sort()).toEqual(['a', 'x', 'y']);
    });

    it('surfaces a free symbol reachable only through a folded value (which `unknowns` misses)', () => {
      const ce = new ComputeEngine();
      ce.assign('b', ce.parse('c + 1'));
      const expr = ce.parse('b x');
      expect(expr.unknowns).toEqual(['x']); // `c` is hidden behind `b`'s value
      const r = compile(expr);
      expect(r.freeSymbols!.sort()).toEqual(['c', 'x']);
    });

    it('excludes a lambda parameter', () => {
      const ce = new ComputeEngine();
      const r = compile(ce.box(['Function', ['Multiply', 2, 't'], 't']))!;
      expect(r.freeSymbols).toEqual([]);
    });

    it('excludes a Sum index but keeps a free bound', () => {
      const ce = new ComputeEngine();
      const r = compile(
        ce.box(['Sum', ['Power', 'i', 2], ['Limits', 'i', 1, 'n']])
      )!;
      expect(r.freeSymbols).toEqual(['n']);
    });
  });

  describe('unsupported / error on failure', () => {
    it('reports an unsupported operator declaratively (no throw) via compile()', () => {
      const ce = new ComputeEngine();
      const r = compile(ce.box(['Gamma', ['__NotAnOp', 'x']]) as any, {
        to: 'glsl',
      });
      expect(r.success).toBe(false);
      expect(r.unsupported).toContain('__NotAnOp');
      expect(typeof r.error).toBe('string');
      expect(r.error).toMatch(/__NotAnOp/);
    });
  });

  // A function used as a first-class VALUE (a higher-order operand to Map).
  describe('user-defined function as a higher-order operand', () => {
    it('still compiles an inline lambda operand', () => {
      const ce = new ComputeEngine();
      const r = compile(ce.parse('\\mathrm{Map}(x \\mapsto x^2, [1,2,3])'));
      expect(r.run!({})).toEqual([1, 4, 9]);
    });

    // A bound parameter whose name collides with a global user function must
    // resolve to the PARAMETER, not silently shadow it with the global `_fn_`.
    it('a parameter shadowing a same-named global function wins over the global', () => {
      const ce = new ComputeEngine();
      ce.parse('h(x) := x^2').evaluate(); // global `h`
      // f(h) := Map(h, [1,2,3]) — `h` here is f's (function-valued) parameter.
      ce.assign(
        'f',
        ce.box(['Function', ['Map', 'h', ['List', 1, 2, 3]], 'h'])
      );
      const r = compile(ce.box(['f', ['Function', ['Add', 'y', 10], 'y']]));
      // The passed function (y ↦ y+10) must be used, not the global h(x)=x².
      expect(r.run!({})).toEqual([11, 12, 13]);
    });

    // An explicit `vars` mapping is the caller's external-input contract and
    // always wins, even when its key collides with a user-function name.
    it('a `vars` mapping wins over a same-named user function', () => {
      const ce = new ComputeEngine();
      ce.declare('a', 'real');
      ce.declare('b', 'real');
      ce.parse('h(x) := x^2').evaluate();
      const r = compile(ce.box(['Map', 'h', ['List', 'a', 'b']]), {
        vars: { h: 'EXTERNAL_H' },
      });
      expect(r.freeSymbols).toContain('h');
    });
  });

  // A symbol the TARGET bakes into the emitted code is not an input the caller
  // has to supply. Most constants never reach the free-symbol branch — the
  // engine holds a value for `Pi` and friends, so they are folded first — but
  // the boolean literals have no engine value and did reach it, so
  // `Which(x > 0, 1, True, 2)` reported a phantom input named `True`.
  // Consumers derive a compiled function's variable list from `freeSymbols`
  // (this is how a plot picks its variables), and `True` is the idiomatic
  // `Which` fallback condition, so an ordinary piecewise grew a phantom
  // variable.
  //
  // The lookup behind this is `CompileTarget.constant`, deliberately distinct
  // from `var`: `var` falls back to a vars-object reference for any symbol it
  // does not recognize, so consulting it here would suppress EVERY free
  // symbol.
  describe('a constant the target inlines is not a free symbol', () => {
    const booleanShapes: [string, unknown][] = [
      ['bare', 'True'],
      [
        'Which fallback condition',
        ['Which', ['Greater', 'x', 0], 1, 'True', 2],
      ],
      ['conjunct', ['And', ['Greater', 'x', 0], 'True']],
      [
        'mask element',
        ['At', ['List', 10, 20, 30], ['List', 'False', 'True', 'True']],
      ],
    ];

    // Every target spells the boolean literals — `true` in JavaScript and both
    // shader languages, and the `BoolInterval` string
    // `'true'` on the interval target — so none of them reports one as an
    // input. Before this, GLSL emitted the undeclared identifier `True`
    // (a shader that fails to compile behind `success: true`) and the interval
    // target emitted a dangling `_.True` vars-object lookup that threw at run
    // time.
    for (const to of ['javascript', 'glsl', 'interval-js']) {
      for (const [label, expr] of booleanShapes) {
        it(`${to}: ${label}`, () => {
          const ce = new ComputeEngine();
          const r = compile(ce.box(expr as never), { to: to as never });
          expect(r.freeSymbols ?? []).not.toContain('True');
          expect(r.freeSymbols ?? []).not.toContain('False');
        });
      }
    }

    // The guard must key on what the TARGET inlines, not on whether the ENGINE
    // calls the symbol constant: a constant declared with no value is still an
    // input the caller must supply, because the emitted code references it.
    it('still reports a valueless declared constant', () => {
      const ce = new ComputeEngine();
      ce.declare('c', { type: 'real', isConstant: true });
      expect(compile(ce.parse('c + 1')).freeSymbols).toContain('c');
    });

    it('leaves ordinary free symbols alone', () => {
      const ce = new ComputeEngine();
      expect(compile(ce.parse('x + y')).freeSymbols!.sort()).toEqual([
        'x',
        'y',
      ]);
      // `Pi` has an engine value, so it is folded rather than filtered here.
      expect(compile(ce.parse('\\pi x')).freeSymbols).toEqual(['x']);
    });
  });

  // Tycho row 506. The symbol `Nothing` has no engine value and reached the
  // free-symbol branch, so `freeSymbols` reported it, and a host that checks
  // each free symbol against its inputs read it as an input with no value. No
  // emitted code reads it: in a statement position the emitter drops it, and
  // in a value position the compilation declines.
  describe('the symbol `Nothing` is not a free symbol', () => {
    const loop = [
      'Block',
      ['Declare', 'k', "'unknown'", 0],
      [
        'Loop',
        ['If', ['Greater', 'k', 2], ['Break'], 'Nothing'],
        ['Element', 'm', ['Range', 1, 3]],
      ],
      'k',
    ];

    it('as the else branch of an `If` statement, which the code drops', () => {
      const ce = new ComputeEngine();
      const r = compile(ce.box(loop as never));
      expect(r.success).toBe(true);
      expect(r.code).not.toContain('Nothing');
      expect(r.freeSymbols).toEqual([]);
    });

    it('as a statement of a block', () => {
      const ce = new ComputeEngine();
      const r = compile(ce.box(['Block', 'Nothing', ['Add', 'x', 1]] as never));
      expect(r.success).toBe(true);
      expect(r.freeSymbols).toEqual(['x']);
    });

    it('a `vars` key spelled `Nothing` is an input', () => {
      const ce = new ComputeEngine();
      const r = compile(ce.box(['Add', 'x', 'Nothing'] as never), {
        vars: { Nothing: '_.Nothing' },
      });
      expect(r.freeSymbols).toContain('Nothing');
    });
  });
});

// A `Declare` defines a local: only its initial value is read by the code.
// The value can be positional or in the trailing attributes dictionary (the
// form `let y = x + 1` parses to), and the type operand is not a symbol.
describe('COMPILE reference analysis of a declaration', () => {
  it('lists the free symbols of an initial value in the attributes dictionary', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      [
        'Declare',
        'y',
        ['Dictionary', ['KeyValuePair', { str: 'value' }, ['Add', 'x', 1]]],
      ],
      ['Multiply', 'y', 2],
    ]);
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_.x');
    expect(r.freeSymbols).toEqual(['x']);
  });

  // A `Declare` at the top level of a block makes a local of the block,
  // which the generated code declares too: it is not free (`v` below).
  it('does not list a local that a Declare makes as a free symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    for (const to of ['javascript', 'glsl'] as const) {
      expect(
        compile(
          ce.box([
            'Block',
            ['Declare', 'v', "'unknown'", 2],
            ['Multiply', 'v', 'x'],
          ]),
          { to }
        ).freeSymbols
      ).toEqual(['x']);
      // `u` is bound outside the expression: a write of `u` is a write of
      // the input, which stays free.
      expect(
        compile(
          ce.box([
            'Block',
            ['Declare', 'v', "'unknown'", 2],
            ['Assign', 'u', ['Add', 'u', 'v']],
          ]),
          { to }
        ).freeSymbols
      ).toEqual(['u']);
    }
  });

  // The target of an assignment in a block that is a loop body is a local of
  // the body, which the generated code declares: it was listed as free
  // (`w` below, not declared). A chained assignment `t := w := t + i` is
  // the static error `assignment-in-operand`, so the body writes `w` and
  // `t` in two statements. An assignment writes a variable that is in
  // scope, so the body declares `w` and the enclosing block declares `t`.
  it('does not list the inner target of a chained assignment as a free symbol', () => {
    const range = ['Element', 'i', ['Range', 1, 3]];
    const chained = [
      'Block',
      ['Declare', 'w', "'unknown'", ['Add', 't', 'i']],
      ['Assign', 't', 'w'],
    ];
    for (const to of ['javascript', 'glsl'] as const) {
      {
        const ce = new ComputeEngine();
        expect(
          compile(
            ce.box([
              'Block',
              ['Declare', 't', "'unknown'", 0],
              ['Loop', chained, range],
              't',
            ]),
            { to }
          ).freeSymbols
        ).toEqual([]);
      }
      // A read of `w` after the loop reads the input `w`.
      const ce = new ComputeEngine();
      expect(
        compile(
          ce.box([
            'Block',
            ['Declare', 't', "'unknown'", 0],
            ['Loop', chained, range],
            ['Add', 't', 'w'],
          ]),
          { to }
        ).freeSymbols
      ).toEqual(['w']);
    }
  });
});

// A function that the code calls by name (a user function of the engine)
// is emitted once, outside every binder of the expression, so its body
// reads the engine's symbols and not a local, a parameter or an index that
// has the same name at the call. `ok` reads the engine symbol `minR`
// (Tycho row 507).
describe('COMPILE reference analysis of a function called inside a binder of one of its free names', () => {
  const engine = (declared: boolean): ComputeEngine => {
    const ce = new ComputeEngine();
    if (declared) ce.declare('minR', 'real');
    executeEpsil(ce, 'function ok(c) { 1 / c >= minR }');
    return ce;
  };
  const inBlock = [
    'Block',
    ['Declare', 'minR', { dict: { value: 0.008 } }],
    ['ok', 4],
  ];

  it('the compiled function reads the input, not the local', () => {
    const r = compile(engine(true).box(inBlock as never), { to: 'javascript' });
    // 1/4 >= 0.1, and not 1/4 >= 0.5: the local value 0.008 is not read.
    expect(r.run!({ minR: 0.1 } as never)).toBe(true);
    expect(r.run!({ minR: 0.5 } as never)).toBe(false);
  });

  it('declines an untyped name as the bare call does', () => {
    const ce = engine(false);
    const bare = compile(ce.box(['ok', 4]), { to: 'javascript' });
    const block = compile(ce.box(inBlock as never), { to: 'javascript' });
    expect(bare.success).toBe(false);
    expect(bare.diagnostic?.code).toBe('untyped-input');
    expect(bare.unsupported).toContain('minR');
    // Inside the block, `minR` is a local that the body of `ok` does not
    // read: the call declines before the input is typed.
    expect(block.success).toBe(false);
    expect(block.diagnostic?.code).toBe('outside-profile');
  });
});

// A compilation that produced code lowered every operator, so its
// `unsupported` list is empty. The static walk named the definition and the
// name of a function that a statement list defines, which the JavaScript
// targets compile as a local function (Tycho row 508).
describe('COMPILE: `unsupported` of a program that defines a function', () => {
  const program = (
    source: string,
    to: 'javascript' | 'interval-js' | 'glsl'
  ) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const [ast] = parseEpsil(source);
    return compile(ce.box(resolveLibraryNames(ast as never, source, ce)), {
      to,
    });
  };

  // A name that the program binds is not an operator of the target. A host
  // reads a name of the list that has no definition as an unknown symbol.
  it('does not report the local function when the program declines for another operator', () => {
    const r = program('function f(t) { t + 1 }\nf(x) + Foo(x)', 'javascript');
    expect(r.success).toBe(false);
    expect(r.unsupported).not.toContain('f');
  });

  // A decline of the interval target does not go through the interpreter
  // fallback when `fallback` is false: it throws, and its diagnostic names
  // the operator.
  it('names the operator of a compilation that declined without a fallback', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    let diagnostic: unknown;
    try {
      compile(ce.box(['GammaRegularized', 'x', 2]), {
        to: 'interval-js',
        fallback: false,
      });
    } catch (e) {
      diagnostic = compileDiagnosticOf(e);
    }
    expect(diagnostic).toMatchObject({
      code: 'outside-profile',
      operator: 'GammaRegularized',
    });
  });

  it('still reports a definition that the target declines', () => {
    // A shader target does not bind a function as a value.
    const shader = program('function f(t) { t + 1 }\nf(x)', 'glsl');
    expect(shader.success).toBe(false);
    expect(shader.unsupported).toEqual(['DefineFunction']);
    // The last statement of a block gives the value of the block, and a
    // definition has no value.
    const last = program('let a = x\nfunction f(t) { t + 1 }', 'javascript');
    expect(last.success).toBe(false);
    expect(last.unsupported).toEqual(['DefineFunction']);
  });
});
