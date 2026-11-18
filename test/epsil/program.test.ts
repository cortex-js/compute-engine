import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';
import { executeEpsil, executeEpsilAsync } from '../../src/epsil/execute-epsil';
import { diagnosticFlow } from '../../src/epsil/diagnostic-flow';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { setDebugStatementHook } from '../../src/common/debug-hook';
import { beginAsyncEvaluation } from '../../src/compute-engine/boxed-expression/evaluation-epoch';

const parsed = (ce: ComputeEngine, source: string) =>
  ce.box(resolveLibraryNames(parseEpsil(source)[0]!, source, ce));

const check = (ce: ComputeEngine, source: string) => {
  const ast = resolveLibraryNames(parseEpsil(source)[0]!, source, ce);
  return staticDiagnostics(ce, ast, source);
};

afterEach(() => setDebugStatementHook(undefined));

describe('Program uses one sequence on every execution route', () => {
  test.each([
    ['', 'Nothing'],
    ['5', 5],
    ['let x=1', 'Nothing'],
    ['let x=1; x', 1],
    ['let a=h(1); function h(x) { x+1 }; a', 2],
    ['let x=1; let x=2; x', 1],
    ['const c=1; c=2; c', 1],
    ['let a="x"+1; 5', 5],
    ['let t=0; let g=(k)=>do { t=k+1; t }; [g(1),t]', ['List', 2, 2]],
    ['function g(k) scope { t=k+1; t }; let t=0; [g(1),t]', ['List', 2, 2]],
    ['function f(x) { x }; f', 'f'],
    ['do { let x=2; x }; 5', 5],
  ])('%s', async (source, expected) => {
    const direct = new ComputeEngine();
    const asynchronous = new ComputeEngine();
    expect(parsed(direct, source).evaluate().json).toEqual(expected);
    expect((await parsed(asynchronous, source).evaluateAsync()).json).toEqual(expected);
    expect(executeEpsil(new ComputeEngine(), source).value.json).toEqual(expected);
    expect((await executeEpsilAsync(new ComputeEngine(), source)).value.json).toEqual(expected);
  });

  test('a lambda variable cannot be read before its declaration', () => {
    const result = executeEpsil(new ComputeEngine(), 'let a=h(1); let h=(x)=>x+1; 5');
    expect(result.value.json).toBe(5);
    expect(result.diagnostics.filter((d) => d.code === 'read-before-declaration')).toHaveLength(1);
  });

  test('function clauses and a paired signature retain their existing contracts', () => {
    const ce = new ComputeEngine();
    const source = 'let f: (integer)->integer; function f(n) { n+1 }; f(2)';
    expect(executeEpsil(ce, source).diagnostics).toEqual([]);
    expect(executeEpsil(new ComputeEngine(), source).value.json).toBe(3);
    expect(executeEpsil(new ComputeEngine(), 'function f(n:integer){n}; function f(s:string){s}; [f(2),f("a")]').value.json).toEqual(['List', 2, "'a'"]);
  });

  test.each(['let', 'const'])('%s zero aliases are evaluated before quotient cancellation', async (kind) => {
    expect(executeEpsil(new ComputeEngine(), `${kind} x=0; x/x`).value.json).toBe('NaN');
    expect((await executeEpsilAsync(new ComputeEngine(), `${kind} x=0; x/x`)).value.json).toBe('NaN');
    expect((await executeEpsilAsync(new ComputeEngine(), `${kind} x=0; ${kind} y=x; y/y`)).value.json).toBe('NaN');
    expect(executeEpsil(new ComputeEngine(), `${kind} x=0; ${kind} y=x; y/y`).value.json).toBe('NaN');
  });

  test.each(['Pi', 'ExponentialE', 'GoldenRatio'])('%s retains constant quotient cancellation', (name) => {
    const ce = new ComputeEngine();
    expect(ce.box(['Divide', name, name]).json).toBe(1);
  });

  test('a host constant retains constant quotient cancellation', () => {
    const ce = new ComputeEngine();
    ce.declare('c', { value: 3, isConstant: true });
    expect(ce.box(['Divide', 'c', 'c']).json).toBe(1);
  });

  test('fixed contracts preserve the last valid value when a later store fails', () => {
    const prefix = 'function g(x){1/x}; let xs=[1,g("a"),3]; ';
    const list = executeEpsil(new ComputeEngine(), prefix + 'let ys=[]; for x in xs {ys=[...ys,x+1]}; ys');
    expect(list.value.toString()).toBe('[2,Error(ErrorCode("incompatible-type", "number", "string"), "a"),4]');
    const total = executeEpsil(new ComputeEngine(), prefix + 'let t=0; for x in xs {t=t+x}; t');
    expect(total.value.json).toBe(1);
    expect(total.diagnostics.map((d) => [d.message[0], d.message[3]])).toEqual([
      ['runtime-error', 'incompatible-type'],
      ['runtime-error', 'incompatible-type'],
    ]);
    expect(executeEpsil(new ComputeEngine(), 'let t:integer=0; t="a"; t').value.json).toBe(0);
  });

  test('a forward inferred domain replaces the same authored clause', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(ce, 'function k(xs){h(xs)}; function h(xs){mean(xs)}; k([1,2,3])');
    expect(result.value.json).toBe(2);
    expect(result.diagnostics).toEqual([]);
    expect(ce.symbol('k').type.toString()).toBe('(xs: collection<number> | value) -> number');
  });

  test('a function body retains a named call through a valueless Program alias', () => {
    const result = executeEpsil(new ComputeEngine(), 'function scale(x,factor){x*factor}; let alias=scale; function g(){alias(x:3,factor:5)}; g()');
    expect(result.value.json).toBe(15);
    expect(result.diagnostics).toEqual([]);
  });

  test('a valueless Program constant retains a lazy member call', () => {
    const ce = new ComputeEngine();
    ce.assign('y', 10);
    ce.declare('held', { lazy: true, evaluate: (ops, { engine }) => engine._fn('Hold', ops) });
    const result = executeEpsil(ce, 'const ns={H->held}; ns.H(y*z)');
    expect(result.value.toString()).toBe('Hold(y * z)');
    expect(result.diagnostics).toEqual([]);
  });

  test('readonly projection leaves an ordinary inferred tuple argument to the canonical checker', () => {
    const result = executeEpsil(new ComputeEngine(), 'function f(p){p[1]}; f(first(filter([(1,2)],c=>c[1]>9)))');
    expect(result.value.json).toBe('NaN');
    expect(result.diagnostics).toEqual([]);
  });

  test('a persistent declared effect contract keeps its declared provenance', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let f:() pure->integer=()=>1');
    const result = executeEpsil(ce, 'let x=0; let f:() pure->integer=()=>do{x=1;1}; f(); x');
    expect(result.value.json).toBe(0);
    expect(result.diagnostics.some((d) => d.message.includes('incompatible-type'))).toBe(true);
    expect(ce.lookupDefinition('f')!.value!.effectsDeclared).toBe(true);
  });

  test('a refused fresh Program replacement restores its prior tuple bindings', async () => {
    for (const run of [executeEpsil, executeEpsilAsync]) {
      const ce = new ComputeEngine();
      await run(ce, 'let (a,b)=(1,2); let count=0');
      const failed = await run(ce, 'let (a,b)=do {count=count+1;3}');
      expect(failed.value.operator).toBe('Error');
      expect((await run(ce, '(a,b,count)')).value.json).toEqual(['Tuple', 1, 2, 1]);
    }
  });

  test('hoisted function constant-write diagnostics retain original source sites', () => {
    for (const source of ['const c=1; function f(x) scope {c=x}; f(2)', 'function f(x) scope {c=x}; const c=1; f(2)']) {
      const result = executeEpsil(new ComputeEngine(), source);
      const diagnostic = result.diagnostics.find((d) => d.code === 'constant-assignment');
      expect(diagnostic).toBeDefined();
      expect(source.slice(...diagnostic!.range.slice(0, 2) as [number, number])).toBe('c=x');
    }
  });

  test('source-first declaration admission precedes canonical function hoisting', () => {
    const ce = new ComputeEngine();
    const source = 'const k=(n)=>n; function k(x){x+1}; k(2)';
    const result = executeEpsil(ce, source);
    expect(result.value.json).toBe(2);
    expect(ce.lookupDefinition('k')!.value!.isConstant).toBe(true);
    const duplicate = result.diagnostics.find((d) => d.code === 'variable-redeclaration');
    expect(duplicate).toBeDefined();
    expect(source.slice(...duplicate!.range.slice(0, 2) as [number, number])).toBe('function k(x){x+1}');
    expect(executeEpsil(new ComputeEngine(), 'function k(x){x+1}; const k=(n)=>n; k(2)').value.json).toBe(3);
  });

  test('Program preserves protected global library constants and Block shadowing', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(ce, 'let Pi=3; Pi');
    expect(result.value.isSame(ce.Pi)).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message[0]).toBe('runtime-error');
    expect(parsed(new ComputeEngine(), 'let Pi=3; Pi').evaluate().json).toBe('Pi');
    expect(executeEpsil(new ComputeEngine(), 'do {let Pi=3; Pi}').value.json).toBe(3);
  });

  test('Program JSON preserves authored default admission across fresh engines', async () => {
    const program = parsed(new ComputeEngine(), 'const W=5; function f(k=W){k+1}; f()');
    expect(program.ops[0].operator).toBe('DefineFunction');
    const json = program.json;
    expect((json as unknown[])[1]).toEqual(['Declare', 'W', {dict: {value:5, constant:true}}]);
    expect(new ComputeEngine().box(json).evaluate().json).toBe(6);
    expect((await new ComputeEngine().box(json).evaluateAsync()).json).toBe(6);
    expect(program.engine.box(json).evaluate().json).toBe(6);
  });

  test.each([false, true])('prepared declarations retain owned identities across interleaved boxing (async=%s)', async (asynchronous) => {
    const ce = new ComputeEngine();
    const first = parsed(ce, 'const W=5; function f(k=W){k+1}; f()');
    const second = parsed(ce, 'const W=9; function f(k=W){k+2}; f()');
    const evaluate = (program: ReturnType<typeof parsed>) => asynchronous ? program.evaluateAsync() : program.evaluate();
    expect((await evaluate(first)).json).toBe(6);
    expect((await evaluate(second)).json).toBe(11);
    expect((await evaluate(first)).json).toBe(6);
  });

  test.each([false, true])('a refused prepared tuple replay restores every current incumbent (async=%s)', async (asynchronous) => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let a=1; let b=2; let pair:any=(3,4)');
    const program = parsed(ce, 'let (a,b)=pair; (a,b)');
    const evaluate = () => asynchronous ? program.evaluateAsync() : program.evaluate();
    expect((await evaluate()).json).toEqual(['Tuple', 3, 4]);
    executeEpsil(ce, 'let b=20; pair=5');
    expect((await evaluate()).json).toEqual(['Tuple', 3, 20]);
    expect(executeEpsil(ce, '(a,b)').value.json).toEqual(['Tuple', 3, 20]);
  });

  test.each([false, true])('an admitted Error initializer commits its prepared binding (async=%s)', async (asynchronous) => {
    const ce = new ComputeEngine();
    const program = parsed(ce, 'let a=RuntimeError("cell"); a');
    executeEpsil(ce, 'let a=7');
    const value = await (asynchronous ? program.evaluateAsync() : program.evaluate());
    expect(value.toString()).toBe('Error("cell")');
    expect(ce.symbol('a').evaluate().toString()).toBe('Error("cell")');
  });

  test('prepared initializers keep their boxed prior-binding home; fresh Programs use the current caller', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let z=9');
    const program = parsed(ce, 'let z=z+1; z');
    expect(program.evaluate().json).toBe(10);
    executeEpsil(ce, 'let z=20');
    expect(program.evaluate().json).toBe(10);
    executeEpsil(ce, 'let z=20');
    expect(executeEpsil(ce, 'let z=z+1; z').value.json).toBe(21);
  });

  test('the shared Limit repair excludes a nonnumeric Block local too', () => {
    const result = executeEpsil(new ComputeEngine(), 'function f(){let L=[1,2];limit(sum(L),1)};f()');
    expect(result.value.json).toBe(3);
    expect(result.diagnostics).toEqual([]);
  });

  test('a valueless declared list is not an implicit limit variable', () => {
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, 'let L=[1,2]; limit(total(L),0)').value.toString()).toBe('total([1,2])');
    expect(executeEpsil(new ComputeEngine(), 'let L=[1,2]; limit(total(L),L,0)').value.toString()).toBe('total(0)');
    expect(executeEpsil(new ComputeEngine(), 'let a=5; limit(a+h,1)').value.toString()).toBe('h + 1');
  });

  test('a hoisted const is excluded from implicit calculus variables', () => {
    const result = executeEpsil(new ComputeEngine(), 'const a=5; function g(){limit(a+h,1)}; g()');
    expect(result.value.json).toBe(6);
    expect(result.diagnostics).toEqual([]);
  });

  test('an earlier const stays a constant default after function hoisting', () => {
    const result = executeEpsil(new ComputeEngine(), 'const W=5; function f(k=W){k+1}; f()');
    expect(result.diagnostics).toEqual([]);
    expect(result.value.json).toBe(6);
  });

  test('a nested function shadows a caller Program constant', () => {
    const result = executeEpsil(new ComputeEngine(), 'const k=5; function o(){function k(){2}; k()}; [o(),o(),k]');
    expect(result.value.json).toEqual(['List', 2, 2, 5]);
    expect(result.diagnostics).toEqual([]);
  });

  test('a raw error pattern reaches the existing Match observer', () => {
    const result = executeEpsil(new ComputeEngine(), 'function g(){RuntimeError("neg")}; match g(){Error(c)=>c; _=>"ok"}');
    expect(result.value.json).toBe("'neg'");
    expect(result.diagnostics).toEqual([]);
  });

  test('nested diagnostic reporting keeps the host statement callback installed', () => {
    const seen: number[] = [];
    const source = 'function g(n:integer){n}; let xs=[]; for i in [1]{xs=[g("a")]}; 5';
    executeEpsil(new ComputeEngine(), source, { onStatement: ({ index }) => seen.push(index) });
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  test('source callbacks keep source indices and ranges after hoisting', () => {
    const source = 'let a=f(2); function f(x){x+1}; a';
    const seen: { index: number; text: string }[] = [];
    executeEpsil(new ComputeEngine(), source, { onStatement: ({ index, range }) => seen.push({ index, text: source.slice(...range) }) });
    expect(seen).toEqual([
      { index: 1, text: 'function f(x){x+1}' },
      { index: 0, text: 'let a=f(2)' },
      { index: 2, text: 'a' },
    ]);
  });
});

