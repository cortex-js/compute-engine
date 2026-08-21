import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { inferSourcePurity } from '../../src/compute-engine/compilation/function-purity';

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
