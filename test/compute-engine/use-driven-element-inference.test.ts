import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// Use-driven element inference (Phase 3 of `docs/INFERENCE_ROADMAP.md`;
// design and rulings in that document's §5).
//
// A requirement on an element taken out of a collection is a requirement on
// the collection's ELEMENTS: `xs[1] + 1` requires `number` of `xs[1]`, so `xs`
// learns `indexed_collection<number>`. The write goes through the operator's
// `inferOperandTypes` handler (`At`, `First`, `Second`, `Third`, `Last`) and
// the ordinary symbol inference path, so it obeys every rule that path
// already has: an inferred or unknown type moves, a declared one never does,
// a symbol with assignment evidence is checked instead of rewritten, and the
// write is journaled for rollback and confined by a speculative parse.
//
// Three rulings pinned here (2026-09-05):
//  R1 an arithmetic use writes the SCALAR reading (`number`), exactly as
//     `x + 1` infers a bare `x` as `number` — not `broadcastable<number>`;
//  R2 every value requirement writes, a boolean one included, so a later
//     numeric use of the same element is an `incompatible-type` error at
//     canonicalization, as it is for a scalar after `And(x, B)`;
//  R3 a DECLARED bare placeholder (`let a: list`) does not refine from a use
//     in this delivery.
//

const typeOf = (ce: ComputeEngine, name: string) =>
  ce.box(name).type.toString();

describe('the six programs of the plan (box route)', () => {
  test('xs[1] + 1 refines the element to number, and the read then types number', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', ['At', 'xs', 1], 1]);
    expect(typeOf(ce, 'xs')).toBe('indexed_collection<number>');
    expect(ce.box(['At', 'xs', 1]).type.toString()).toBe('number');
    // Dispatch visibility: the refined element is what later
    // canonicalizations read.
    expect(ce.box(['Power', ['At', 'xs', 1], 2]).type.toString()).toBe(
      'number'
    );
  });

  test('a numeric function argument refines the same way', () => {
    const ce = new ComputeEngine();
    ce.box(['Sin', ['At', 's1', 1]]);
    expect(typeOf(ce, 's1')).toBe('indexed_collection<number>');
  });

  test('a non-broadcasting typed parameter writes its own type', () => {
    const ce = new ComputeEngine();
    ce.declare('k', { type: '(integer) -> integer' });
    ce.box(['k', ['At', 'k1', 1]]);
    expect(typeOf(ce, 'k1')).toBe('indexed_collection<integer>');
  });

  test('First/Second/Third/Last write indexed_collection<r>', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', ['First', 'f1'], 1]);
    ce.box(['Add', ['Second', 'f2'], 1]);
    ce.box(['Add', ['Third', 'f3'], 1]);
    ce.box(['Add', ['Last', 'f4'], 1]);
    for (const n of ['f1', 'f2', 'f3', 'f4'])
      expect(typeOf(ce, n)).toBe('indexed_collection<number>');
  });

  test('a chained access reaches the outer collection through the forwarding', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', ['At', ['At', 'm', 1], 2], 1]);
    expect(typeOf(ce, 'm')).toBe(
      'indexed_collection<indexed_collection<number>>'
    );
  });

  test('a lambda parameter carries the refinement on the arrow', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', ['At', 'v', 1], 1], 'v']);
    expect(f.type.toString()).toBe(
      '(v: indexed_collection<number>) -> broadcastable<number>'
    );
  });
});

describe('route parity', () => {
  test('parse route: y[1] + 1', () => {
    const ce = new ComputeEngine();
    ce.parse('y[1] + 1');
    expect(typeOf(ce, 'y')).toBe('indexed_collection<number>');
  });

  test('Epsil route: a lambda and a named function', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let f = (v) => v[1] + 1');
    expect(typeOf(ce, 'f')).toBe(
      '(v: indexed_collection<number>) -> broadcastable<number>'
    );
    executeEpsil(ce, 'function g(a) { First(a) + 1 }');
    expect(typeOf(ce, 'g')).toBe('(indexed_collection<number>) -> number');
  });
});

