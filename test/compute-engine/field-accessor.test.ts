import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

//
// The `.` accessor and the `Field` operator (nominal-types design §4.5b D16):
// `p.x` is a postfix field clause lowering to `["Field", p, "x"]`. On records
// and dictionaries `d.x` ≡ `d["x"]` (`At` semantics, absence markers
// included); on a NOMINAL type with a named-field body the field resolves
// through the type definition — the sanctioned accessor window (D3 upheld:
// collection access keeps rejecting).
//

describe('Epsil `.` grammar', () => {
  test('p.x lowers to Field', () => {
    const [ast, diags] = parseEpsil('p.x');
    expect(diags).toEqual([]);
    expect(JSON.parse(JSON.stringify(ast)).fn).toEqual([
      'Field',
      { sym: 'p', sourceOffsets: [0, 1] },
      { str: 'x' },
    ]);
  });

  test('chains left-associate: a.b.c', () => {
    const [ast, diags] = parseEpsil('a.b.c');
    expect(diags).toEqual([]);
    const fn = JSON.parse(JSON.stringify(ast)).fn;
    expect(fn[0]).toBe('Field');
    expect(fn[2]).toEqual({ str: 'c' });
    expect(fn[1].fn[0]).toBe('Field');
    expect(fn[1].fn[2]).toEqual({ str: 'b' });
  });

  test('2.x stays invisible multiplication (the lexer owns the dot)', () => {
    const [ast, diags] = parseEpsil('2.x');
    expect(diags).toEqual([]);
    expect(JSON.parse(JSON.stringify(ast)).fn[0]).toBe('Multiply');
  });

  test('the range operator is untouched: 1..5', () => {
    const [ast, diags] = parseEpsil('1..5');
    expect(diags).toEqual([]);
    expect(JSON.parse(JSON.stringify(ast)).fn[0]).toBe('Range');
  });

  test('the dot must abut the base: `p .x` ends the expression', () => {
    const [, diags] = parseEpsil('p .x');
    expect(diags.length).toBeGreaterThan(0);
  });

  test('positional access is not claimed: t.1 diagnoses', () => {
    const [, diags] = parseEpsil('t.1');
    expect(diags.length).toBeGreaterThan(0);
  });

  test('a call on a field value: p.x(2) → Apply(Field(p, "x"), 2)', () => {
    const [ast, diags] = parseEpsil('p.x(2)');
    expect(diags).toEqual([]);
    const fn = JSON.parse(JSON.stringify(ast)).fn;
    expect(fn[0]).toBe('Apply');
    expect(fn[1].fn[0]).toBe('Field');
  });

  test('serialization round-trips: p.x + q.y', () => {
    const [ast] = parseEpsil('p.x + q.y');
    expect(serializeEpsil(ast!)).toBe('p.x + q.y');
  });
});

describe('Field on records and dictionaries (`d.x` ≡ `d["x"]`)', () => {
  test('present key, absent key (absence marker), and At parity', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `const d = {a -> 10, b -> 20}
(d.a, d["a"], d.zz)`
    );
    expect(r.diagnostics ?? []).toEqual([]);
    expect(r.value!.toString()).toBe('(10, 10, NaN)');
  });
});

