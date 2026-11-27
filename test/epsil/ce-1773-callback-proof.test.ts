import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// CE-1773: a lambda passed to a function that keeps it is not PROOF that the
// function that creates it writes (`docs/EFFECTS-MODEL.md`, "Scope is
// opt-in", "Proof through a function that takes a callback"). A notebook
// event handler or timer callback that writes a cell variable can then be
// created inside a plain `function`. The effects of the callback still join
// the effects of the function: only the refusal of a function with no
// `scope` declaration changes.
//

const REFUSED = 'writes outside a function require a declared `scope` effect';

/** A fresh engine with host functions declared as a host declares them
 * today: `keep`, `figureOn` state their effects and say nothing of
 * `invokes`; `figureTimer` and `figureDraw` are `pure: false`; `store`
 * states `invokes: false`. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  const host = (flags: object, value: string) => ({
    signature: '(any) -> any',
    ...flags,
    evaluate: (_ops: unknown, { engine }: { engine: ComputeEngine }) =>
      engine.string(value),
  });
  ce.declare('store', host({ effects: ['state'], invokes: false }, 's') as any);
  ce.declare('keep', host({ effects: ['state'] }, 'kept') as any);
  ce.declare('figureOn', host({ effects: ['state'] }, 'click:1') as any);
  ce.declare('figureTimer', host({ pure: false }, 'h1') as any);
  ce.declare('figureDraw', host({ pure: false }, 'drawn') as any);
  return ce;
}

const PRELUDE = `protocol Drawable {
  function on(self: Self, name: string, handler: any) -> Self
}
type Fig = tuple<kind: string, handlers: string | nothing> is Drawable {
  function on(self: Fig, name: string, handler: any) -> Fig {
    Fig(self.kind, figureOn([self.handlers, name, handler]))
  }
}
function circ() -> Fig { Fig("circle", nothing) }
function timer(...args) -> string { figureTimer(listFrom(args)) }
function draw(...args) -> nothing { figureDraw(listFrom(args)) }
`;

/** The first error of a run of `source`, or its value. */
function run(
  source: string,
  ce = engine()
): { error?: string; value?: string } {
  const r = executeEpsil(ce, source);
  const err = r.diagnostics.find((d) => d.severity === 'error');
  return err !== undefined
    ? { error: String(err.message) }
    : { value: r.value.toString() };
}

/** The effects of the function `name`, after a run of `source`. */
function effectsAfter(source: string, name: string): unknown {
  const ce = engine();
  const r = run(source, ce);
  if (r.error !== undefined) return r;
  const def = ce.lookupDefinition(name);
  return def !== undefined && 'operator' in def ? def.operator.effects : def;
}

describe('CE-1773: a callback that the function keeps is not a proven write', () => {
  test('through a function with a rest parameter (`timer`)', () => {
    expect(
      run(`${PRELUDE}let r = 1
function scene() { timer(16, t => do { r = r + 1; draw(circ()) }) }
[scene(), r]`)
    ).toEqual({ value: '["h1",1]' });
  });

  test('through a protocol method (`.on`)', () => {
    expect(
      run(`${PRELUDE}let r = 1
function scene() { circ().on("click", e => do { r = r + 1; draw(circ()) }) }
[scene(), r]`)
    ).toEqual({ value: '[Fig("circle", "click:1"),1]' });
  });

  test('through two functions', () => {
    expect(
      run(`let r = 1
function inner(g) { keep([g]) }
function outer(h) { inner(h) }
function scene() { outer(e => do { r = r + 1 }) }
[scene(), r]`)
    ).toEqual({ value: '["kept",1]' });
  });

  test('through a helper that wraps the handler in another lambda', () => {
    expect(
      run(`${PRELUDE}let r = 1
function every(ms, h) { let tick = t => do { h(t); draw(circ()) }; timer(ms, tick) }
function scene() { every(16, t => do { r = r + 1 }) }
[scene(), r]`)
    ).toEqual({ value: '["h1",1]' });
  });

  test('through a function that a `let` holds', () => {
    expect(
      run(`let r = 1
let later = h => keep([h])
function scene() { later(e => do { r = r + 1 }) }
[scene(), r]`)
    ).toEqual({ value: '["kept",1]' });
  });

  test('through a function that is defined after its caller', () => {
    expect(
      run(`let r = 1
function scene() { later(e => do { r = r + 1 }) }
function later(h) { keep([h]) }
[scene(), r]`)
    ).toEqual({ value: '["kept",1]' });
  });

  test('a function with a local that has the name of its parameter', () => {
    expect(
      run(`let r = 1
function relay(cb) { do { let cb = x => x; cb(1) }; keep([cb]) }
function scene() { relay(e => do { r = r + 1 }) }
[scene(), r]`)
    ).toEqual({ value: '["kept",1]' });
  });

  test('a named callback that declares `scope`', () => {
    expect(
      run(`${PRELUDE}let r = 1
function step(t) scope { r = r + 1 }
function scene() { timer(16, step) }
[scene(), r]`)
    ).toEqual({ value: '["h1",1]' });
  });

  test('a host function declared `invokes: false`', () => {
    expect(
      run(`let r = 1
function scene() { store(e => do { r = r + 1 }) }
[scene(), r]`)
    ).toEqual({ value: '["s",1]' });
  });

  test('the effects of the callback still join the function', () => {
    expect(
      effectsAfter(
        `let r = 1
function later(h) { keep([h]) }
function scene() { later(e => do { r = r + 1 }) }`,
        'scene'
      )
    ).toEqual(['scope', 'state']);
  });
});

