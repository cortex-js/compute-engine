import { ComputeEngine } from '../../src/compute-engine';
import { executeCortex } from '../../src/cortex/execute-cortex';
import { parseCortex } from '../../src/cortex/parse-cortex';
import { serializeCortex } from '../../src/cortex/serialize-cortex';
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

describe('Cortex `.` grammar', () => {
  test('p.x lowers to Field', () => {
    const [ast, diags] = parseCortex('p.x');
    expect(diags).toEqual([]);
    expect(JSON.parse(JSON.stringify(ast)).fn).toEqual([
      'Field',
      { sym: 'p', sourceOffsets: [0, 1] },
      { str: 'x' },
    ]);
  });

  test('chains left-associate: a.b.c', () => {
    const [ast, diags] = parseCortex('a.b.c');
    expect(diags).toEqual([]);
    const fn = JSON.parse(JSON.stringify(ast)).fn;
    expect(fn[0]).toBe('Field');
    expect(fn[2]).toEqual({ str: 'c' });
    expect(fn[1].fn[0]).toBe('Field');
    expect(fn[1].fn[2]).toEqual({ str: 'b' });
  });

  test('2.x stays invisible multiplication (the lexer owns the dot)', () => {
    const [ast, diags] = parseCortex('2.x');
    expect(diags).toEqual([]);
    expect(JSON.parse(JSON.stringify(ast)).fn[0]).toBe('Multiply');
  });

  test('the range operator is untouched: 1..5', () => {
    const [ast, diags] = parseCortex('1..5');
    expect(diags).toEqual([]);
    expect(JSON.parse(JSON.stringify(ast)).fn[0]).toBe('Range');
  });

  test('the dot must abut the base: `p .x` ends the expression', () => {
    const [, diags] = parseCortex('p .x');
    expect(diags.length).toBeGreaterThan(0);
  });

  test('positional access is not claimed: t.1 diagnoses', () => {
    const [, diags] = parseCortex('t.1');
    expect(diags.length).toBeGreaterThan(0);
  });

  test('a call on a field value: p.x(2) → Apply(Field(p, "x"), 2)', () => {
    const [ast, diags] = parseCortex('p.x(2)');
    expect(diags).toEqual([]);
    const fn = JSON.parse(JSON.stringify(ast)).fn;
    expect(fn[0]).toBe('Apply');
    expect(fn[1].fn[0]).toBe('Field');
  });

  test('serialization round-trips: p.x + q.y', () => {
    const [ast] = parseCortex('p.x + q.y');
    expect(serializeCortex(ast!)).toBe('p.x + q.y');
  });
});

describe('Field on records and dictionaries (`d.x` ≡ `d["x"]`)', () => {
  test('present key, absent key (absence marker), and At parity', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
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
    const r = executeCortex(
      ce,
      `type circle = record<x: number, y: number, r: number>
function circle(x, y, r) { {x -> x, y -> y, r -> r} }
const c = circle(1, 2, 3)
(c.x, c.y, c.r)`
    );
    expect(r.diagnostics ?? []).toEqual([]);
    expect(r.value!.toString()).toBe('(1, 2, 3)');
  });

  test('named-tuple-bodied nominal: fields resolve by position', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
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
    const r = executeCortex(
      ce,
      `type pt = tuple<x: number, y: number>
const p = pt(1, 2)
p.z`
    );
    expect(r.value!.toString()).toContain('unknown-field');
  });

  test('D3 upheld: Field does NOT unlock collection access', () => {
    const ce = new ComputeEngine();
    executeCortex(
      ce,
      `type pt = tuple<x: number, y: number>
const p = pt(1, 2)`
    );
    expect(executeCortex(ce, 'First(p)').value!.operator).toBe('Error');
    expect(executeCortex(ce, 'p["x"]').value!.operator).toBe('Error');
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
    const r = executeCortex(
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
    expect(() => js.compile(d)).toThrow(/At: cannot compile/);
  });

  test('JS: a record-bodied nominal operand declines cleanly', () => {
    const ce = new ComputeEngine();
    ce.declareType('circle', 'record<x: number, y: number, r: number>');
    ce.declare('c', 'circle');
    const js = new JavaScriptTarget();
    expect(() => js.compile(ce.box(['Field', 'c', { str: 'x' }]))).toThrow(
      /Field/
    );
  });
});