describe('the index kind selects the arm', () => {
  test('a string index writes the dictionary arm only', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', ['At', 'd1', { str: 'a' }], 1]);
    expect(typeOf(ce, 'd1')).toBe('dictionary<number>');
  });

  test('a symbolic index of open kind keeps both arms', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', ['At', 'i1', 'j'], 1]);
    expect(typeOf(ce, 'i1')).toBe(
      'dictionary<number> | indexed_collection<number>'
    );
    // The read still types from the union: both arms carry `number`.
    expect(ce.box(['At', 'i1', 'j']).type.toString()).toBe('number');
    // The index symbol keeps the index slot's own type.
    expect(typeOf(ce, 'j')).toBe(
      'boolean | indexed_collection<any> | number | string'
    );
  });

  test('a gather index names the elements and writes the indexed arm only', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', ['At', 'g1', ['List', 1, 2]], 1]);
    expect(typeOf(ce, 'g1')).toBe('indexed_collection<number>');
    // The gather itself still reads as a LIST of the refined elements (the
    // out-of-range marker of a numeric element is `nan`, inside `number`).
    expect(ce.box(['At', 'g1', ['List', 1, 2]]).type.toString()).toBe(
      'list<number>'
    );
  });

  test('a string key is a keyed lookup, never a possible gather', () => {
    const ce = new ComputeEngine();
    ce.declare('kl', { type: '(list<real>) -> real' });
    ce.box(['kl', ['At', 'd2', { str: 'a' }]]);
    expect(typeOf(ce, 'd2')).toBe('dictionary<list<real>>');
  });

  test('a union base with a record arm reads the field values, not the iteration pair', () => {
    const ce = new ComputeEngine();
    ce.declare('ru', {
      type: 'record{a: integer} | indexed_collection<integer>',
    });
    expect(ce.box(['At', 'ru', 1]).type.toString()).toBe('integer | nan');
  });
});

describe('a collection-typed requirement', () => {
  test('under a provably scalar index the elements ARE collections', () => {
    const ce = new ComputeEngine();
    ce.declare('kl', { type: '(list<real>) -> real' });
    ce.box(['kl', ['At', 'w1', 1]]);
    expect(typeOf(ce, 'w1')).toBe('indexed_collection<list<real>>');
  });

  test('under an index that could be a gather it is ambiguous and declined', () => {
    const ce = new ComputeEngine();
    ce.declare('kl', { type: '(list<real>) -> real' });
    ce.box(['kl', ['At', 'w2', 'jj']]);
    expect(typeOf(ce, 'w2')).toBe('dictionary<any> | indexed_collection<any>');
  });
});

describe('declined and guarded cases', () => {
  test('a multi-index access writes nothing', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', ['At', 'm2', 1, 2], 1]);
    expect(typeOf(ce, 'm2')).toBe('dictionary<any> | indexed_collection<any>');
  });

  test('an `any`-typed consumer carries no requirement', () => {
    const ce = new ComputeEngine();
    ce.box(['Length', ['At', 'n1', 1]]);
    expect(typeOf(ce, 'n1')).toBe('dictionary<any> | indexed_collection<any>');
  });

  test('a symbol with assignment evidence is not rewritten', () => {
    const ce = new ComputeEngine();
    ce.assign('h1', ce.box(['List', 1, { str: 'x' }]));
    const e = ce.box(['Add', ['At', 'h1', 1], 1]);
    expect(typeOf(ce, 'h1')).toBe('list<integer | string>');
    expect(e.evaluate().toString()).toBe('2');
  });

  test('R3: a declared bare placeholder and a declared contract do not move', () => {
    const ce = new ComputeEngine();
    ce.declare('p1', { type: 'list' });
    ce.declare('c1', { type: 'list<any>' });
    ce.box(['Add', ['At', 'p1', 1], 1]);
    ce.box(['Add', ['At', 'c1', 1], 1]);
    expect(typeOf(ce, 'p1')).toBe('list');
    expect(typeOf(ce, 'c1')).toBe('list<any>');
  });

  test('the write is revisable: a later assignment replaces it', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', ['At', 'xs', 1], 1]);
    expect(typeOf(ce, 'xs')).toBe('indexed_collection<number>');
    ce.assign('xs', ce.box(['List', { str: 'a' }, { str: 'b' }]));
    expect(typeOf(ce, 'xs')).toBe('list<string^2>');
    // …and the assigned evidence now refuses the numeric use.
    expect(ce.box(['Add', ['At', 'xs', 1], 1]).isValid).toBe(false);
  });

  test('a speculative parse leaves no write', () => {
    const ce = new ComputeEngine();
    // A single-letter name: in LaTeX `sp` is the product `s·p`.
    ce.parse('w[1] + 1', { speculative: true });
    expect(ce.lookupDefinition('w')).toBeUndefined();
    ce.parse('w[1] + 1');
    expect(typeOf(ce, 'w')).toBe('indexed_collection<number>');
  });

  test('the write is journaled: a rolled-back frame restores the type', () => {
    const ce = new ComputeEngine();
    ce.box('rb');
    expect(typeOf(ce, 'rb')).toBe('unknown');
    ce._withBoxingPassWindow(() =>
      ce._withRolledBackInference(() => {
        ce.box(['Add', ['At', 'rb', 1], 1]);
        expect(typeOf(ce, 'rb')).toBe('indexed_collection<number>');
      })
    );
    expect(typeOf(ce, 'rb')).toBe('unknown');
  });
});

