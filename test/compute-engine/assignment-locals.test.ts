import { ComputeEngine } from '../../src/compute-engine';
import {
  assignmentLocalsOf,
  recordAssignmentLocals,
} from '../../src/compute-engine/assignment-locals';

//
// The assignment locals of a block are decided when the block is
// canonicalized for the first time (`recordAssignmentLocals()`,
// `src/compute-engine/assignment-locals.ts`). A block that is built again
// with the same scope (`subs()`) is canonicalized again, and a name that the
// scope binds then is not counted. The first record is kept, so that the name
// stays a local.
//

describe('THE ASSIGNMENT LOCALS OF A BLOCK SCOPE', () => {
  test('a second record for the same scope is ignored', () => {
    const scope = {};
    recordAssignmentLocals(scope, ['t', 'u']);
    recordAssignmentLocals(scope, ['u']);
    expect(assignmentLocalsOf(scope)).toEqual(['t', 'u']);
    recordAssignmentLocals(scope, []);
    expect(assignmentLocalsOf(scope)).toEqual(['t', 'u']);
  });

  test('a first record with no name is kept', () => {
    const scope = {};
    recordAssignmentLocals(scope, []);
    recordAssignmentLocals(scope, ['t']);
    expect(assignmentLocalsOf(scope)).toEqual([]);
  });

  test('a block built again with the same scope keeps its locals', () => {
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['Assign', 't', ['Add', 'k', 1]],
      ['Assign', 'u', 't'],
      ['Add', 'u', 'k'],
    ]);
    const scope = block.localScope!;
    expect(assignmentLocalsOf(scope)).toEqual(['t', 'u']);
    // The scope binds `u` but not `t`, as when a run removed the binding of
    // `t`. The canonicalization of the new block finds only `t`.
    scope.bindings.delete('t');
    const again = block.subs({ k: 3 });
    expect(again.localScope).toBe(scope);
    expect(assignmentLocalsOf(scope)).toEqual(['t', 'u']);
    // A run of the new block does not write a `u` made after it.
    ce.assign('u', 100);
    expect(again.evaluate().json).toBe(7);
    expect(ce.box('u').evaluate().json).toBe(100);
  });
});
