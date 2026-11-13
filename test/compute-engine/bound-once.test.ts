import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';

// An expression resolves each name from the scope it was boxed in, for its
// type and for its value (`docs/plans/2026-11-11-bound-once-spec.md`,
// sections 2, 3 and 10). The current scope plays no part, and `ce.rebind()`
// binds an expression again in the current scope.

describe('an expression is bound once', () => {
  test('a free name does not read a declaration of a pushed scope', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('x+1');
    ce.pushScope();
    ce.declare('x', 'integer');
    ce.assign('x', 5);
    expect(e.type.toString()).toBe('number');
    expect(e.evaluate().toString()).toBe('x + 1');
    ce.popScope();
  });

  test('a declared name does not read a declaration of a pushed scope', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('x', 0.5);
    const e = ce.parse('x+1');
    ce.pushScope();
    ce.declare('x', 'integer');
    ce.assign('x', 5);
    expect(e.type.toString()).toBe('real');
    expect(e.evaluate().toString()).toBe('1.5');
    ce.popScope();
  });

  test('the type of a pushed declaration is not read either', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('x', 0.5);
    const e = ce.parse('2x');
    ce.pushScope();
    ce.declare('x', 'list<number>');
    ce.assign('x', ce.box(['List', 1, 2]));
    expect(e.type.toString()).toBe('real');
    expect(e.evaluate().toString()).toBe('1');
    ce.popScope();
  });

  test('ce.rebind() reads the pushed declaration', () => {
    const ce = new ComputeEngine();
    const free = ce.parse('x+1');
    ce.declare('y', 'real');
    ce.assign('y', 0.5);
    const declared = ce.parse('2y');
    ce.pushScope();
    ce.declare('x', 'integer');
    ce.assign('x', 5);
    ce.declare('y', 'list<number>');
    ce.assign('y', ce.box(['List', 1, 2]));
    const a = ce.rebind(free);
    expect(a.type.toString()).toBe('integer');
    expect(a.evaluate().toString()).toBe('6');
    const b = ce.rebind(declared);
    expect(b.type.toString()).toBe('list<number>');
    expect(b.evaluate().toString()).toBe('[2,4]');
    ce.popScope();
  });

  test('a declaration made later in the same scope is read', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('x+1');
    ce.declare('x', 'integer');
    ce.assign('x', 2);
    expect(e.type.toString()).toBe('integer');
    expect(e.evaluate().toString()).toBe('3');
  });

  test('a declaration in a pushed scope does not type an input of compile()', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('x < 2');
    ce.pushScope();
    ce.declare('x', 'real');
    expect(() => compile(e, { fallback: false } as any)).toThrow(/has no type/);
    ce.popScope();
  });

  test('a function body reads the scope it was written in', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 2);
    ce.parse('f := x \\mapsto a x').evaluate();
    ce.pushScope();
    ce.declare('a', 'integer');
    ce.assign('a', 10);
    expect(ce.parse('f(3)').evaluate().toString()).toBe('6');
    ce.popScope();
  });

  test('a library constant does not read a declaration of a pushed scope', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\pi + 1');
    ce.pushScope();
    ce.declare('Pi', 'integer');
    ce.assign('Pi', 3);
    expect(e.type.matches('real')).toBe(true);
    expect(e.type.matches('integer')).toBe(false);
    expect(e.N().re).toBeCloseTo(Math.PI + 1, 10);
    ce.popScope();
  });

  test('a popped scope keeps its definitions', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('x', 'integer');
    ce.assign('x', 5);
    const e = ce.parse('x+1');
    ce.popScope();
    expect(e.type.toString()).toBe('integer');
    expect(e.evaluate().toString()).toBe('6');
  });

  test('a later declaration in the home scope hides the definition read at boxing', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.pushScope();
    const e = ce.parse('x+1');
    expect(e.type.toString()).toBe('real');
    ce.declare('x', 'integer');
    expect(e.type.toString()).toBe('integer');
    ce.popScope();
  });

  test('a binder boxed at the top reads the names of the top', () => {
    const ce = new ComputeEngine();
    ce.assign('n', 2);
    const e = ce.box(['Sum', ['Multiply', 'n', 'k'], ['Limits', 'k', 1, 3]]);
    ce.pushScope();
    ce.declare('n', 'integer');
    ce.assign('n', 10);
    expect(e.evaluate().toString()).toBe('12');
    ce.popScope();
  });
});