describe('R2: a boolean use commits the element like a scalar', () => {
  test('And(b[1], B) writes a boolean element; a later numeric use is an error', () => {
    const ce = new ComputeEngine();
    ce.box(['And', ['At', 'b1', 1], 'B']);
    expect(typeOf(ce, 'b1')).toBe('indexed_collection<boolean>');
    const e = ce.box(['Add', ['At', 'b1', 1], 1]);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toContain('incompatible-type');
    // The conflicting requirement wrote nothing.
    expect(typeOf(ce, 'b1')).toBe('indexed_collection<boolean>');
  });

  test('the same conflict through a two-arm base', () => {
    const ce = new ComputeEngine();
    ce.box(['And', ['At', 'i2', 'j2'], 'B']);
    expect(typeOf(ce, 'i2')).toBe(
      'dictionary<boolean> | indexed_collection<boolean>'
    );
    expect(ce.box(['Add', ['At', 'i2', 'j2'], 1]).isValid).toBe(false);
    expect(typeOf(ce, 'i2')).toBe(
      'dictionary<boolean> | indexed_collection<boolean>'
    );
  });
});

describe('the numeric short path refuses a non-numeric carrier behind an absence arm', () => {
  // Found while pinning R2: `Sin(q)` refused `q: boolean | missing` (the
  // definition route strips the absence arm and validates the carrier) while
  // `q + 1`, `-q` and `√q` admitted it. The two routes now agree.
  test('boolean | missing and string | missing are refused', () => {
    const ce = new ComputeEngine();
    ce.declare('q', { type: 'boolean | missing' });
    ce.declare('sq', { type: 'string | missing' });
    expect(ce.box(['Add', 'q', 1]).isValid).toBe(false);
    expect(ce.box(['Negate', 'q']).isValid).toBe(false);
    expect(ce.box(['Sqrt', 'q']).isValid).toBe(false);
    expect(ce.box(['Sin', 'q']).isValid).toBe(false);
    expect(ce.box(['Add', 'sq', 1]).isValid).toBe(false);
  });

  test('a carrier that could still be numeric is admitted as before', () => {
    const ce = new ComputeEngine();
    ce.declare('uq', { type: 'unknown | missing' });
    ce.declare('lq', { type: 'list<number> | missing' });
    ce.declare('mq', { type: 'missing' });
    for (const n of ['uq', 'lq', 'mq'])
      expect(ce.box(['Add', n, 1]).isValid).toBe(true);
  });

  test('a POINT behind an absence arm is refused, like a bare point', () => {
    // A scalar does not add to a tuple at any component, and reading the
    // operand's type exactly let an absence arm hide that: the rejection now
    // reads through `missing` and across a union of numeric tuple spellings,
    // so `tuple<number, number> | missing` is refused exactly as
    // `tuple<number, number>` is. A scalar MULTIPLE of such a point stays
    // admitted, since it scales the vector.
    const ce = new ComputeEngine();
    ce.declare('tq', { type: 'tuple<number, number> | missing' });
    expect(ce.box(['Add', 'tq', 1]).isValid).toBe(false);
    expect(ce.box(['Multiply', 'tq', 2]).isValid).toBe(true);
  });
});