describe('Field on nominal types (the sanctioned accessor window)', () => {
  test('record-bodied nominal: fields come from the payload', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `type circle = record{x: number, y: number, r: number}
function circle(x, y, r) { {x -> x, y -> y, r -> r} }
const c = circle(1, 2, 3)
(c.x, c.y, c.r)`
    );
    expect(r.diagnostics ?? []).toEqual([]);
    expect(r.value!.toString()).toBe('(1, 2, 3)');
  });

  test('named-tuple-bodied nominal: fields resolve by position', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `type pt = tuple<x: number, y: number>
const p = pt(1, 2)
(p.x, p.y)`
    );
    expect(r.diagnostics ?? []).toEqual([]);
    expect(r.value!.toString()).toBe('(1, 2)');
  });

  test('an unknown field is an error value', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `type pt = tuple<x: number, y: number>
const p = pt(1, 2)
p.z`
    );
    expect(r.value!.toString()).toContain('unknown-field');
  });

  test('D3 upheld: Field does NOT unlock collection access', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      `type pt = tuple<x: number, y: number>
const p = pt(1, 2)`
    );
    expect(executeEpsil(ce, 'First(p)').value!.operator).toBe('Error');
    expect(executeEpsil(ce, 'p["x"]').value!.operator).toBe('Error');
  });

  test('an unknown-typed operand stays symbolic', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Field', 'q', { str: 'x' }]).evaluate();
    expect(f.operator).toBe('Field');
  });

  test('a SETTLED non-field-bearing operand is a static defect (error, not inert)', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'number');
    const f = ce.box(['Field', 'n', { str: 'x' }]);
    expect(f.type.toString()).toBe('error');
    expect(f.evaluate().operator).toBe('Error');
    // A scalar-bodied nominal is settled too: `meters` has no fields.
    ce.declareType('meters', 'number');
    ce.declare('m', 'meters');
    expect(ce.box(['Field', 'm', { str: 'x' }]).evaluate().operator).toBe(
      'Error'
    );
  });

  test('an absent base propagates the marker through a chain (At parity)', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `const d = {a -> {b -> 1}}
(d.zz.x, d["zz"]["x"])`
    );
    expect(r.diagnostics ?? []).toEqual([]);
    expect(r.value!.toString()).toBe('("Missing", "Missing")');
  });
});

describe('Field compile lowering (D16/§4.6)', () => {
  test('GLSL: a named-tuple nominal operand lowers to a positional swizzle', () => {
    const ce = new ComputeEngine();
    ce.declareType('pt', 'tuple<x: number, y: number>');
    ce.declare('p', 'pt');
    const glsl = new GLSLTarget();
    expect(glsl.compile(ce.box(['Field', 'p', { str: 'y' }])).code).toBe('p.y');
    // By POSITION, not by name: fields named u/v still hit .x/.y.
    ce.declareType('uv', 'tuple<u: number, v: number>');
    ce.declare('q', 'uv');
    expect(glsl.compile(ce.box(['Field', 'q', { str: 'u' }])).code).toBe('q.x');
  });

  test('JS: a plain dictionary operand declines with At´s own diagnostic (parity)', () => {
    const ce = new ComputeEngine();
    const js = new JavaScriptTarget();
    const d = ce.box([
      'Field',
      ['Dictionary', ['KeyValuePair', { str: 'a' }, 10]],
      { str: 'a' },
    ]);
    // `constantFold: false`: the dictionary literal has no free variables, so
    // compile-time constant folding would emit `10` and the `At` decline this
    // test pins would never be reached.
    expect(() => js.compile(d, { constantFold: false })).toThrow(
      /At: cannot compile/
    );
  });

  test('JS: a record-bodied nominal operand declines cleanly', () => {
    const ce = new ComputeEngine();
    ce.declareType('circle', 'record{x: number, y: number, r: number}');
    ce.declare('c', 'circle');
    const js = new JavaScriptTarget();
    expect(() => js.compile(ce.box(['Field', 'c', { str: 'x' }]))).toThrow(
      /Field/
    );
  });

  test('JS: a typed body LOCAL resolves through the declared-type map', () => {
    // A canonical function body's locals are unbound, so the receiver of
    // `q.y` types `unknown` and the Field compile handler — which resolves
    // named-tuple fields positionally from the receiver's static type —
    // declined, while the same read on a PARAMETER compiled. The declared
    // type now comes from `CompileTarget.declaredVarTypes` (the protocol
    // GET/SET fallback), for block locals and loop-body locals alike.
    const {
      compile,
    } = require('../../src/compute-engine/compilation/compile-expression');
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `type pt = tuple<x: integer, y: integer>
function g(p: pt) -> integer {
  let q: pt = p
  q.y
}
function h() -> integer {
  let acc = 0
  for i in 1..3 {
    let q: pt = pt(i, 10 * i)
    acc = acc + q.y
  }
  acc
}`
    ).diagnostics;
    expect(r).toEqual([]);
    const g = compile(ce.box('g'));
    expect(g.success).toBe(true);
    expect(g.run?.()([3, 4])).toBe(4);
    const h = compile(ce.box('h'));
    expect(h.success).toBe(true);
    expect(h.run?.()()).toBe(60);
    expect(ce.box(['h'] as any).evaluate().toString()).toBe('60');
    // An UNTYPED local still fails closed (no declared entry to read).
    const u = executeEpsil(
      ce,
      `function u(p: pt) -> unknown {
  let q = p
  q.y
}`
    ).diagnostics;
    expect(u).toEqual([]);
    expect(compile(ce.box('u')).success).toBe(false);
  });

  test('JS: a NESTED field chain on a typed local resolves too', () => {
    // `q.inner.y` — the outer Field's receiver is another Field, so the
    // receiver chain is rebuilt from its ascribed root: each intermediate
    // access then resolves statically (it used to fail closed while the
    // one-level `q.y` compiled).
    const {
      compile,
    } = require('../../src/compute-engine/compilation/compile-expression');
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `type pt = tuple<x: integer, y: integer>
type seg = tuple<inner: pt, w: integer>
function g(s: seg) -> integer {
  let q: seg = s
  q.inner.y
}`
    ).diagnostics;
    expect(r).toEqual([]);
    const g = compile(ce.box('g'));
    expect(g.success).toBe(true);
    expect(g.run?.()([[3, 4], 9])).toBe(4);
  });
});