// A binder with a variable operand built around a boxed operand binds the
// occurrences of its variables in that operand. A `Block` does not: a
// statement boxed outside the block keeps its names (`docs/plans/2026-11-11-bound-once-spec.md`, section 11). With `x: real = 5`.
describe('a binder and a boxed operand', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', { type: 'real', value: 5 });
    return ce;
  }
  const at3 = (ce: ComputeEngine, f: ReturnType<ComputeEngine['box']>) =>
    ce
      .function('Apply', [f, ce.number(3)])
      .evaluate()
      .toString();

  test('Function(ce.parse(x^2), x) applied to 3 is 9', () => {
    const ce = engine();
    const f = ce.function('Function', [ce.parse('x^2'), ce.symbol('x')]);
    expect(at3(ce, f)).toBe('9');
  });

  test('Function([Power, x, 2], x) applied to 3 is 9', () => {
    const ce = engine();
    expect(at3(ce, ce.box(['Function', ['Power', 'x', 2], 'x']))).toBe('9');
  });

  test('Sum(ce.parse(k^2), k = 1..3) is 14', () => {
    const ce = engine();
    const e = ce.function('Sum', [
      ce.parse('k^2'),
      ce.box(['Limits', 'k', 1, 3]),
    ]);
    expect(e.evaluate().toString()).toBe('14');
  });

  test('Sum([Power, k, 2], k = 1..3) is 14', () => {
    const ce = engine();
    const e = ce.box(['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 3]]);
    expect(e.evaluate().toString()).toBe('14');
  });

  test('Block(Declare(x, 7), ce.parse(x+1)) is 6', () => {
    const ce = engine();
    const e = ce.function('Block', [
      ce.box(['Declare', 'x', "'real'", 7]),
      ce.parse('x+1'),
    ]);
    expect(e.evaluate().toString()).toBe('6');
  });
});

