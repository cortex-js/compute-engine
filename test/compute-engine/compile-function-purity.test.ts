import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { inferSourcePurity } from '../../src/compute-engine/compilation/function-purity';
import { isCseAdmissible } from '../../src/compute-engine/compilation/cse';

/**
 * A caller-supplied `functions` entry normally suppresses the NaN exit a
 * compiled `Sum`/`Product` carries between its terms: the spliced source may
 * count its own calls or mutate shared state, so running it fewer times would
 * change behavior. An entry established to be PURE — declared by the caller,
 * or inferred from its source — keeps the exit, because the sum's value is
 * already settled once the accumulator is NaN and the only thing the
 * suppression preserved was the function's side effects.
 */

/** The number of NaN exits in a compiled unit's source. */
function exitCount(code: string): number {
  return [...code.matchAll(/!== _tv\d+\) return NaN/g)].length;
}

/** Compile `\sum_{n=1}^{31} sq(n·x)` with `sq` supplied as `entry`. */
function compileSum(entry: unknown, upper = 31) {
  const ce = new ComputeEngine();
  ce.declare('sq', '(number) -> number');
  const expr = ce.parse(`\\sum_{n=1}^{${upper}}\\operatorname{sq}(nx)`);
  return compile(expr, { functions: { sq: entry } } as any) as any;
}

const PURE_SOURCE = '((t)=>t*t+1)';
/** A bare name referring to something the caller will supply in its preamble.
 * There is no body to analyse, so it can only be believed, never inferred. */
const OPAQUE_SOURCE = 'mySplineFromImports';

describe('inferSourcePurity', () => {
  test.each([
    ['((t) => t * t)', true],
    ['(t) => t*t + 1', true],
    ['t => Math.sin(t)', true],
    ['(a, b) => Math.pow(a, b) / (a + 1)', true],
    ['(t) => { return t * 2; }', true],
    ['function sq(t) { return t * t; }', true],
    ['function (t) { return Math.abs(t); }', true],
    ['(t) => t > 0 ? Math.sqrt(t) : NaN', true],
    ['(t) => Math.PI * t', true],
    ['(x) => 1.5e3 * x', true],
    ['(t) => /* doubles */ t * 2', true],
    ['(t) => -t', true],
    ['() => 0', true],
    ['(a,b)=>a%b', true],
    ['(t)=>t**2', true],
    ['(t) => Math.max(t, 0)', true],
  ])('accepts %p', (src, expected) => {
    expect(inferSourcePurity(src as string)).toBe(expected);
  });

  test.each([
    // Writes and reads that can observe or mutate state.
    ['(t) => { count++; return t; }', false],
    ['(t) => { log.push(t); return t; }', false],
    ['(t) => ctx.fillRect(0,0,t,t)', false],
    ['(t) => obj.value + t', false],
    // A closure over an outer binding: `scale` is not a parameter, so the
    // value can change between calls even though nothing here writes.
    ['(t) => t * scale', false],
    // `Math.random` is the one member of `Math` that is not a function of its
    // arguments.
    ['(t) => Math.random() * t', false],
    ['function () { return Math.random(); }', false],
    // Shapes the analysis deliberately does not model.
    ['(t) => [t, t]', false],
    ['(t) => ({v: t})', false],
    ['(t) => "a" + t', false],
    ['(t) => `x${t}`', false],
    ['(t) => new Thing(t)', false],
    ['(t) => this.x + t', false],
    ['(t) => (u => u*t)(2)', false],
    ['function f(t) { let u = t; return u; }', false],
    ['(t)=>{ return t; return 1; }', false],
    ['(t) => t.valueOf()', false],
    // Parameter lists that can run code at call time.
    ['(t = 1) => t', false],
    ['(...t) => t', false],
    ['({a}) => a', false],
    // A call through a parameter: its run-time value is whatever the caller
    // passed, so it may draw, log or count.
    ['(f) => f()', false],
    ['(f, x) => f(x)', false],
    ['(eval) => eval(1)', false],
    // `Math` is an ordinary mutable object, so a member outside the allowlist
    // may be anything a page attached to it.
    ['(t) => Math.audit(t)', false],
    // Not a function shape at all — a bare name the caller will define.
    ['Math.sin', false],
    ['mySplineFromImports', false],
  ])('rejects %p', (src, expected) => {
    expect(inferSourcePurity(src as string)).toBe(expected);
  });

  test('a native or bound function reads as [native code] and is rejected', () => {
    expect(inferSourcePurity(Math.sin.toString())).toBe(false);
    expect(inferSourcePurity(((t: number) => t * 2).bind(null).toString())).toBe(
      false
    );
  });
});

