import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  boundVariableNames,
  boundVariableNamesInOperand,
} from '../../src/compute-engine/boxed-expression/binders';

//
// A binder whose sites are iterator CLAUSES (`Sum`, `Product`,
// `Comprehension`, `Loop`) binds each index from its own clause onward: an
// earlier clause's collection or guard that names a later clause's index
// denotes the ENCLOSING variable of that name (`BindingSite.clauseLocal`,
// the scope `bindBindingSites` canonicalizes against). The free-variable
// walk and the rewrite walks apply the same rule (`boundVariableNamesInOperand`),
// so such a name is reported free, is substituted, and is compiled as a
// parameter — instead of being folded away with the enclosing variable unbound
// (found 2026-09-27: a guarded comprehension compiled to `[]`).
//

const ce = new ComputeEngine();
ce.declare('y', 'integer');
ce.declare('j', 'integer');

describe('CLAUSE SCOPE — free variables', () => {
  test('the body sees every index; nothing is free', () => {
    const comp = ce.box([
      'Comprehension',
      ['Add', 'x', 'y'],
      ['Element', 'x', ['Range', 1, 3]],
      ['Element', 'y', ['Range', 1, 2]],
    ]);
    expect(comp.unknowns).toEqual([]);
    expect(boundVariableNames(comp)).toEqual(['x', 'y']);
    expect(boundVariableNamesInOperand(comp, 0)).toEqual(['x', 'y']);
  });

  test('a later index named in an earlier collection is free', () => {
    const comp = ce.box([
      'Comprehension',
      'x',
      ['Element', 'x', ['Range', 1, 'y']],
      ['Element', 'y', ['Range', 1, 2]],
    ]);
    expect(comp.unknowns).toEqual(['y']);
    expect(boundVariableNamesInOperand(comp, 1)).toEqual(['x']);
    expect(boundVariableNamesInOperand(comp, 2)).toEqual(['x', 'y']);
  });

  test('a later index named in an earlier guard is free', () => {
    const comp = ce.box([
      'Comprehension',
      'x',
      ['Element', 'x', ['Range', 1, 3], ['Less', 'x', 'y']],
      ['Element', 'y', ['Range', 1, 2]],
    ]);
    expect(comp.unknowns).toEqual(['y']);
  });

  test('an earlier index named in a later collection is bound', () => {
    const comp = ce.box([
      'Comprehension',
      ['Tuple', 'x', 'y'],
      ['Element', 'x', ['Range', 1, 3]],
      ['Element', 'y', ['Range', 1, 'x']],
    ]);
    expect(comp.unknowns).toEqual([]);
  });

  test('Sum follows the same rule', () => {
    const sum = ce.box([
      'Sum',
      'k',
      ['Element', 'k', ['Range', 1, 'j']],
      ['Element', 'j', ['Range', 1, 3]],
    ]);
    expect(sum.unknowns).toEqual(['j']);
    const inner = ce.box([
      'Sum',
      'k',
      ['Element', 'j', ['Range', 1, 3]],
      ['Element', 'k', ['Range', 1, 'j']],
    ]);
    expect(inner.unknowns).toEqual([]);
  });

  test('a non-clause binder is unchanged: D keeps its variable free', () => {
    const d = ce.box(['D', ['Sin', 'x'], 'x']);
    expect(d.unknowns).toEqual(['x']);
  });

  test('the compiled routes read the enclosing variable', () => {
    const comp = ce.box([
      'Comprehension',
      'x',
      ['Element', 'x', ['Range', 1, 'y']],
      ['Element', 'y', ['Range', 1, 2]],
    ]);
    // A later index named in an earlier COLLECTION declines in the emitted
    // loop (the loop would read `y` before binding it) and falls back to the
    // interpreter, which now receives `y` because it is reported free. Before
    // this, the node was folded with `y` unbound and answered `[]`.
    expect(() => compile(comp, { fallback: false })).toThrow(
      /enclosing clause/
    );
    expect(compile(comp).run!({ y: 2 })).toEqual([1, 1, 2, 2]);
    // A later index named in an earlier GUARD compiles: the guard is emitted
    // under the bindings of its own clause and the earlier ones.
    const guarded = ce.box([
      'Comprehension',
      'x',
      ['Element', 'x', ['Range', 1, 3], ['Less', 'x', 'y']],
      ['Element', 'y', ['Range', 1, 2]],
    ]);
    const result = compile(guarded, { fallback: false });
    expect(result.success).toBe(true);
    expect(result.run!({ y: 3 })).toEqual([1, 1, 2, 2]);
  });
});
