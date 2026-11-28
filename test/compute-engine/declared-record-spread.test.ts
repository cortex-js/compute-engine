import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The spread copy of a value of a declared record type (CE-1913). The copy
// `{...f, kind -> "x"}` is a plain record with the fields of `f`; it is not a
// `Fig`, because only the constructor of the type makes a `Fig`. The
// constructor tags the copy again: `Fig({...f, kind -> "x"})`.
//

const FIG = `type Fig = record{__tag: string, kind: string, geom: tuple<real, real>}
function Fig(kind: string, x: real, y: real) { {__tag -> "Figure", kind -> kind, geom -> (x, y)} }
`;

function run(source: string) {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, FIG + source);
  return { diagnostics: r.diagnostics ?? [], value: r.value! };
}

const COPY = [
  'Dictionary',
  ['KeyValuePair', { str: '__tag' }, "'Figure'"],
  ['KeyValuePair', { str: 'kind' }, "'x'"],
  ['KeyValuePair', { str: 'geom' }, ['Tuple', 2, 0]],
];

describe('the spread copy of a value of a declared record type', () => {
  test('the witness: a function that copies a local of the type', () => {
    const { diagnostics, value } = run(
      `function sp(t: real) { let f = Fig("dot", t, 0); {...f, kind -> "x"} }
sp(2)`
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(COPY);
    expect(value.type.toString()).toBe(
      'record{__tag: string, kind: string, geom: tuple<integer, integer>}'
    );
  });

  test('the spread literal has a record type, not the type Fig', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, FIG + `let f = Fig("dot", 2, 0)`);
    const literal = ce.box([
      'Dictionary',
      ['Spread', 'f'],
      ['KeyValuePair', { str: 'kind' }, { str: 'x' }],
    ]);
    expect(literal.type.toString()).toBe(
      'record{__tag: string, kind: string, geom: tuple<real, real>}'
    );
    expect(literal.evaluate().json).toEqual(COPY);
  });

  test('a parameter with no declared type that holds a Fig', () => {
    const { value } = run(
      `function h(t) { {...t, kind -> "x"} }
h(Fig("dot", 2, 0))`
    );
    expect(value.json).toEqual(COPY);
  });

  test('a value of a type defined as Fig is read through both layers', () => {
    const { value } = run(
      `type W = Fig
let w = W(Fig("dot", 2, 0))
{...w, kind -> "x"}`
    );
    expect(value.json).toEqual(COPY);
  });

  test('the constructor of the type tags the copy again', () => {
    const { diagnostics, value } = run(
      `function mv(t: real) { let f = Fig("dot", t, 0); Fig({...f, kind -> "x"}) }
mv(2)`
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual(['Fig', COPY]);
    expect(value.type.toString()).toBe('Fig');
  });

  test('the constructor refuses a copy whose field has the wrong type', () => {
    const { diagnostics, value } = run(
      `let f = Fig("dot", 2, 0)
Fig({...f, kind -> 3})`
    );
    expect(diagnostics.map((d) => d.code)).toContain('incompatible-type');
    expect(value.operator).toBe('Error');
  });

  test('an optional field that the value leaves out stays out of the copy', () => {
    const { value } = run(
      `type Opt = record{a: integer, b: string?}
function Opt(a: integer) { {a -> a} }
let o = Opt(3)
{...o, c -> 1}`
    );
    expect(value.json).toEqual({ dict: { a: 3, c: 1 } });
  });

  test('an optional field after a field of the same name leaves the type to the declared result', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      `type Opt = record{a: integer, b: string?}
function Opt(a: integer) { {a -> a} }
let o = Opt(3)`
    );
    const literal = ce.box([
      'Dictionary',
      ['KeyValuePair', { str: 'b' }, { str: 'z' }],
      ['Spread', 'o'],
    ]);
    // `o` can hold a `b` or not, so the type cannot tell which `b` the copy
    // holds.
    expect(literal.type.toString()).toBe('dictionary');
    // `o` has no `b`, so the merge keeps `b -> "z"`.
    expect(literal.evaluate().json).toEqual({ dict: { b: 'z', a: 3 } });
  });

  test('a local made with the copy of a Fig has the record type of the copy', () => {
    const { diagnostics } = run(
      `function more(c: boolean) {
  let g = {...Fig("dot", 2, 0), kind -> "x"}
  if c { g = {...g, alpha -> 1} }
  g
}
more(true)`
    );
    // As for a local made with a dictionary literal (`let g = {a -> 1}`), a
    // later value with more fields does not match the type of the local.
    expect(diagnostics.map((d) => d.code)).toEqual([
      'assignment-type-mismatch',
    ]);
  });

  test('DictionaryFrom refuses a malformed first element before it walks the rest', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['DictionaryFrom', ['Range', 1, 1e9]]).evaluate();
    expect(r.operator).toBe('Error');
  });

  test('the spread of a plain record keeps the type dictionary', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, `let d = {a -> 1}`);
    const literal = ce.box([
      'Dictionary',
      ['Spread', 'd'],
      ['KeyValuePair', { str: 'b' }, 2],
    ]);
    expect(literal.type.toString()).toBe('dictionary');
  });

  test('a local made with the spread of a plain record takes more fields later', () => {
    const { diagnostics, value } = run(
      `function f(c: boolean) {
  let defaults = {a -> 1}
  let opts = {...defaults, b -> 2}
  if c { opts = {...opts, color -> "red"} }
  opts
}
f(true)`
    );
    expect(diagnostics).toEqual([]);
    expect(value.json).toEqual({ dict: { a: 1, b: 2, color: 'red' } });
  });
});