describe('stable caller-scope Program variables', () => {
  test('function replacements stay values with the coarse function contract', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let k=(n:integer)=>n');
    const binding = ce.lookupDefinition('k');
    expect(binding).toHaveProperty('value');
    expect(ce.symbol('k').type.toString()).toBe('function');
    expect(executeEpsil(ce, 'k=(s:string)=>s; k("a")').value.json).toBe("'a'");
    expect(ce.lookupDefinition('k')).toBe(binding);
    expect(executeEpsil(ce, 'k=(n:integer)=>n; k("a")').value.operator).toBe('Error');
    expect(ce.symbol('k').type.toString()).toBe('function');
  });

  test('the existing numeric admission carrier applies across Programs', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let x=1');
    expect(ce.symbol('x').type.toString()).toBe('number');
    expect(executeEpsil(ce, 'x=1.5; x').value.json).toEqual(1.5);
    expect(executeEpsil(ce, 'x="a"; x').value.json).toEqual(1.5);
  });

  test.each(['let', 'const'])('a later %s declaration establishes its own callable facts', (kind) => {
    const ce = new ComputeEngine();
    executeEpsil(ce, `${kind} k=(n:integer)=>n`);
    const source = `${kind} k=(s:string)=>s; k("b")`;
    const binding = ce.lookupDefinition('k');
    expect(check(ce, source)).toEqual([]);
    expect(ce.lookupDefinition('k')).toBe(binding);
    expect(executeEpsil(ce, source).value.json).toBe("'b'");
  });

  test.each(['const x=2', 'let x="a"'])('a refused %s cannot change the first declaration', (duplicate) => {
    const ce = new ComputeEngine();
    const result = executeEpsil(ce, `let x=1; ${duplicate}; x=3; x`);
    expect(result.value.json).toBe(3);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['variable-redeclaration']);
    expect(ce.symbol('x').type.toString()).toBe('number');
    expect(ce.lookupDefinition('x')?.value?.isConstant).toBe(false);
  });

  test('a refused declaration cannot change an actual Block binding type', () => {
    const ce = new ComputeEngine();
    const block = ce.box(['Block', ['Declare', 'x', { dict: { value: 1 } }], ['Declare', 'x', { dict: { value: { str: 'a' } } }], 'x']);
    expect(block.ops[block.ops.length - 1].type.toString()).toBe('number');
  });

  test('a prepared typed const function initializes on each synchronous run', () => {
    const ce = new ComputeEngine();
    const program = parsed(ce, 'const k:(integer)->integer=(n)=>n');
    expect(program.evaluate().json).toBe('Nothing');
    expect(program.evaluate().json).toBe('Nothing');
    expect(executeEpsil(ce, 'k=(n)=>n+1; k(2)').value.json).toBe(2);
  });

  test('a prepared typed const function initializes on each asynchronous run', async () => {
    const ce = new ComputeEngine();
    const program = parsed(ce, 'const k:(integer)->integer=(n)=>n');
    expect((await program.evaluateAsync()).json).toBe('Nothing');
    expect((await program.evaluateAsync()).json).toBe('Nothing');
    expect(executeEpsil(ce, 'k=(n)=>n+1; k(2)').value.json).toBe(2);
  });

  test('a rerun initializer reads the previous caller binding', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let z=9');
    expect(executeEpsil(ce, 'let z=z+1; z').value.json).toBe(10);
  });

  test('diagnostic aliases capture values without adopting a variable contract', () => {
    const source = 'let k=(n:integer)=>n; let g=k; k=(s:string)=>s; g(1.5)';
    const ce = new ComputeEngine();
    const diagnostics = check(ce, source);
    expect(diagnostics.some((d) => d.code === 'incompatible-type')).toBe(true);
    const result = executeEpsil(ce, source);
    expect(result.value.operator).toBe('Error');
    expect(ce.symbol('g').type.toString()).toBe('function');
  });

  test('the diagnostic fact pass does not simulate binding writes', () => {
    const ce = new ComputeEngine();
    const program = parsed(ce, 'let k=(n:integer,scale:integer=2)=>n*scale; let x:number=1.5; k(n:x)');
    // Warm source types before observing the read-only analysis itself.
    for (const node of program.subexpressions) void node.type;
    const declare = jest.spyOn(ce, 'declare');
    const assign = jest.spyOn(ce, 'assign');
    const events = jest.spyOn(ce, '_noteStateEvent');
    const infer = jest.spyOn(Object.getPrototypeOf(ce.symbol('x')), '_infer');
    try {
      diagnosticFlow(ce, program);
      expect(declare).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
      expect(infer).not.toHaveBeenCalled();
      expect(events.mock.calls.filter(([event]) => event.kind === 'type-write')).toEqual([]);
    } finally { declare.mockRestore(); assign.mockRestore(); events.mockRestore(); infer.mockRestore(); }
  });

  test('a legacy operator replacement invalidates diagnostic call interfaces', () => {
    const source = 'function h(x:integer){x}; h:=(u)=>"s"; h(u:3)';
    const result = executeEpsil(new ComputeEngine(), source);
    expect(result.value.json).toBe("'s'");
    expect(result.diagnostics).toEqual([]);
  });

  test('a tuple write discards prior-cell evidence for every written leaf', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let a=1.5; let b=0; let k=(n:integer)=>n');
    expect(check(ce, '(a,b):=(2,3); k(a)')).toEqual([]);
    expect(executeEpsil(ce, '(a,b):=(2,3); k(a)').value.json).toBe(2);
  });

  test('provisional named calls still canonicalize argument expressions', () => {
    const source = 'let f=(x:integer)=>x; f(x:"a"+1)';
    expect(check(new ComputeEngine(), source).some((d) => d.code === 'incompatible-type')).toBe(true);
    expect(executeEpsil(new ComputeEngine(), source).value.operator).toBe('Error');
    const before = 'let f=(x:integer)=>x; f(x:a); let a=1';
    expect(check(new ComputeEngine(), before).some((d) => d.code === 'read-before-declaration')).toBe(true);
  });

  test('literal evidence at a call does not rewrite the declared variable type', () => {
    const source = 'let k=(n:integer)=>n; let x:number=1.5; k(x)';
    const ce = new ComputeEngine();
    expect(check(ce, source).some((d) => d.code === 'incompatible-type')).toBe(true);
    expect(ce.lookupDefinition('x')).toBeUndefined();
  });
});

