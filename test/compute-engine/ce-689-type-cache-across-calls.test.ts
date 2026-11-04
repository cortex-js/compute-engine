import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { RSK_ROW_INSERTION } from './fixtures/rsk-row-insertion';
import { lookup } from '../../src/compute-engine/function-utils';
import { withStaticTypingView } from '../../src/compute-engine/static-typing-view';

// Function-body types read static bindings, so activation declarations and
// frame pops must not invalidate them. Sign and value caches still depend on
// argument values and use the ordinary version. See docs/TYPE-SYSTEM.md,
// "Static binding view", for the lookup and invalidation rules.

const fill = (n: unknown, v: unknown): unknown =>
  n === '_raw' ? v : Array.isArray(n) ? n.map((o) => fill(o, v)) : n;

describe('CE-689: the type cache across calls of a function literal', () => {
  test('a call moves the any version, not the type version', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'x', 1], 'x']);
    ce.function('Apply', [f, ce.box(3)]).evaluate();
    const any = ce._anyVersion;
    const typeVersion = ce._typeVersion;
    expect(ce.function('Apply', [f, ce.box(4)]).evaluate().toString()).toBe(
      '5'
    );
    expect(ce._anyVersion).toBeGreaterThan(any);
    expect(ce._typeVersion).toBe(typeVersion);
  });

  test('an assignment still moves the type version', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 1);
    const typeVersion = ce._typeVersion;
    ce.assign('a', 'hello');
    expect(ce._typeVersion).toBeGreaterThan(typeVersion);
    expect(ce.box('a').type.toString()).not.toBe(
      ce.box(1).type.toString()
    );
  });

  test('the issue function: the value, and the types are not computed again at each call', () => {
    const ce = new ComputeEngine();
    const fn = ce.box(['Function', RSK_ROW_INSERTION as any, '_raw']);
    const apply = (p: number[]) =>
      ce.function('Apply', [fn, ce.box(['List', ...p])]).evaluate();
    expect(JSON.stringify(apply([4, 3, 2, 1]).json)).toBe(
      '["List",["List",1],["List",2],["List",3],["List",4]]'
    );
    ce._cacheStats.reset();
    ce._cacheStats.enabled = true;
    let value: string;
    try {
      value = JSON.stringify(apply([3, 1, 2]).json);
    } finally {
      ce._cacheStats.enabled = false;
    }
    expect(value).toBe('["List",["List",1,2],["List",3]]');
    // The warmed workload records 159 generation misses. A small allowance
    // catches gradual invalidation drift; newly constructed nodes contribute
    // cold misses separately. See benchmarks/README.md for the paired run.
    expect(ce._cacheStats.snapshot().caches.type.missGeneration).toBeLessThanOrEqual(
      170
    );
  });

  test('a type handler that reads a parameter by name does not see the value of the call', () => {
    // A type handler sees the types of its operands, not their values. The
    // one way it can reach a value is a definition lookup by name
    // (`PureEngineView.lookupDefinition`). Inside the body of the literal,
    // during a call, the binding of `x` that the call made holds the value
    // of the argument. A type computation reads the bindings in the static
    // view (`static-typing-view.ts`), where `x` is the parameter of the
    // literal, with no value: the type is the same in every call, and it is
    // the type read outside every call. (ROADMAP CE-689, option (A), user
    // decision 2026-10-30.)
    const ce = new ComputeEngine();
    ce.declare('ValueType689', {
      signature: '() -> any',
      type: (_ops, { engine }) =>
        engine.lookupDefinition('x')?.value?.value?.type.type ?? 'any',
      evaluate: () => ce.box('x').evaluate(),
    });
    ce.declare('TypeOf689', {
      signature: '(any) -> string',
      lazy: true,
      canonical: (ops) => ce._fn('TypeOf689', ops.map((op) => op.canonical)),
      evaluate: (ops) => ce.string(ops[0].type.toString()),
    });
    ce.declare('g689', {
      value: ce.box([
        'Function',
        ['Block', ['TypeOf689', ['ValueType689']]],
        'x',
      ]),
    });
    const first = ce.box(['g689', 3]).evaluate().toString();
    const second = ce.box(['g689', { str: 'ab' }]).evaluate().toString();
    expect(first).toBe('"any"');
    expect(second).toBe(first);
    expect(ce.box(['g689', 3]).evaluate().toString()).toBe(first);
  });

  test('an evaluation of another engine inside a type computation reads the value of a parameter', () => {
    // The static view of the bindings belongs to the engine of the type
    // computation (`static-typing-view.ts`). A type handler of `ce` that
    // evaluates an expression of a second engine reads the bindings of that
    // engine as an evaluation does: here the
    // application of `y -> sum of y + k for k = 1` to 2 reads its parameter
    // `y` as 2. (A type
    // handler must not evaluate an expression of its own engine: an
    // application declares its parameters, and the handler guard refuses a
    // handler that moves a version of the engine.)
    const ce = new ComputeEngine();
    const other = new ComputeEngine();
    // The `Sum` makes a scope under the body scope: the walk from it goes
    // through the body scope to the frame of the application.
    const application = other.box([
      'Apply',
      ['Function', ['Sum', ['Add', 'y', 'k'], ['Triple', 'k', 1, 1]], 'y'],
      2,
    ]);
    const seen: string[] = [];
    ce.declare('EvalInType689', {
      signature: '(any) -> any',
      type: () => {
        seen.push(application.evaluate().toString());
        return 'integer';
      },
      evaluate: () => ce.box(0),
    });
    ce.declare('h689', {
      value: ce.box(['Function', ['Block', ['EvalInType689', 'x']], 'x']),
    });
    expect(ce.box(['h689', 5]).evaluate().toString()).toBe('0');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v === '3')).toBe(true);
  });

  test('a read of a symbol of another engine inside a type computation reads the value of its call', () => {
    // The static view of `ce` changes only the walks through the scopes of
    // `ce`. Here a type handler of `ce` runs while `other` applies
    // `y -> sum of Probe(y) + y + k for k = 1` to 2, and evaluates the node
    // `y` of the body. The walk of `other` starts in the scope of the `Sum`,
    // goes through the body scope of the literal to the frame of the
    // application, and finds `y` = 2 there. Before the frames were recorded
    // with their engine, the view of `ce` skipped the frame of `other` and
    // read the valueless `y` that the application took out of the body
    // scope.
    const ce = new ComputeEngine();
    const other = new ComputeEngine();
    let n = 0;
    const seen: string[] = [];
    ce.declare('ReadOther689', {
      signature: '(any) -> any',
      type: () => {
        seen.push(yNode.evaluate().toString());
        return 'integer';
      },
      evaluate: () => ce.box(0),
    });
    other.declare('Probe689', {
      signature: '(any) -> integer',
      pure: false,
      evaluate: () => {
        void ce.function('ReadOther689', [ce.number(n++)]).type;
        return other.Zero;
      },
    });
    const application = other.box([
      'Apply',
      [
        'Function',
        ['Sum', ['Add', ['Probe689', 'y'], 'y', 'k'], ['Triple', 'k', 1, 1]],
        'y',
      ],
      2,
    ]);
    const sum = find(application, (e) => e.operator === 'Sum');
    const yNode: any = find(sum, (e) => e.symbol === 'y');
    expect(application.evaluate().toString()).toBe('3');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v === '2')).toBe(true);
  });

  test('the static view diverges while an awaited application is suspended', async () => {
    // After its first `await`, an awaited application of a literal gives
    // the engine back the enclosing stack, but the body scope of the literal
    // keeps the frame of the application as parent and its parameters taken
    // out until the application ends. A walk from the body scope then
    // reads `x` = 4 in the frame, and the same walk in the static view reads
    // the valueless parameter. So the static view differs from the bindings,
    // and a sign, a value or an evaluation computed in it must have a key of
    // its own (`_cacheGeneration()`), also when no frame is on the current
    // stack.
    const ce = new ComputeEngine();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    ce.declare('Gate689', {
      signature: '() -> number',
      pure: false,
      evaluateAsync: async () => {
        entered();
        await gate;
        return ce.Zero;
      },
    } as never);
    ce.declare('f689a', {
      value: ce.box(['Function', ['Block', ['Gate689'], ['Add', 'x', 1]], 'x']),
    });
    const literal: any = (ce.lookupDefinition('f689a') as any).value.value;
    const bodyScope = literal.ops[0].localScope;
    expect(bodyScope).toBeDefined();
    const first = ce.box(['f689a', 4]).evaluateAsync();
    await started;
    let outside: unknown;
    let inside: unknown;
    let generations: [number, number];
    try {
      outside = (lookup('x', bodyScope) as any)?.value?.value?.toString();
      inside = withStaticTypingView(ce, () =>
        (lookup('x', bodyScope) as any)?.value?.value?.toString()
      );
      generations = [
        ce._cacheGeneration(),
        withStaticTypingView(ce, () => ce._cacheGeneration()),
      ];
    } finally {
      release();
    }
    expect(outside).toBe('4');
    expect(inside).toBeUndefined();
    expect(generations[1]).not.toBe(generations[0]);
    expect((await first).toString()).toBe('5');
    // No application runs any more: the view is the bindings again.
    expect(withStaticTypingView(ce, () => ce._cacheGeneration())).toBe(
      ce._cacheGeneration()
    );
  });

  test('the cached sign of a node of the body is not served in the next call (CE-531)', () => {
    const ce = new ComputeEngine();
    ce.declare('SignOf689', {
      signature: '(any) -> string',
      lazy: true,
      canonical: (ops) => ce._fn('SignOf689', ops.map((op) => op.canonical)),
      evaluate: (ops) => ce.string(String(ops[0].sgn)),
    });
    ce.declare('s689', {
      value: ce.box([
        'Function',
        ['Block', ['SignOf689', ['Add', 'x', 1]]],
        'x',
      ]),
    });
    expect(ce.box(['s689', 3]).evaluate().toString()).toBe('"positive"');
    expect(ce.box(['s689', -5]).evaluate().toString()).not.toBe('"positive"');
    expect(ce.box(['s689', 3]).evaluate().toString()).toBe('"positive"');
  });

  test.each([
    [
      'a self-recursive collection scanner',
      'function countdown(xs) { if Length(xs) == 0 { 0 } else { 1 + countdown(Rest(xs)) } }\ncountdown([1,2,3,4])',
      '4',
    ],
    [
      'mutual recursion',
      'function pingL(xs) { if Length(xs) == 0 { 0 } else { 1 + pongL(Rest(xs)) } }\nfunction pongL(xs) { if Length(xs) == 0 { 0 } else { 1 + pingL(Rest(xs)) } }\npingL([1,2,3])',
      '3',
    ],
  ])(
    'the cached value of a node of the body is not served in the next call (CE-334): %s',
    (_label, source, expected) => {
      const ce = new ComputeEngine();
      expect(executeEpsil(ce, source).value?.toString()).toBe(expected);
    }
  );

  test('the issue function gives the same values for several permutations', () => {
    const ce = new ComputeEngine();
    const fn = ce.box(['Function', RSK_ROW_INSERTION as any, '_raw']);
    const cases: [number[], string][] = [
      [[1, 2, 3], '[[1,2,3]]'],
      [[2, 1], '[[1],[2]]'],
      [[3, 1, 2], '[[1,2],[3]]'],
      [[1, 3, 2, 4], '[[1,2,4],[3]]'],
    ];
    for (const [p, expected] of cases) {
      const viaApply = ce
        .function('Apply', [fn, ce.box(['List', ...p])])
        .evaluate();
      expect(viaApply.toString()).toBe(expected);
      // The same expression with the permutation written in place.
      const inline = ce.box(fill(RSK_ROW_INSERTION, ['List', ...p]) as any);
      expect(inline.evaluate().toString()).toBe(expected);
    }
  });

  // The type of a node is not always a function of the bindings alone: some
  // type computations read the bindings from the scope of the reader, and
  // some read an answer that depends on the computations in progress. The
  // three tests below read a node outside a call and then inside a call (or
  // after one). Each one failed when the type cache was keyed on the type
  // version alone.

  /** The first node of `e`, depth first, for which `f` is true. */
  const find = (e: any, f: (e: any) => boolean): any => {
    if (f(e)) return e;
    for (const op of e.ops ?? []) {
      const found = find(op, f);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  test('a literal that calls a block local function is typed again inside the call', () => {
    // The effects of the literal of `even` resolve `odd` from the scope of
    // the reader (`lookupDefinition()`). Outside a call of `outer`, `odd` is
    // not found and the effects are `any`. Inside the call, `odd` is found,
    // and the literal has no effects. The read at the start of the second
    // call served the type read outside the call.
    const ce = new ComputeEngine();
    ce.declare('ReadLiteralType689', {
      signature: '() -> string',
      evaluate: () => ce.string(literal.type.toString()),
    });
    executeEpsil(
      ce,
      `function outer(k) {
  r = ReadLiteralType689()
  even(n) = true if n == 0 else odd(n - 1)
  odd(n) = false if n == 0 else even(n - 1)
  [even(k), r]
}`
    );
    const def: any = ce.lookupDefinition('outer');
    const literal: any = find(
      def.operator._lambdaLiteral,
      (e) =>
        e.operator === 'Function' &&
        e.ops[1]?.symbol === 'n' &&
        e.toString().includes('"True"')
    );
    expect(executeEpsil(ce, 'outer(4)').value?.toString()).toBe(
      '["True","(n: unknown) -> boolean"]'
    );
    expect(literal.type.toString()).toBe('(n: unknown) any -> boolean');
    expect(executeEpsil(ce, 'outer(7)').value?.toString()).toBe(
      '["False","(n: unknown) -> boolean"]'
    );
  });

  test('a node that reads a local of a block is typed again inside a call', () => {
    // `c689` is a local of the `Block`. Outside the block, the symbol does
    // not find its value, and `x / c689` is typed from the declared types.
    // Inside the call of the function of the `Map`, it finds the value 5.
    const ce = new ComputeEngine();
    ce.declare('TypeOf689b', {
      signature: '(any) -> string',
      lazy: true,
      canonical: (ops) => ce._fn('TypeOf689b', ops.map((op) => op.canonical)),
      evaluate: (ops) => ce.string(ops[0].type.toString()),
    });
    const block = ce.box([
      'Block',
      ['Assign', 'c689', 5],
      [
        'Map',
        ['Function', ['TypeOf689b', ['Divide', 'x', 'c689']], 'x'],
        ['List', 1, 2],
      ],
    ]);
    const divide = find(block, (e) => e.operator === 'Divide');
    expect(divide.type.toString()).toBe('infinity | nan | real');
    expect(block.evaluate().toString()).toBe('["rational","rational"]');
  });

  test('a type read while the same function was being derived is typed again after a call', () => {
    // While the result of a call of `theta` is derived from its body, a
    // call of `theta` that is typed is declined (it would be a recursion),
    // and has the declared result, `unknown`. The node `theta(x, y)` in the
    // body of `p` is typed so while `d00` is compiled. After a call, it is
    // typed again, and its type is the derived one.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    const U1 = '(unknown) -> unknown';
    const U2 = '(unknown, unknown) -> unknown';
    ce.declare('t_0', 'real');
    ce.assign('t_0', 2.855);
    ce.declare('s_eed', 'real');
    ce.assign('s_eed', 2.41);
    ce.declare('p_rand', {
      type: U1,
      value: ce.parse(
        '(p)\\mapsto \\operatorname{mod}(\\sin(\\operatorname{Dot}(p, (12.9898,78.233,45.164)))\\cdot 43758.5453, 1)'
      ),
    });
    ce.declare('theta', {
      type: U2,
      value: ce.parse(
        '(x,y)\\mapsto 2\\pi\\cdot p_{rand}((\\lfloor x\\rfloor,\\lfloor y\\rfloor,s_{eed}))+t_0'
      ),
    });
    ce.declare('p', {
      type: U2,
      value: ce.parse(
        '(x,y)\\mapsto (\\cos(\\theta(x,y)), \\sin(\\theta(x,y)))'
      ),
    });
    ce.declare('s_x', {
      type: U2,
      value: ce.parse('(x,y)\\mapsto \\operatorname{mod}(x,1)'),
    });
    ce.declare('s_y', {
      type: U2,
      value: ce.parse('(x,y)\\mapsto \\operatorname{mod}(y,1)'),
    });
    ce.declare('S', {
      type: U2,
      value: ce.parse('(x,y)\\mapsto (-s_x(x,y), -s_y(x,y))'),
    });
    ce.declare('d_00', {
      type: U2,
      value: ce.parse(
        '(x,y)\\mapsto \\operatorname{Dot}(p(x,y), S(x,y)+(0,0))'
      ),
    });
    const node = find(
      (ce.lookupDefinition('p') as any).value.value,
      (e) => e.operator === 'theta'
    );
    const latex = 'd_{00}(x,y)';
    (ce as any)._getCompilationTarget('javascript').compile(ce.parse(latex));
    ce.parse(latex).subs({ x: 0.3, y: 0.7 }).N();
    expect(node.type.toString()).toBe('number');
  });
});