//
// Phase 3 of the parameterized-nominal design
// (`docs/TYPE-SYSTEM.md`): a field
// is read off the body INSTANTIATED at the reference's arguments. One
// substitution against a finite body — the nested `tree<T>` becomes
// `tree<integer>` and stays an UNEXPANDED reference, which is why recursion
// costs nothing here.
//

describe('Field at an instantiated parameterized nominal body (§6)', () => {
  /** `type tree<T> = tuple<value: T, children: list<tree<T>>>`, unannotated
   * (so `out` by the verified default). */
  function treeEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareType('tree', 'tuple<value: T, children: list<tree<T>>>', {
      typeParams: ['T'],
    });
    return ce;
  }

  test('the field TYPE is the parameter substituted at the argument', () => {
    const ce = treeEngine();
    ce.declare('t', 'tree<integer>');
    expect(ce.box(['Field', 't', { str: 'value' }]).type.toString()).toBe(
      'integer'
    );
  });

  test('the recursive field stays ONE LEVEL DEEP: list<tree<integer>>', () => {
    const ce = treeEngine();
    ce.declare('t', 'tree<integer>');
    // NOT the expanded body: the nested reference keeps its arguments.
    expect(ce.box(['Field', 't', { str: 'children' }]).type.toString()).toBe(
      'list<tree<integer>>'
    );
  });

  test('the field VALUE is the payload', () => {
    const ce = treeEngine();
    const t = ['tree', 1, ['List', ['tree', 2, ['List']]]] as const;
    expect(ce.box(['Field', t, { str: 'value' }]).evaluate().toString()).toBe(
      '1'
    );
    expect(
      ce.box(['Field', t, { str: 'children' }]).evaluate().toString()
    ).toBe('[tree(2, [])]');
  });

  test('a 3-deep tree reads at every level, by field and by chain', () => {
    const ce = treeEngine();
    const r = executeEpsil(
      ce,
      `let t = tree(1, [tree(2, [tree(3, [])])])
(t.value, t.children[1].value, t.children[1].children[1].value)`
    );
    expect(r.diagnostics ?? []).toEqual([]);
    expect(r.value!.toString()).toBe('(1, 2, 3)');
    expect(r.value!.type.toString()).toBe(
      'tuple<finite_integer, finite_integer, finite_integer>'
    );
  });

  test('the Epsil `.` route agrees with the host route', () => {
    const ce = treeEngine();
    const r = executeEpsil(ce, `let t = tree(7, [])\nt.value`);
    expect(r.diagnostics ?? []).toEqual([]);
    expect(r.value!.toString()).toBe('7');
    expect(r.value!.type.toString()).toBe('7');
  });

  test('a CONTRAVARIANT occurrence instantiates too: (integer) -> boolean', () => {
    const ce = new ComputeEngine();
    ce.declareType('pred', 'tuple<run: (T) -> boolean>', {
      typeParams: [{ name: 'T', variance: 'in' }],
    });
    ce.declare('p', 'pred<integer>');
    expect(ce.box(['Field', 'p', { str: 'run' }]).type.toString()).toBe(
      '(integer) -> boolean'
    );
  });

  test('co- and contravariant occurrences in ONE body both instantiate', () => {
    const ce = new ComputeEngine();
    ce.declareType('events', 'tuple<log: list<T>, notify: (T) -> boolean>', {
      typeParams: [{ name: 'T', variance: 'inout' }],
    });
    ce.declare('e', 'events<integer>');
    expect(ce.box(['Field', 'e', { str: 'log' }]).type.toString()).toBe(
      'list<integer>'
    );
    expect(ce.box(['Field', 'e', { str: 'notify' }]).type.toString()).toBe(
      '(integer) -> boolean'
    );
  });

  test('a record-bodied parameterized nominal instantiates as well', () => {
    const ce = new ComputeEngine();
    ce.declareType('bag', 'record{one: T, many: list<T>}', {
      typeParams: ['T'],
    });
    ce.declare('b', 'bag<string>');
    expect(ce.box(['Field', 'b', { str: 'one' }]).type.toString()).toBe(
      'string'
    );
    expect(ce.box(['Field', 'b', { str: 'many' }]).type.toString()).toBe(
      'list<string>'
    );
  });

  test('an ALIAS chain onto an application instantiates through the chain', () => {
    const ce = new ComputeEngine();
    ce.declareType('holder', 'tuple<item: T>', { typeParams: ['T'] });
    ce.declareType('intHolder', 'holder<integer>');
    ce.declare('h', 'intHolder');
    expect(ce.box(['Field', 'h', { str: 'item' }]).type.toString()).toBe(
      'integer'
    );
  });

  test('GLSL compile: an applied nominal still swizzles by position', () => {
    const ce = new ComputeEngine();
    ce.declareType('pair', 'tuple<x: T, y: T>', { typeParams: ['T'] });
    ce.declare('p', 'pair<number>');
    const glsl = new GLSLTarget();
    expect(glsl.compile(ce.box(['Field', 'p', { str: 'y' }])).code).toBe('p.y');
  });

  test('regression: a NON-parameterized nominal and a plain named tuple are unchanged', () => {
    const ce = new ComputeEngine();
    ce.declareType('pt', 'tuple<x: number, y: number>');
    ce.declare('q', 'pt');
    expect(ce.box(['Field', 'q', { str: 'x' }]).type.toString()).toBe('number');
    // A plain (un-nominal) named tuple resolves without any reference hop.
    ce.declare('raw', 'tuple<u: string, v: number>');
    expect(ce.box(['Field', 'raw', { str: 'u' }]).type.toString()).toBe(
      'string'
    );
    const r = executeEpsil(ce, `const p = pt(1, 2)\n(p.x, p.y)`);
    expect(r.diagnostics ?? []).toEqual([]);
    expect(r.value!.toString()).toBe('(1, 2)');
  });
});
