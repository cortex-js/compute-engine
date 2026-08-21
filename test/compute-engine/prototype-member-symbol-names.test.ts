import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A MathJSON symbol name is an arbitrary string, but the engine and the
 * compile targets look names up in plain-object tables. A plain object
 * literal inherits `Object.prototype`, so a name matching an inherited member
 * (`toString`, `constructor`, `valueOf`, …) read that member off the
 * prototype chain instead of missing — and because the inherited value is a
 * truthy function, each caller treated it as a real entry.
 *
 * Three independent leaks, all fixed by keying only on OWN properties:
 *
 * 1. `createSymbolExpression`'s common-symbol table returned the inherited
 *    function AS the boxed expression: `ce.box('toString')` handed back
 *    `Object.prototype.toString` itself and `ce.box('constructor')` handed
 *    back `Object` — raw JS internals escaping through a public API.
 * 2. The ASCII-math serializer's symbol/function tables did the same, so
 *    `ce.box('toString').toString()` rendered as `function toString() {
 *    [native code] }`.
 * 3. The compile targets' operator/function tables did the same, so
 *    `Add(toString, 1)` was refused as a "built-in operator with no fixed
 *    arity" instead of compiling `toString` as an ordinary free symbol.
 *
 * Two more of the same shape, found 2026-08-20:
 *
 * 4. The LaTeX parser's scope chain tested `id in table.ids`, so a name it
 *    had never declared resolved to the inherited FUNCTION as if it were the
 *    symbol's type — and the caller dereferenced `.type.matches(…)` on it, so
 *    `ce.parse('\\mathrm{toString} + 1')` THREW a `TypeError`. The tables are
 *    now prototype-free (`newSymbolIds`, `latex-syntax/types.ts`).
 * 5. Compiled JavaScript read a free symbol as `_.<id>` off the caller's vars
 *    object. That object is an ordinary one, so a MISSING `toString` read the
 *    inherited function: `toString + 1` returned the string
 *    "function toString() { [native code] }1" where every other missing
 *    symbol yields `NaN`. Colliding names now emit an own-property guard
 *    (`varsObjectAccess`), and a caller-supplied `vars` map is consulted with
 *    `Object.hasOwn` rather than `in`.
 * 6. The UNIT tables (`numerics/unit-data.ts`, `dictionary/definitions-units.ts`)
 *    were plain objects, and `resolveUnit` tests its lookup for TRUTHINESS:
 *    `UNIT_TABLE['__proto__']` is `Object.prototype`, so `\\mathrm{__proto__}`
 *    resolved as a known unit. `\\sum_{\\mathrm{__proto__}=1}^{3}` then lost
 *    its index — the body parsed as a unit expression and the index became
 *    `Nothing`, so the sum silently answered `3 * __proto__`.
 */