// Every evaluation of a function literal, of a binder and of a block makes an
// activation, linked to the activation in which it was evaluated; a function
// value keeps the link of the activation that made it (`docs/plans/2026-11-11-bound-once-spec.md`, section 11).
describe.each([false, true])('activations, debug %s', (debug) => {
  function epsil(source: string): unknown {
    const ce = new ComputeEngine();
    ce._debugBindings = debug;
    const r = executeEpsil(ce, source);
    expect(r.diagnostics).toEqual([]);
    return r.value?.json;
  }

  test('each closure keeps the call that made it', () => {
    expect(
      epsil(
        'add(a) = (x) => x + a\nlet g = add(2)\nlet h = add(10)\n(g(1), h(1))'
      )
    ).toEqual(['Tuple', 3, 11]);
  });

  test('a closure does not read the parameter of its caller', () => {
    expect(
      epsil('add(a) = (x) => x + a\nlet g = add(2)\nkk(a) = g(1)\nkk(100)')
    ).toBe(3);
  });

  test('a recursive function', () => {
    expect(
      epsil(
        'function fact(n) { if n <= 1 { 1 } else { n * fact(n - 1) } }\nfact(5)'
      )
    ).toBe(120);
  });

  test('a loop writes the local of the enclosing block, also asynchronously and two at a time', async () => {
    const ce = new ComputeEngine();
    ce._debugBindings = debug;
    const block = ce.box([
      'Block',
      ['Declare', 's', "'unknown'", 0],
      [
        'Loop',
        ['Block', ['Assign', 's', ['Add', 's', 'i']]],
        ['Element', 'i', ['Range', 1, 4]],
      ],
      's',
    ]);
    expect(block.evaluate().json).toBe(10);
    expect((await block.evaluateAsync()).json).toBe(10);
    const both = await Promise.all([
      block.evaluateAsync(),
      block.evaluateAsync(),
    ]);
    expect(both.map((x) => x.json)).toEqual([10, 10]);
  });

  test('a lazy view passed to an inner call that returns a closure over it', () => {
    const ce = new ComputeEngine();
    ce._debugBindings = debug;
    const F = ['Function', ['Multiply', 'x', 'd'], 'x'];
    ce.assign('h2', ce.box(['Function', ['Function', ['ListFrom', 'v']], 'v']));
    ce.assign('gA', ce.box(['Function', ['h2', ['Map', F, 'xs']], 'd', 'xs']));
    ce.assign(
      'gC',
      ce.box(['Function', ['Apply', ['h2', ['Map', F, 'xs']]], 'd', 'xs'])
    );
    const closure = ce.box(['gA', 10, ['List', 1, 2]]).evaluate();
    expect(ce.function('Apply', [closure]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
    expect(ce.box(['gC', 10, ['List', 1, 2]]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
  });

  test('a bind parameter of a hold function', () => {
    expect(
      epsil(
        'hold mySum(body, bind i, n) = Sum(body, (i, 1, n)); mySum(k^2, k, 3)'
      )
    ).toBe(14);
    expect(
      epsil(
        'hold mySum(body, bind i, n) = Sum(body, (i, 1, n)); let k = 5; mySum(k^2, k, 3)'
      )
    ).toBe(14);
    expect(
      epsil(
        'hold mySum(body, bind i, n) = Sum(body, (i, 1, n)); let k = 5; mySum(k * j, j, 3)'
      )
    ).toBe(30);
  });

  test('a closure made in an iteration keeps the value of the index in that iteration', () => {
    expect(
      epsil(
        'let h = (x) => x\nfor d in [3, 6] { if d == 3 { h = (x => x + d) } }\nh(1)'
      )
    ).toBe(4);
    expect(
      epsil(
        'let fs = []\nfor d in [1, 2] { fs = [...fs, (x => x + d)] }\n[fs[1](1), fs[2](1)]'
      )
    ).toEqual(['List', 2, 3]);
  });

  test('a closure made in the last iteration of a loop of a call reads its own index', () => {
    expect(
      epsil(
        'let b = (n) => do { let h = (x) => x; for d in [n, 2n] { h = (x => x + d) }; h(1) }\nb(3)'
      )
    ).toBe(7);
    expect(
      epsil(
        'let b = (n) => do { let h = (xs) => xs; for d in [n, 2n] { h = (xs => ListFrom(Map(x => x * d, xs))) }; h }\nb(3)([1, 2])'
      )
    ).toEqual(['List', 6, 12]);
  });

  test('a function of a block called after the call by a closure made in a loop', () => {
    const ce = new ComputeEngine();
    ce._debugBindings = debug;
    ce.assign('g', ce.box(['Function', 'x', 'x']));
    const f = ce.box([
      'Function',
      [
        'Block',
        ['Declare', 'c', "'unknown'", ['Multiply', 5, 'n']],
        ['DefineFunction', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
        [
          'Loop',
          ['Assign', 'g', ['Function', ['h', 'x'], 'x']],
          ['Element', 'i', ['Range', 1, 2]],
        ],
      ],
      'n',
    ]);
    ce.function('Apply', [f, ce.number(1)]).evaluate();
    expect(ce.box(['g', 10]).evaluate().json).toBe(15);
  });

  test('a recursive function that returns a closure', () => {
    expect(
      epsil(
        'function mk(n: integer) -> (number) -> number { if n == 0 { (x) => x } else { (x) => n + mk(n - 1)(x) } }\n(mk(3)(0), mk(2)(10))'
      )
    ).toEqual(['Tuple', 6, 13]);
  });

  test('a write of a binder variable with no activation gives it no value', () => {
    const ce = new ComputeEngine();
    const sum = ce.box(['Sum', ['Multiply', 'i', 'i'], ['Limits', 'i', 1, 3]]);
    expect(sum.evaluate().json).toBe(14);
    const def = (sum.localScope!.bindings.get('i') as { value: any }).value;
    def.value = ce.number(7);
    expect(def.value).toBeUndefined();
    expect(def._presentValue).toBeUndefined();
    expect(sum.evaluate().json).toBe(14);
  });
});

// A local of a block is made only by a `Declare` that is a statement of the
// block or of a function body. `Assign` writes the variable that is in scope
// and never makes one (`docs/plans/2026-11-11-bound-once-spec.md`, section 11).
describe('a local of a block is declared', () => {
  /** The error code of the first `Error` in `json`, or `undefined`. */
  function errorCode(json: unknown): string | undefined {
    if (!Array.isArray(json)) return undefined;
    if (json[0] === 'Error' && Array.isArray(json[1]))
      return String(json[1][1]).replace(/'/g, '');
    for (const op of json.slice(1)) {
      const code = errorCode(op);
      if (code !== undefined) return code;
    }
    return undefined;
  }

  test('Block(Declare(c, 5), 2c) is 10', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Block',
      ['Declare', 'c', "'unknown'", 5],
      ['Multiply', 2, 'c'],
    ]);
    expect(e.evaluate().json).toBe(10);
  });

  test('Block(c := 5, 2c) with no c in scope: c is not declared', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Block', ['Assign', 'c', 5], ['Multiply', 2, 'c']]);
    expect(e.isValid).toBe(false);
    expect(errorCode(e.json)).toBe('assignment-to-undeclared-variable');
    expect(errorCode(e.evaluate().json)).toBe(
      'assignment-to-undeclared-variable'
    );
  });

  test('Block(c := 5, 2c) with a global c writes the global', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'integer');
    ce.assign('c', 1);
    const e = ce.box(['Block', ['Assign', 'c', 5], ['Multiply', 2, 'c']]);
    expect(e.evaluate().json).toBe(10);
    expect(ce.box('c').evaluate().json).toBe(5);
  });

  test('Block(If(True, Declare(t, 3)), t): a declaration in a branch', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Block',
      ['If', 'True', ['Declare', 't', "'unknown'", 3]],
      't',
    ]);
    expect(e.isValid).toBe(false);
    expect(errorCode(e.json)).toBe('declaration-below-statement');
  });

  test('Block(If(False, Declare(t, 3)), t) with a global t: the same error', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'integer');
    ce.assign('t', 9);
    const e = ce.box([
      'Block',
      ['If', 'False', ['Declare', 't', "'unknown'", 3]],
      't',
    ]);
    expect(e.isValid).toBe(false);
    expect(errorCode(e.json)).toBe('declaration-below-statement');
  });

  test('an Assign outside any block declares the variable in the current scope', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Assign', 'h', 5]).evaluate().json).toBe(5);
    expect(ce.box('h').evaluate().json).toBe(5);
    ce.assign('k', 7);
    expect(ce.box('k').evaluate().json).toBe(7);
  });

  test('an Assign in a function body to an undeclared name is an error', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Function', ['Block', ['Assign', 'w', 'x'], 'w'], 'x']);
    expect(errorCode(e.json)).toBe('assignment-to-undeclared-variable');
  });

  test('two declarations of one name in a block are an error', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Block',
      ['Declare', 'x', "'unknown'", 1],
      ['Declare', 'x', "'unknown'", 2],
      'x',
    ]);
    expect(errorCode(e.json)).toBe('variable-redeclaration');
  });

  test('a read before the declaration is an error', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'integer');
    ce.assign('q', 9);
    const e = ce.box([
      'Block',
      ['Add', 'q', 1],
      ['Declare', 'q', "'unknown'", 5],
    ]);
    expect(errorCode(e.json)).toBe('read-before-declaration');
  });

  test('the initial value of a Declare reads the outer name', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'integer');
    ce.assign('z', 9);
    const e = ce.box([
      'Block',
      ['Declare', 'z', "'unknown'", ['Add', 'z', 1]],
      'z',
    ]);
    expect(e.evaluate().json).toBe(10);
  });

  test('the type of a local is the type its Declare gives, or of its literal value', () => {
    const ce = new ComputeEngine();
    const typed = ce.box([
      'Block',
      ['Declare', 'a', "'real'", 1],
      ['Add', 'a', 1],
    ]);
    expect(typed.type.toString()).toBe('real');
    const literal = ce.box([
      'Block',
      ['Declare', 'b', "'unknown'", ['List', 1, 2]],
      'b',
    ]);
    expect(literal.type.toString()).toBe('vector<integer^2>');
  });

  test('only the assigned leaf of a destructuring declaration is widened', () => {
    const typeOf = (tail: string) =>
      new ComputeEngine()
        .box(
          parseEpsil(
            `do { let (a, b) = ([1, 2], [3, 4]); a = [5]; ${tail} }`
          )[0]
        )
        .type.toString();
    expect(typeOf('b')).toBe('vector<integer^2>');
    expect(typeOf('a')).toBe('vector<integer>');
  });

  test('a destructuring declaration declares each name', () => {
    const ce = new ComputeEngine();
    const declared = ce.box([
      'Block',
      ['Declare', ['Tuple', 'a', 'b'], "'unknown'", ['Tuple', 1, 2]],
      ['Add', 'a', 'b'],
    ]);
    expect(declared.evaluate().json).toBe(3);
    const assigned = ce.box([
      'Block',
      ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 1, 2]],
      ['Add', 'a', 'b'],
    ]);
    expect(errorCode(assigned.json)).toBe('assignment-to-undeclared-variable');
  });

  test('Epsil: a variable is introduced by let, also at the top level', () => {
    const run = (source: string) => {
      const r = executeEpsil(new ComputeEngine(), source);
      return {
        value: r.value?.json,
        codes: r.diagnostics.map((d) => String(d.message[3] ?? d.message[0])),
      };
    };
    expect(run('let c = 5\nc = c + 1\nc')).toEqual({ value: 6, codes: [] });
    expect(run('c = 5\nc').codes).toEqual([
      'assignment-to-undeclared-variable',
    ]);
    expect(run('do { t = 1; t }').codes).toEqual([
      'assignment-to-undeclared-variable',
    ]);
    expect(run('do { let t = 1; t = t + 1; t }')).toEqual({
      value: 2,
      codes: [],
    });
    expect(run('function g(k) { t = k; t }').codes).toEqual([
      'assignment-to-undeclared-variable',
    ]);
    expect(
      run('function g(k) { let t = k + 1; t }\nlet t = 0\n[g(1), t]')
    ).toEqual({ value: ['List', 2, 0], codes: [] });
  });

  test('Epsil: a read before a top-level let is an error, as in a block', () => {
    for (const source of [
      'let a = q + 1\nlet q = 2\na',
      'do { let a = q + 1; let q = 2; a }',
    ]) {
      const r = executeEpsil(new ComputeEngine(), source);
      expect(r.diagnostics.map((d) => d.message[3])).toEqual([
        'read-before-declaration',
      ]);
    }
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['Declare', 'a', "'unknown'", ['Add', 'q', 1]],
      ['Declare', 'q', "'unknown'", 2],
      'a',
    ]);
    expect(errorCode(block.json)).toBe('read-before-declaration');
  });

  test('an assignment to an undeclared name in a value operand is an assignment in an operand', () => {
    const ce = new ComputeEngine();
    const sum = ce.box([
      'Sum',
      ['Assign', 's', ['Add', 's', 'i']],
      ['Tuple', 'i', 1, 5],
    ]);
    expect(errorCode(sum.json)).toBe('assignment-in-operand');
    const declared = ce.box([
      'Block',
      ['Declare', 'a', "'unknown'", ['Add', 'q', ['Assign', 'w', 2]]],
      'a',
    ]);
    expect(errorCode(declared.json)).toBe('assignment-in-operand');
  });

  test('a local declared with a function literal is a variable that holds the function', () => {
    const ce = new ComputeEngine();
    ce.declare('n', { type: 'integer', value: 2 });
    const f = [
      'Function',
      [
        'If',
        ['LessEqual', 'x', 0],
        0,
        ['Add', 'n', ['f', ['Subtract', 'x', 1]]],
      ],
      'x',
    ];
    // It calls itself through its own name.
    expect(
      ce.box(['Block', ['Declare', 'f', "'unknown'", f], ['f', 3]]).evaluate()
        .re
    ).toBe(6);
    // A call is typed from the type of the variable, `function`.
    const call = ce.box([
      'Block',
      ['Declare', 'g', "'unknown'", ['Function', ['Add', 't', 1], 't']],
      ['g', ['List', 1, 2, 3]],
    ]);
    expect(call.type.matches('number')).toBe(false);
    expect(call.evaluate().toString()).toBe('[2,3,4]');
    // A second assignment with an incompatible signature is refused.
    const r = executeEpsil(
      new ComputeEngine(),
      'do { let k = (n: integer) => n + 1; k = (s: string) => s; k(1) }'
    );
    expect(r.value.toString()).toContain('incompatible-type');
  });

  test('a typed constant local is initialized once and then refuses a write', () => {
    const run = (source: string) =>
      new ComputeEngine().box(parseEpsil(source)[0]).evaluate().toString();
    expect(
      run('do { const f: (integer) -> integer = (x) => x + 1; f(2) }')
    ).toBe('3');
    expect(() =>
      run(
        'do { const f: (integer) -> integer = (x) => x + 1; f = (x) => x; f(2) }'
      )
    ).toThrow(/constant "f"/);
    expect(() => run('do { const k: integer = 1; k = 2; k }')).toThrow(
      /constant "k"/
    );
    expect(
      run('do { const f: (integer) -> integer = (x: string) => x; f(2) }')
    ).toContain('incompatible-type');
  });

  test('a top-level let of a function literal is a variable that holds the function', () => {
    const run = (source: string) => {
      const r = executeEpsil(
        new ComputeEngine(),
        'let g = (x) => x + 1\n' + source
      );
      expect(r.diagnostics).toEqual([]);
      return r.value.toString();
    };
    expect(run('let old = g\ng = (x) => x * 100\nold(1)')).toBe('2');
    expect(run('let fs = [g]\ng = (x) => x * 100\nfs[1](1)')).toBe('2');
    expect(
      run('function ap(f, v) { f(v) }\nlet h = g\ng = (x) => x * 100\nap(h, 1)')
    ).toBe('2');
    expect(run('let old = g\ng = (x) => x * 100\nApply(old, 1)')).toBe('2');
    expect(run('let old = g\ng = (x) => x * 100\nmap(old, [1])')).toBe('[2]');
    expect(run('let old = g\ng = (x) => old(x) * 2\ng(1)')).toBe('4');
  });

  test('a function statement of a block declares a variable', () => {
    const ce = new ComputeEngine();
    const g = ['Function', ['Add', 't', 1], 't'];
    expect(
      ce.box(['Block', ['DefineFunction', 'g', g], ['g', 2]]).evaluate().json
    ).toBe(3);
    expect(
      errorCode(ce.box(['Block', ['g', 2], ['DefineFunction', 'g', g]]).json)
    ).toBe('read-before-declaration');
    expect(
      errorCode(
        ce.box([
          'Block',
          ['Declare', 'g', "'(integer) -> integer'"],
          ['DefineFunction', 'g', g],
          ['g', 2],
        ]).json
      )
    ).toBe('declaration-without-value');
    expect(
      JSON.stringify(
        ce.box([
          'Block',
          ['Declare', 'g', "'(integer) -> integer'"],
          ['DefineFunction', 'g', g],
          ['g', 2],
        ]).json
      )
    ).toContain('variable-redeclaration');
  });

  test('a program that ends with the name of a function gives its literal on both routes', () => {
    for (const source of ['let f = () => 5\nf', 'function f() { 5 }\nf']) {
      const run = executeEpsil(new ComputeEngine(), source);
      const boxed = new ComputeEngine().box(parseEpsil(source)[0]).evaluate();
      expect(run.value.json).toEqual(['Function', ['Block', 5]]);
      expect(boxed.json).toEqual(['Function', ['Block', 5]]);
    }
  });
});