describe('CE-1773: a callback that the call visibly invokes is a proven write', () => {
  const refused = (source: string): void =>
    expect(run(source).error).toContain(REFUSED);

  test('a library operator that calls its callback', () => {
    refused(`let r = 1
function f() { map(x => do { r = r + x }, [1, 2]) }
f()`);
  });

  test('a host function that says nothing of `invokes`', () => {
    refused(`let r = 1
function f() { keep(e => do { r = r + 1 }) }
f()`);
  });

  test('a function that calls its parameter', () => {
    refused(`let r = 1
function callIt(g) { g(1) }
function f() { callIt(x => do { r = r + x }) }
f()`);
  });

  test('a function that passes its parameter to `map`', () => {
    refused(`let r = 1
function each(g, xs) { map(g, xs) }
function f() { each(x => do { r = r + x }, [1, 2]) }
f()`);
  });

  test('a function that calls its parameter in a lambda given to `map`', () => {
    refused(`let r = 1
function each(g, xs) { map(x => g(x), xs) }
function f() { each(x => do { r = r + x }, [1, 2]) }
f()`);
  });

  test('a function that calls its parameter in a branch', () => {
    refused(`let r = 1
function maybe(c, g) { if c { g(1) } else { 0 } }
function f() { maybe(true, x => do { r = r + x }) }
f()`);
  });

  test('through two functions, the second calls it', () => {
    refused(`let r = 1
function inner(g) { g(1) }
function outer(h) { inner(h) }
function f() { outer(x => do { r = r + x }) }
f()`);
  });

  test('a spread argument before the callback', () => {
    refused(`let r = 1
function h(p, q) { keep([q]); p(1) }
function f(xs) { h(...xs, x => do { r = r + x }) }
f([])`);
  });

  test('a local function that calls its parameter', () => {
    refused(`let r = 1
function f() { let callIt = g => g(1); callIt(x => do { r = r + x }) }
f()`);
  });

  test('a function that passes its parameter to a local function of a nested block', () => {
    refused(`let r = 1
function relay(cb) { do { let store = h => h(1); store(cb) } }
function f() { relay(x => do { r = r + x }) }
f()`);
  });

  test('a function that calls its parameter, defined after its caller', () => {
    refused(`let r = 1
function f() { callIt(x => do { r = r + x }) }
function callIt(g) { g(1) }
f()`);
  });

  test('a function that applies a lambda to its parameter where it is written', () => {
    refused(`let r = 1
function relay(cb) { (h => h(1))(cb) }
function f() { relay(x => do { r = r + x }) }
f()`);
  });

  test('a protocol member with one conformer that calls the handler', () => {
    refused(`${PRELUDE}type Eager = tuple<kind: string> is Drawable {
  function on(self: Eager, name: string, handler: any) -> Eager {
    handler(name)
    self
  }
}
let r = 1
function scene() { circ().on("click", e => do { r = r + 1 }) }
scene()`);
  });

  test('a named `scope` callback, given to a function that calls it', () => {
    refused(`let r = 1
function step(t) scope { r = r + 1 }
function callIt(g) { g(1) }
function f() { callIt(step) }
f()`);
  });

  test('the function writes after it registered a callback that writes', () => {
    refused(`${PRELUDE}let r = 1
function bump() scope { r = r + 1 }
function f() { timer(16, t => bump()); bump() }
f()`);
  });
});

describe('CE-1773: a call that the text of the body does not show', () => {
  // The scan follows no value: these functions are accepted with no `scope`
  // declaration, and their effects still say that they can write.
  test('a parameter that is called through a local', () => {
    expect(
      effectsAfter(
        `let r = 1
function alias(g) { let h = g; h(1) }
function f() { alias(x => do { r = r + x }) }`,
        'f'
      )
    ).toEqual('any');
  });

  test('a function held by a `let`, which has no value when its caller is defined', () => {
    expect(
      effectsAfter(
        `let r = 1
let callIt = g => g(1)
function f() { callIt(x => do { r = r + x }) }`,
        'f'
      )
    ).toEqual(['scope']);
  });

  test('a parameter as the function that receives the callback', () => {
    expect(
      effectsAfter(
        `let r = 1
function f(h) { h(x => do { r = r + x }) }`,
        'f'
      )
    ).toEqual(['scope']);
  });

  test('a call reached only around a cycle of two functions, in either order', () => {
    // `i` calls `b`; `a` reaches `b` only through `j` and back.
    const cycle = `let r = 1
function i(a, b, n) { if n > 0 { b(1); j(a, b, n - 1) } else { 0 } }
function j(c, d, n) { i(d, c, n) }
`;
    const f = `function f() { i(x => do { r = r + x }, x => x, 2) }`;
    const first = effectsAfter(`${cycle}${f}`, 'f');
    const second = effectsAfter(
      `${cycle}function g() { j(x => x, x => x, 2) }
${f}`,
      'f'
    );
    expect(first).toEqual(['scope']);
    expect(second).toEqual(first);
    expect(effectsAfter(`${cycle}${f.replace('f()', 'f() scope')}`, 'f')).toEqual(
      first
    );
  });

  test('a parameter that the function returns, called by the caller', () => {
    expect(
      effectsAfter(
        `let r = 1
function same(g) { g }
function f() { let k = same(x => do { r = r + x }); k(1) }`,
        'f'
      )
    ).toEqual('any');
  });
});