describe('Program publication and compile boundaries', () => {
  test('type registration is positional in a caller-owned scope', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const source = 'type alias Word=string; let w:Word="a"; w';
    expect(parsed(ce, source).evaluate().json).toBe("'a'");
    expect(executeEpsil(ce, 'w=3; w').value.json).toBe("'a'");
    expect(parsed(ce, 'do { type Nested=integer }; 5').evaluate().json).toBe(5);
    expect(ce._typeRegistry.Nested).toBeUndefined();
  });

  test('direct Program duplicate type declarations fail independently', () => {
    const ce = new ComputeEngine();
    expect(parsed(ce, 'type alias Word=string; type alias Word=integer; 5').evaluate().json).toBe(5);
    expect(ce.type('Word').matches('string')).toBe(true);
    expect(parsed(ce, 'type alias Word=integer; 6').evaluate().json).toBe(6);
    expect(ce.type('Word').matches('integer')).toBe(true);
  });

  test('compiled Programs reuse Block locals and publish no declarations', () => {
    const ce = new ComputeEngine();
    const program = parsed(ce, 'let x=42; x+sin(x/6)');
    const result = compile(program, { to: 'javascript', fallback: false });
    expect(result.success).toBe(true);
    expect(result.freeSymbols).toEqual([]);
    expect(result.run!()).toBeCloseTo(42 + Math.sin(7));
    expect(ce.symbol('x').value).toBeUndefined();
  });
});