describe('a lazy collection keeps the activation it is made in', () => {
  test.each([
    [
      'function F(p) { let fs = [(x) => x + p]; map((g) => g(10), fs) }',
      ['List', ['F', 1]],
      '[[11]]',
    ],
    [
      'function F(p) { let fs = [(x) => x + p]; map((g) => g(10), fs) }',
      ['Tuple', ['F', 1], ['F', 2]],
      '([11], [12])',
    ],
    [
      'function F(p) { let fs = []; for i in [1, 2] { fs = [...fs, (x) => x + i + p] }; map((g) => g(10), fs) }',
      ['Tuple', ['F', 1], ['F', 2]],
      '([12,13], [13,14])',
    ],
  ])('%s, %j, synchronous and asynchronous', async (source, call, expected) => {
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, source).diagnostics).toEqual([]);
    expect(
      ce
        .box(call as any)
        .evaluate()
        .toString()
    ).toBe(expected);
    expect((await ce.box(call as any).evaluateAsync()).toString()).toBe(
      expected
    );
  });
});

describe('a stored lazy collection is a closure', () => {
  function run(source: string): string {
    const result = executeEpsil(new ComputeEngine(), source);
    expect(result.diagnostics).toEqual([]);
    return result.value.toString();
  }

  test('the callback reads a global when an element is computed', () => {
    expect(
      run(
        'let k = 3\nlet big = filter(1..oo, c => c > k)\nlet a = first(big)\nk = 10\n[a, first(big)]'
      )
    ).toBe('[4,11]');
  });

  test('a variable operand is the value it holds when the collection is made', () => {
    expect(
      run(
        'let k = 3\nlet xs = 1..oo\nxs = filter(xs, c => c > k)\nk = 10\nfirst(xs)'
      )
    ).toBe('11');
    expect(
      run(
        'let f = (f) => f + 1\nlet big = map(f, 1..oo)\nf = (x) => 100\nfirst(big)'
      )
    ).toBe('2');
  });

  test('the callback reads a local through the activation it was made in', () => {
    expect(
      run(
        'do { let k = 3; let big = filter(1..oo, c => c > k); k = 10; first(big) }'
      )
    ).toBe('11');
    expect(
      run(
        'function h(f, c) { c[2] }\nfunction g(f) { h((a) => 100 * a, [f(x) for x in [1, 2]]) }\ng((a) => a + 1)'
      )
    ).toBe('3');
  });

  test('a lazy Map that writes a local of the block it leaves, numerically', async () => {
    const program = [
      'Block',
      ['Declare', 'c', { str: 'real' }, 5],
      [
        'Map',
        ['Function', ['Block', ['Assign', 'c', ['Add', 'c', 'k']], 'c'], 'k'],
        ['List', 1, 2],
      ],
    ];
    const elements = (x: any): string =>
      `[${[...x.each()].map((e: any) => e.toString()).join(',')}]`;
    const options = { numericApproximation: true };
    for (const debug of [false, true]) {
      const ce = new ComputeEngine();
      ce._debugBindings = debug;
      expect(elements(ce.box(program as any).evaluate(options))).toBe('[6,8]');
      expect(
        elements(await ce.box(program as any).evaluateAsync(options))
      ).toBe('[6,8]');
    }
  });
});