describe('the compiled route reads the refined type', () => {
  test('a numeric element that is a list at run time fails loudly, not as a string', () => {
    // Ruled 2026-09-05: the compiler trusts a static element type, declared
    // or inferred; a matrix handed to a kernel compiled for a list of numbers
    // used to return the concatenated string `"1,21"`.
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', ['Add', ['At', 'v', 1], 1], 'v']));
    const compiled = compile(ce.box(['h', 'xs'])) as unknown as
      | { run: (env: unknown) => unknown }
      | ((env: unknown) => unknown);
    const run = typeof compiled === 'function' ? compiled : compiled.run;
    expect(run({ xs: [1, 2, 3] })).toBe(2);
    expect(() =>
      run({
        xs: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toThrow(/static element type/);
    // The same check guards a DECLARED numeric element type.
    ce.declare('yd', { type: 'indexed_collection<number>' });
    const top = compile(ce.box(['Add', ['At', 'yd', 1], 1])) as unknown as
      | { run: (env: unknown) => unknown }
      | ((env: unknown) => unknown);
    const runTop = typeof top === 'function' ? top : top.run;
    expect(runTop({ yd: [1, 2, 3] })).toBe(2);
    expect(() =>
      runTop({
        yd: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toThrow(/static element type/);
    // The interpreter still broadcasts over the row.
    ce.assign('xs', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    expect(ce.box(['h', 'xs']).evaluate().toString()).toBe('[2,3]');
  });

  test('the check dispatches on the run-time index shape', () => {
    const ce = new ComputeEngine();
    ce.declare('zs', { type: 'list<number>' });
    ce.declare('i', { type: 'integer | list<integer>' });
    const r = compile(ce.box(['At', 'zs', 'i'])) as unknown as {
      run: (env: unknown) => unknown;
      code: string;
    };
    expect(r.code).toContain('_SYS.atNumeric(');
    // A gather at run time is legitimate: its result is a list of numbers.
    expect(r.run({ zs: [10, 20, 30], i: [1, 2] })).toEqual([10, 20]);
    expect(r.run({ zs: [10, 20, 30], i: 2 })).toBe(20);
    // A row where a number was expected throws on both index shapes.
    expect(() =>
      r.run({
        zs: [
          [1, 2],
          [3, 4],
        ],
        i: 1,
      })
    ).toThrow(/static element type/);
    expect(() =>
      r.run({
        zs: [
          [1, 2],
          [3, 4],
        ],
        i: [1, 2],
      })
    ).toThrow(/static element type/);
  });

  test('a closed base is not checked: its cells are fixed at compile time', () => {
    const ce = new ComputeEngine();
    const r = compile(
      ce.box([
        'At',
        ['Map', ['Function', ['Square', 'y'], 'y'], ['Range', 1, 4]],
        'k',
      ])
    ) as unknown as { run: (env: unknown) => unknown; code: string };
    expect(r.code).not.toContain('atNumeric');
    expect(r.run({ k: 3 })).toBe(9);
  });

  test('a refined lambda compiles and agrees with the interpreter on a list', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', ['Add', ['At', 'v', 1], 1], 'v']));
    expect(typeOf(ce, 'h')).toBe(
      '(indexed_collection<number>) -> broadcastable<number>'
    );
    const call = ce.box(['h', 'xs']);
    const compiled = compile(call) as unknown as
      | { run: (env: unknown) => unknown }
      | ((env: unknown) => unknown);
    const run = typeof compiled === 'function' ? compiled : compiled.run;
    expect(run({ xs: [1, 2, 3] })).toBe(2);
    ce.assign('xs', ce.box(['List', 1, 2, 3]));
    expect(call.evaluate().toString()).toBe('2');
  });
});