describe('a symbol named after an Object.prototype member', () => {
  const NAMES = [
    'toString',
    'constructor',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    '__proto__',
    '__defineGetter__',
    'propertyIsEnumerable',
  ];

  for (const name of NAMES) {
    describe(name, () => {
      it('boxes to a symbol, not to a JavaScript value', () => {
        const ce = new ComputeEngine();
        const boxed = ce.box(name);
        // The decisive check: before the fix this was the inherited function
        // itself, so `typeof` was 'function' rather than 'object'.
        expect(typeof boxed).toBe('object');
        expect(boxed.symbol).toBe(name);
      });

      it('serializes as its own name', () => {
        const ce = new ComputeEngine();
        // Rendering went through the ASCII-math symbol table; an inherited hit
        // printed the function's source instead of the name.
        expect(ce.box(name).toString()).not.toContain('native code');
        expect(ce.symbol(name).symbol).toBe(name);
      });

      it('holds a value like any other symbol', () => {
        const ce = new ComputeEngine();
        ce.assign(name, 7);
        expect(ce.box(name).evaluate().toString()).toBe('7');
      });

      it('compiles as an ordinary free symbol', () => {
        const ce = new ComputeEngine();
        const result = compile(
          ce.function('Add', [ce.symbol(name), ce.number(1)])
        );
        expect(result.success).toBe(true);
        expect(result.freeSymbols).toEqual([name]);
      });

      // A name is dangerous as a function HEAD as well as an operand, and the
      // head route reaches tables the operand route never touches: the
      // ASCII-math OPERATORS table and the shader targets' merged function
      // table. Both were missed by an operand-only test — the serializer
      // array-destructured the inherited function and rendered the resulting
      // `function is not iterable` message AS the expression's text.
      it('serializes as a function head', () => {
        const ce = new ComputeEngine();
        const rendered = ce.function(name, [ce.number(1)]).toString();
        expect(rendered).not.toContain('not iterable');
        expect(rendered).not.toContain('native code');
        expect(rendered).toContain(name);
      });

      it('parses without throwing, as an ordinary symbol', () => {
        const ce = new ComputeEngine();
        // The parser's scope chain answered `true` for a name it never
        // declared and handed back the inherited function as the symbol's
        // TYPE; the caller then read `.type.matches(…)` off it and threw.
        const parsed = ce.parse(`\\mathrm{${name}} + 1`);
        expect(parsed.toString()).not.toContain('native code');
        expect(parsed.toString()).toContain(name);
        // …and a parser-local binding of that name still resolves. `\mathrm`
        // on both sides: a bare multi-letter name is a PRODUCT of letters in
        // LaTeX, which has nothing to do with this hazard.
        const sum = ce.parse(
          `\\sum_{\\mathrm{${name}}=1}^{3} \\mathrm{${name}}`
        );
        expect(sum.evaluate().toString()).toBe('6');
      });

      it('reads as MISSING, not as the inherited member, when unsupplied', () => {
        const ce = new ComputeEngine();
        const result = compile(
          ce.function('Add', [ce.symbol(name), ce.number(1)]),
          { fallback: false }
        );
        expect(result.success).toBe(true);
        const run = result.run as (args?: Record<string, unknown>) => unknown;
        // Supplied: an ordinary number.
        expect(run({ [name]: 5 })).toBe(6);
        // Absent: `NaN`, exactly like any other missing symbol — NOT the
        // string concatenation of an inherited function's source.
        const missing = run({});
        expect(typeof missing).not.toBe('string');
        expect(Number.isNaN(missing as number)).toBe(true);
      });

      it('compiles as a function head on every target', () => {
        for (const to of [
          'javascript',
          'python',
          'glsl',
          'wgsl',
          'interval-js',
        ] as const) {
          const ce = new ComputeEngine();
          // The head is undeclared, so the only correct outcomes are a clean
          // decline or a free-symbol compilation — never a crash, and never
          // treating the inherited member as a built-in the target defines.
          const run = () =>
            compile(ce.function(name, [ce.number(1)]), { to } as never);
          expect(run).not.toThrow();
          expect(run().unsupported ?? []).not.toContain('native code');
        }
      });
    });
  }

  // The guards must not cost the real entries their lookups: every table
  // involved still answers for the names it genuinely declares.
  it('leaves genuinely-declared names resolving', () => {
    const ce = new ComputeEngine();
    expect(ce.box('Pi').toString()).toBe('pi');
    expect(ce.box('PositiveInfinity').toString()).toBe('+oo');
    expect(ce.box('x').symbol).toBe('x');
    // An operator table entry (`Sin` -> `Math.sin`) and a constant one.
    const compiled = compile(ce.parse('\\sin(x)+1'));
    expect(compiled.success).toBe(true);
    expect(compiled.code).toBe('Math.sin(_.x) + 1');
    expect(compiled.freeSymbols).toEqual(['x']);
  });

  it('the interval target delivers a supplied `__proto__` variable', () => {
    // The interval target copies the caller's variables through
    // `processInput`. An ordinary `{}` cannot carry an own `__proto__` key —
    // the assignment invokes the inherited setter — so the value was dropped
    // in the copy and the compiled expression read it as unsupplied.
    const ce = new ComputeEngine();
    const compiled = compile(
      ce.function('Add', [ce.symbol('__proto__'), ce.number(1)]),
      { to: 'interval-js', fallback: false } as never
    );
    expect(compiled.success).toBe(true);
    const run = compiled.run as (args: Record<string, unknown>) => {
      kind: string;
      value?: { lo: number; hi: number };
    };
    // An own key (which is how a caller must spell it — an object LITERAL
    // `{__proto__: v}` sets the prototype instead).
    const args: Record<string, unknown> = Object.create(null);
    args['__proto__'] = { lo: 2, hi: 2 };
    expect(run(args).value).toEqual({ lo: 3, hi: 3 });
    // Genuinely unsupplied stays the interval top, not a stale inherited read.
    expect(run({}).kind).toBe('entire');
  });

  it('a caller `vars` map is read by own property, not by `in`', () => {
    const ce = new ComputeEngine();
    // `vars` does not declare `toString`, so the symbol must stay a runtime
    // input. Reading the map with `in` took the vars branch instead, with the
    // inherited function as the "value".
    const compiled = compile(
      ce.function('Add', [ce.symbol('toString'), ce.number(1)]),
      { fallback: false, vars: { other: '_.other' } } as never
    );
    expect(compiled.success).toBe(true);
    expect(compiled.code).not.toContain('undefined + 1');
    const run = compiled.run as (args?: Record<string, unknown>) => unknown;
    expect(run({ toString: 5 })).toBe(6);
    // A name the map DOES declare still takes the vars branch.
    const pinned = compile(ce.function('Add', [ce.symbol('other'), ce.number(1)]), {
      fallback: false,
      vars: { other: '_.other' },
    } as never);
    expect((pinned.run as (a: Record<string, unknown>) => unknown)({ other: 2 })).toBe(3);
  });
});