describe('a held argument of a hold function with a bound variable', () => {
  const H = 'hold mySum(body, bind i, n) = Sum(body, (i, 1, n))\n';
  function run(source: string): unknown {
    const r = executeEpsil(new ComputeEngine(), H + source);
    expect(r.diagnostics).toEqual([]);
    return r.value?.json;
  }

  test('a name of the caller frame is replaced by its value', () => {
    expect(run('function f(m) { mySum(k^2, k, m) }\nf(3)')).toBe(14);
    expect(run('function f(m) { let q = m; mySum(k^2, k, q) }\nf(3)')).toBe(14);
    expect(run('function f(m) { let t = 2; mySum(t*k, k, m) }\nf(3)')).toBe(12);
  });

  test('a call of a function held by a caller local or parameter is applied', () => {
    expect(
      run('function f(p) { let g = (x) => x * p; mySum(g(k), k, 3) }\nf(2)')
    ).toBe(12);
    expect(
      run(
        'function f(p) { let g = (x) => x * p; mySum(Apply(g, k), k, 3) }\nf(2)'
      )
    ).toBe(12);
    expect(run('function f(g) { mySum(g(k), k, 3) }\nf((x) => 2*x)')).toBe(12);
    expect(
      run(
        'hold ev(x) = x + 0\nfunction f(p) { let g = (x) => x * p; ev(g(3)) }\nf(2)'
      )
    ).toBe(6);
  });

  test('every occurrence of a caller-frame name is replaced', () => {
    const ev = 'hold ev(x) = x + 0\n';
    expect(
      run(ev + 'function f(p) { let q = p; ev(q * q) }\n(f(3), f(4))')
    ).toEqual(['Tuple', 9, 16]);
    expect(
      run('function f(p) { let q = p; mySum(q*k + q, k, 2) }\n(f(1), f(10))')
    ).toEqual(['Tuple', 5, 50]);
    expect(
      run(
        'function f(p) { let g = (x) => x + p; mySum(g(k) * g(0), k, 2) }\n(f(1), f(2))'
      )
    ).toEqual(['Tuple', 5, 14]);
    expect(
      run(
        'function f(p) { let g = (x) => x + p; mySum(g(g(k)), k, 2) }\n(f(1), f(2))'
      )
    ).toEqual(['Tuple', 7, 11]);
    expect(
      run(
        'function f(g) { mySum(g(k) + g(1), k, 2) }\n(f((x) => 2*x), f((x) => 3*x))'
      )
    ).toEqual(['Tuple', 10, 15]);
    expect(run(ev + 'do { let q = 3; ev(q * q) }')).toBe(9);
    expect(
      run('let r = []\nfor j in 1..3 { r = [...r, mySum(j*k + j, k, 2)] }\nr')
    ).toEqual(['List', 5, 10, 15]);
    const ce = new ComputeEngine();
    executeEpsil(ce, ev);
    expect(
      ce
        .box([
          'Block',
          ['Declare', 'q', "'unknown'", 3],
          ['ev', ['Multiply', 'q', ['Add', 'q', 1]]],
        ])
        .evaluate().json
    ).toBe(12);
  });

  test('a chain of local functions that each call the previous one twice is inlined once per local', () => {
    let locals = 'let l1 = (x) => x + p; ';
    for (let i = 2; i <= 16; i++)
      locals += `let l${i} = (x) => l${i - 1}(x) + l${i - 1}(x); `;
    expect(
      run(`function f(p) { ${locals}mySum(l16(k), k, 1) }\nf(0)`)
    ).toBe(32768);
  }, 5000);

  test('each call has its own index range', () => {
    expect(run('(mySum(k, k, 2), mySum(k, k, 3))')).toEqual(['Tuple', 3, 6]);
    expect(
      run(
        'hold myProd(body, bind i, n) = Product(body, (i, 1, n))\n(myProd(k, k, 2), myProd(k, k, 4))'
      )
    ).toEqual(['Tuple', 2, 24]);
    expect(run('function f(n) { mySum(k, k, n) }\n(f(2), f(3))')).toEqual([
      'Tuple',
      3,
      6,
    ]);
    expect(run('mySum(k, k, 2)\nmySum(k, k, 3)')).toBe(6);
    const ce = new ComputeEngine();
    executeEpsil(ce, H);
    expect(ce.box(['mySum', 'k', 'k', 2]).evaluate().json).toBe(3);
    expect(ce.box(['mySum', 'k', 'k', 3]).evaluate().json).toBe(6);
  });

  test('a name that the callee reaches stays a name', () => {
    expect(run('mySum(k^2, k, 3)')).toBe(14);
    expect(run('let k = 5\nmySum(k*j, j, 3)')).toBe(30);
  });
});