describe('a pure `functions` entry keeps the unrolled NaN exit', () => {
  test('an inferably pure source restores the exit', () => {
    const r = compileSum(PURE_SOURCE);
    expect(r.success).toBe(true);
    expect(exitCount(r.code)).toBe(30);
  });

  test('a source with no analysable body stays conservative', () => {
    const r = compileSum(OPAQUE_SOURCE);
    expect(r.success).toBe(true);
    expect(exitCount(r.code)).toBe(0);
  });

  test('`pure: true` is believed for a source that cannot be analysed', () => {
    const r = compileSum({ source: OPAQUE_SOURCE, pure: true });
    expect(r.success).toBe(true);
    expect(exitCount(r.code)).toBe(30);
  });

  test('`pure: false` pins the conservative behavior on an analysable source', () => {
    const r = compileSum({ source: PURE_SOURCE, pure: false });
    expect(r.success).toBe(true);
    expect(exitCount(r.code)).toBe(0);
  });

  test('a JavaScript function value is analysed like its source text', () => {
    const pure = compileSum((t: number) => t * t + 1);
    expect(exitCount(pure.code)).toBe(30);
  });

  test('the scalar loop arm gains the exit under the same gate', () => {
    const withExit = compileSum(PURE_SOURCE, 500);
    const without = compileSum(OPAQUE_SOURCE, 500);
    expect(withExit.code).toMatch(/while \(/);
    expect(without.code).toMatch(/while \(/);
    expect(exitCount(withExit.code)).toBe(1);
    expect(exitCount(without.code)).toBe(0);
  });
});

describe('values are unchanged by the purity declaration', () => {
  const expected = Array.from(
    { length: 31 },
    (_, i) => ((i + 1) * 2) ** 2 + 1
  ).reduce((a, b) => a + b, 0);

  test.each([
    ['inferred pure', PURE_SOURCE],
    ['declared impure', { source: PURE_SOURCE, pure: false }],
  ])('%s computes the same sum', (_label, entry) => {
    const r = compileSum(entry);
    expect(r.run({ x: 2 })).toBe(expected);
  });

  test('a NaN argument answers NaN whether or not the exit is emitted', () => {
    expect(compileSum(PURE_SOURCE).run({ x: NaN })).toBeNaN();
    expect(
      compileSum({ source: PURE_SOURCE, pure: false }).run({ x: NaN })
    ).toBeNaN();
  });
});

describe('the descriptor form reaches every target that takes `functions`', () => {
  // The option validator accepts the descriptor for all targets, so a target
  // that reads the entry as `string | Function` would silently discard the
  // caller's implementation and fall back to its built-in table.
  test.each(['javascript', 'glsl', 'interval-js'])(
    'the %s target uses a descriptor\'s source',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('sq', '(number) -> number');
      const expr = ce.parse('\\operatorname{sq}(x)');
      const bare = compile(expr, { to, functions: { sq: 'mySq' } } as any) as any;
      const descriptor = compile(expr, {
        to,
        functions: { sq: { source: 'mySq', pure: true } },
      } as any) as any;
      expect(descriptor.success).toBe(bare.success);
      expect(descriptor.code).toBe(bare.code);
    }
  );
});

describe('the descriptor form is validated', () => {
  test('a non-boolean `pure` is rejected', () => {
    expect(() => compileSum({ source: PURE_SOURCE, pure: 'yes' })).toThrow(
      /functions\.sq\.pure/
    );
  });

  test('a descriptor whose `source` is neither string nor function is rejected', () => {
    expect(() => compileSum({ source: 42, pure: true })).toThrow(
      /functions\.sq\.source/
    );
  });

  test('a record that is not a descriptor is still rejected', () => {
    expect(() => compileSum({ impl: PURE_SOURCE })).toThrow(/functions\.sq/);
  });
});

/**
 * The skippability rule, stated once: an emission may be skipped when nothing
 * in it has observable effects. Three oracles answer that — a `functions`
 * entry through `entryIsPure`, an operator carrying a caller `compile` handler
 * through the `pure`/`effects` on its definition, everything else through
 * `node.isPure` — and a spelling with no oracle is refused.
 */
describe('the NaN exit is gated on effects, not on provenance', () => {
  /** `\sum_{n=1}^{31} body`, compiled with `opts`. */
  function exitsFor(build: (ce: ComputeEngine) => any, opts: any = {}): number {
    const ce = new ComputeEngine();
    const r = compile(build(ce), opts) as any;
    expect(r.success).toBe(true);
    return exitCount(r.code);
  }

  test('a pure body keeps every exit', () => {
    expect(
      exitsFor((ce) => ce.parse('\\sum_{n=1}^{31}\\sin(nx)'))
    ).toBe(30);
  });

  test('a built-in IMPURE operator in the body refuses the exit', () => {
    // `Random` is declared impure. Skipping terms draws from the generator
    // fewer times, which a later draw observes — even though the sum's own
    // value is already NaN by then. Provenance cannot see this: `Random` is
    // the engine's own operator, not caller-supplied.
    expect(
      exitsFor((ce) =>
        ce.parse('\\sum_{n=1}^{31}(\\operatorname{Random}()+n)')
      )
    ).toBe(0);
  });

  test('a caller `compile` handler whose definition declares no effects keeps the exit', () => {
    expect(
      exitsFor((ce) => {
        ce.declare('R', 'list<number>');
        const d: any = ce.lookupDefinition('At');
        ce.declare('At', {
          ...(d?.operator ?? {}),
          compile: () => '_SYS.at(_.R, 1)',
        } as any);
        return ce.box(['Sum', ['At', 'R', 'k'], ['Limits', 'k', 1, 31]]);
      })
    ).toBe(30);
  });

  test('the same handler on a `pure: false` definition refuses the exit', () => {
    expect(
      exitsFor((ce) => {
        ce.declare('R', 'list<number>');
        const d: any = ce.lookupDefinition('At');
        ce.declare('At', {
          ...(d?.operator ?? {}),
          compile: () => '_SYS.at(_.R, 1)',
          pure: false,
        } as any);
        return ce.box(['Sum', ['At', 'R', 'k'], ['Limits', 'k', 1, 31]]);
      })
    ).toBe(0);
  });

  test('an `operators` entry has no purity oracle and refuses the exit', () => {
    // `[op, prec]` carries no body to analyse and no declaration slot, so
    // nothing can vouch for it. Refusing is the only safe answer.
    expect(
      exitsFor((ce) => ce.parse('\\sum_{n=1}^{31}(nx+1)'), {
        operators: { Add: ['myAdd', 11] },
      })
    ).toBe(0);
  });

  test('a pure-vouched head with an IMPURE operand still refuses', () => {
    // The oracle vouches for the HEAD; the operands are judged on their own.
    // Skipping the call skips them too, so an impure one anywhere below
    // refuses however pure the head is.
    expect(
      exitsFor(
        (ce) => {
          ce.declare('sq', '(number) -> number');
          return ce.parse(
            '\\sum_{n=1}^{31}\\operatorname{sq}(n\\operatorname{Random}())'
          );
        },
        { functions: { sq: PURE_SOURCE } }
      )
    ).toBe(0);
  });

  /**
   * The oracle's answer has to reach every node above the head it vouches
   * for. A name declared by signature only and implemented through
   * `functions` projects UNKNOWN effects onto each of its applications, so
   * `node.isPure` is `false` for the application, for every built-in
   * operator above it, and for the body of every user-defined callee that
   * applies it — and each of those used to refuse the exit while the bare
   * `sq(n·x)` kept it.
   */
  describe('a vouched head keeps the exit wherever it sits', () => {
    const withSq = { functions: { sq: PURE_SOURCE } };
    const declareSq = (ce: ComputeEngine) =>
      ce.declare('sq', '(number) -> number');
    const define = (ce: ComputeEngine, latex: string) =>
      ce.parse(latex).evaluate();

    test.each([
      ['beneath Add', '\\sum_{n=1}^{31}(\\operatorname{sq}(nx)+1)'],
      ['beneath Sin', '\\sum_{n=1}^{31}\\sin(\\operatorname{sq}(nx))'],
      ['beneath Multiply', '\\sum_{n=1}^{31}2\\operatorname{sq}(nx)'],
      [
        'beneath Add, in a Product',
        '\\prod_{n=1}^{31}(\\operatorname{sq}(nx)+1)',
      ],
    ])('%s', (_label, latex) => {
      expect(
        exitsFor((ce) => {
          declareSq(ce);
          return ce.parse(latex);
        }, withSq)
      ).toBe(30);
    });

    test('inside the body of a user-defined callee', () => {
      expect(
        exitsFor((ce) => {
          declareSq(ce);
          define(ce, '\\operatorname{wrap}(t) := \\operatorname{sq}(t) + 1');
          return ce.parse('\\sum_{n=1}^{31}\\operatorname{wrap}(nx)');
        }, withSq)
      ).toBe(30);
    });

    test('as the whole body of a user-defined callee', () => {
      expect(
        exitsFor((ce) => {
          declareSq(ce);
          define(ce, '\\operatorname{wrap}(t) := \\operatorname{sq}(t)');
          return ce.parse('\\sum_{n=1}^{31}\\operatorname{wrap}(nx)');
        }, withSq)
      ).toBe(30);
    });

    test('two callee levels down', () => {
      expect(
        exitsFor((ce) => {
          declareSq(ce);
          define(ce, '\\operatorname{wrap}(t) := \\operatorname{sq}(t) + 1');
          define(ce, '\\operatorname{outer}(t) := 2\\operatorname{wrap}(t)');
          return ce.parse('\\sum_{n=1}^{31}\\operatorname{outer}(nx)');
        }, withSq)
      ).toBe(30);
    });

    // The oracle vouches for the HEAD only; everything else in the body is
    // still judged on its own, exactly as at a direct call site.
    test('an IMPURE entry refuses through the callee body', () => {
      expect(
        exitsFor(
          (ce) => {
            declareSq(ce);
            define(ce, '\\operatorname{wrap}(t) := \\operatorname{sq}(t) + 1');
            return ce.parse('\\sum_{n=1}^{31}\\operatorname{wrap}(nx)');
          },
          { functions: { sq: '((t) => { count++; return t; })' } }
        )
      ).toBe(0);
    });

    test('an impure built-in beside the vouched head refuses', () => {
      expect(
        exitsFor((ce) => {
          declareSq(ce);
          define(
            ce,
            '\\operatorname{wrap}(t) := \\operatorname{sq}(t) + \\operatorname{Random}()'
          );
          return ce.parse('\\sum_{n=1}^{31}\\operatorname{wrap}(nx)');
        }, withSq)
      ).toBe(0);
    });

    test('a second head with no purity oracle refuses', () => {
      expect(
        exitsFor(
          (ce) => {
            declareSq(ce);
            ce.declare('other', '(number) -> number');
            define(
              ce,
              '\\operatorname{wrap}(t) := \\operatorname{sq}(t) + \\operatorname{other}(t)'
            );
            return ce.parse('\\sum_{n=1}^{31}\\operatorname{wrap}(nx)');
          },
          { functions: { sq: PURE_SOURCE, other: OPAQUE_SOURCE } }
        )
      ).toBe(0);
    });

    test('a forcing position over a bound quote is not read as the bare symbol', () => {
      // `effectsOf` resolves `h` and strips the quote to find the draw; a
      // walk over the syntax alone would see only the pure symbol `h`. The
      // gate refuses the release node rather than re-derive that step.
      // Asked of the gate directly: the JavaScript target has no lowering
      // for `ReleaseHold`, so a compiled probe would fail closed for the
      // wrong reason.
      const ce = new ComputeEngine();
      ce.assign('h', ce.box(['Hold', ['Random']]));
      const node = ce.box(['ReleaseHold', 'h']);
      expect(node.isPure).toBe(false);
      expect(isCseAdmissible(node, { skippabilityQuery: true })).toBe(false);
    });

    test('an impure operand beneath a built-in above the vouched head refuses', () => {
      expect(
        exitsFor((ce) => {
          declareSq(ce);
          return ce.parse(
            '\\sum_{n=1}^{31}(\\operatorname{sq}(n\\operatorname{Random}())+1)'
          );
        }, withSq)
      ).toBe(0);
    });
  });

  test('purity is read from the ACTIVE definition, not the one the node bound', () => {
    // Two definitions can be in play: the one bound when the expression was
    // boxed, and the one the scope chain answers with at compile time.
    // Emission uses the latter. Boxing BEFORE an impure handler is installed
    // must not let the stale definition's default `pure: true` bless it.
    const build = (boxFirst: boolean, pure: boolean) => {
      const ce = new ComputeEngine();
      ce.declare('R', 'list<number>');
      const mk = () =>
        ce.box(['Sum', ['At', 'R', 'k'], ['Limits', 'k', 1, 31]]);
      const early = boxFirst ? mk() : undefined;
      const d: any = ce.lookupDefinition('At');
      ce.declare('At', {
        ...(d?.operator ?? {}),
        compile: () => '_SYS.at(_.R, 1)',
        pure,
      } as any);
      const r = compile(early ?? mk()) as any;
      return exitCount(r.code);
    };
    expect(build(true, false)).toBe(0); // boxed first, then shadowed impure
    expect(build(false, false)).toBe(0); // shadowed first
    expect(build(true, true)).toBe(30); // pure either way
    expect(build(false, true)).toBe(30);
  });

  test('a signature-only declaration is not vetoed by its own `isPure`', () => {
    // `ce.declare('sq', '(number) -> number')` reports `isPure === false` for
    // its applications — there is no body to derive purity from. When the
    // implementation arrives through `functions`, that entry's oracle is the
    // one that governs, not the placeholder declaration's.
    const ce = new ComputeEngine();
    ce.declare('sq', '(number) -> number');
    expect(ce.parse('\\operatorname{sq}(x)').isPure).toBe(false);
    expect(
      exitsFor(
        (e) => {
          e.declare('sq', '(number) -> number');
          return e.parse('\\sum_{n=1}^{31}\\operatorname{sq}(nx)');
        },
        { functions: { sq: PURE_SOURCE } }
      )
    ).toBe(30);
  });
});
