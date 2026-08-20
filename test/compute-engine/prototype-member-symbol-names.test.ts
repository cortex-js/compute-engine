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
});