describe('Program host hooks and cancellation', () => {
  test('a direct Program preserves its enclosing spent budget frame', () => {
    const ce = new ComputeEngine();
    const program = ce.box(['Program', 5]);
    ce.withStepBudget({ steps: 0 }, () => {
      const frame = ce._deadlineFrame;
      expect(program.evaluate().operator).toBe('Error');
      expect(ce.stepBudgetSpent).toBe(true);
      expect(ce.stepsLeft).toBe(-1);
      expect(ce._deadlineFrame).toBe(frame);
    });
    expect(ce._deadlineFrame).toBeUndefined();
  });

  test('an asynchronous direct Program contains its captured budget', async () => {
    const ce = new ComputeEngine();
    const program = ce.box(['Program', 5]);
    let pending: Promise<ReturnType<ComputeEngine['box']>> | undefined;
    let context: Parameters<ComputeEngine['withEvaluationContext']>[0];
    let frame: ComputeEngine['_deadlineFrame'];
    ce.withStepBudget({ steps: 0 }, () => {
      frame = ce._deadlineFrame;
      context = { _contextStack: beginAsyncEvaluation(ce, undefined).stack };
      pending = program.evaluateAsync(context);
      expect(ce._deadlineFrame).toBe(frame);
      return 0;
    });
    expect((await pending!).operator).toBe('Error');
    expect(ce._deadlineFrame).toBeUndefined();
    ce.withEvaluationContext(context, () => {
      expect(ce._deadlineFrame).toBe(frame);
      expect(ce.stepBudgetSpent).toBe(true);
      expect(ce.stepsLeft).toBe(-1);
    });
    expect(ce._deadlineFrame).toBeUndefined();
  });

  test.each([10, 2000])('a host value of depth %s cannot escape the value-walk backstop', (depth) => {
    const ce = new ComputeEngine();
    let value = ce.One;
    for (let i = 0; i < depth; i++) value = ce._fn('List', [value]);
    ce.declare('Deep', { signature: '()->list', evaluate: () => value });
    const result = executeEpsil(ce, 'Deep(); 5');
    expect(result.value.json).toBe(5);
    if (depth === 10) expect(result.diagnostics).toEqual([]);
    else expect(result.diagnostics.some((d) => d.message[0] === 'runtime-error')).toBe(true);
  });

  test('a deep error payload also stays inside the value-walk backstop', () => {
    const ce = new ComputeEngine();
    let value = ce.One;
    for (let i = 0; i < 2000; i++) value = ce._fn('List', [value]);
    ce.declare('Deep', { signature: '()->error', evaluate: () => ce._fn('Error', [ce.string('deep'), value]) });
    expect(executeEpsil(ce, 'Deep(); 5').value.json).toBe(5);
  });

  test('ordinary host throws fail only their own statement', () => {
    const ce = new ComputeEngine();
    ce.declare('Boom', { signature: '()->integer', pure: false, evaluate: () => { throw new Error('host failure'); } });
    const seen: number[] = [];
    expect(executeEpsil(ce, 'Boom(); 5', { onStatement: ({ index }) => seen.push(index) }).value.json).toBe(5);
    expect(seen).toEqual([0, 1]);
  });

  test('a host callback exception unwinds the Program', () => {
    const failure = new Error('stop');
    expect(() => executeEpsil(new ComputeEngine(), '1; 2', { onStatement: () => { throw failure; } })).toThrow(failure);
  });

  test('a nested debugger exception unwinds without running a sibling', () => {
    const source = 'do { 2 }; 5';
    const failure = new Error('terminated');
    setDebugStatementHook((statement) => {
      const offsets = (statement as { sourceOffsets: [number, number] }).sourceOffsets;
      if (source.slice(...offsets) === '2') throw failure;
    });
    expect(() => executeEpsil(new ComputeEngine(), source)).toThrow(failure);
  });

  test('asynchronous cancellation between statements rejects and restores hooks', async () => {
    const ce = new ComputeEngine();
    const controller = new AbortController();
    const seen: number[] = [];
    await expect(executeEpsilAsync(ce, '1; 2', { signal: controller.signal, onStatement: ({ index }) => { seen.push(index); controller.abort('stop'); } })).rejects.toHaveProperty('cause', 'stop');
    expect(seen).toEqual([0]);
    expect(ce._epsilStatementResultHook).toBeUndefined();
  });
});
