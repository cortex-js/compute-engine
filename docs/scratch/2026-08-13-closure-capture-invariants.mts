/**
 * Closure-capture invariants that the item-178(a)/(c) fix must preserve.
 *
 * The fix changes WHERE a FREE symbol inside a function body auto-declares
 * (body scope -> enclosing scope). `createSymbolExpression`'s comment says the
 * body-local declaration is what keeps closure capture working, so these are
 * the behaviours to hold fixed. Run before and after; the output must not move.
 *
 * Run: npx tsx docs/scratch/2026-08-13-closure-capture-invariants.mts
 */
import { ComputeEngine } from '../../src/compute-engine.ts';

const show = (label: string, v: unknown) => console.log(`  ${label.padEnd(52)} ${String(v)}`);

console.log('1. free var in a lambda body sees a LATER top-level assignment:');
{
  const ce: any = new ComputeEngine();
  const f = ce.box(['Function', ['Multiply', 'x', 'y_r'], 'x']);
  ce.box(['Assign', 'y_r', 10]).evaluate();
  show('f(2)', ce.box(['Apply', f, 2]).evaluate().toString());
}

console.log('\n2. reassignment is tracked, not snapshotted at definition:');
{
  const ce: any = new ComputeEngine();
  const f = ce.box(['Function', ['Multiply', 'x', 'y_r'], 'x']);
  ce.box(['Assign', 'y_r', 3]).evaluate();
  const a = ce.box(['Apply', f, 1]).evaluate().toString();
  ce.box(['Assign', 'y_r', 5]).evaluate();
  const b = ce.box(['Apply', f, 1]).evaluate().toString();
  show('f(1) after y_r:=3, then after y_r:=5', `${a} , ${b}`);
}

console.log('\n3. LEXICAL capture: a block that rebinds the name must NOT hijack it:');
{
  const ce: any = new ComputeEngine();
  const f = ce.box(['Function', ['Multiply', 'x', 'y_r'], 'x']);
  ce.box(['Assign', 'y_r', 2]).evaluate();
  show('f(1) at top level', ce.box(['Apply', f, 1]).evaluate().toString());
  show(
    'f(1) inside a Block that sets y_r=100',
    ce.box(['Block', ['Declare', 'y_r', 'number'], ['Assign', 'y_r', 100], ['Apply', f, 1]])
      .evaluate()
      .toString()
  );
}

console.log('\n4. a lambda DEFINED inside a block and applied outside it:');
{
  const ce: any = new ComputeEngine();
  ce.box(['Assign', 'y_r', 4]).evaluate();
  const stored = ce
    .box(['Block', ['Function', ['Multiply', 'x', 'y_r'], 'x']])
    .evaluate();
  show('escaped lambda applied at top level', ce.box(['Apply', stored, 3]).evaluate().toString());
}

console.log('\n5. two lambdas in SIBLING blocks sharing a free name:');
{
  const ce: any = new ComputeEngine();
  ce.box(['Assign', 'y_r', 7]).evaluate();
  const f1 = ce.box(['Block', ['Function', ['Multiply', 'x', 'y_r'], 'x']]).evaluate();
  const f2 = ce.box(['Block', ['Function', ['Add', 'x', 'y_r'], 'x']]).evaluate();
  show('f1(2) / f2(2)', `${ce.box(['Apply', f1, 2]).evaluate()} / ${ce.box(['Apply', f2, 2]).evaluate()}`);
}

console.log('\n6. the free name is also a PARAMETER of an outer lambda (shadowing):');
{
  const ce: any = new ComputeEngine();
  const outer = ce.box([
    'Function',
    ['Block', ['Apply', ['Function', ['Multiply', 'x', 'y_r'], 'x'], 2]],
    'y_r',
  ]);
  show('outer(5) — inner must see the PARAMETER', ce.box(['Apply', outer, 5]).evaluate().toString());
}

console.log('\n7. the defect itself (must flip to true after the fix):');
const J: any = ['List', ['Integrate', ['Function', ['Block', ['n', 'x', 'y_r']], 'x'], ['Limits', 'x', -10, 10]], 'y_r'];
const C: any = ['List', ['Add', 'n', 'y_r'], 'y_r'];
{
  const ce: any = new ComputeEngine();
  show('box(J).isSame(box(J))  [witness]', ce.box(J).isSame(ce.box(J)));
  const ce2: any = new ComputeEngine();
  show('box(C).isSame(box(C))  [no-binder control]', ce2.box(C).isSame(ce2.box(C)));
}

console.log('\n8. TYPE stability under box-first ordering, witness vs control:');
{
  // Tycho's order matrix, reduced to the box-first row that moves. Recorded
  // separately for the binder witness and the no-binder control: if the fix
  // removes the binder-specific component of the movement, the witness
  // stabilizes while the control keeps moving. If both keep moving
  // identically, the movement was only the general direction-rule ordering.
  const cell = (json: any, n: number) => {
    const ce: any = new ComputeEngine();
    for (let i = 0; i < n; i++) ce.box(json);
    ce.assign('y_r', 5);
    return String(ce.box(json).ops[1].type);
  };
  const row = (label: string, json: any) => {
    const cells = [0, 1, 2].map((n) => cell(json, n));
    const moved = new Set(cells).size > 1;
    show(`${label} boxings 0/1/2`, `${cells.join(' / ')}  ${moved ? '<<< MOVES' : 'stable'}`);
  };
  row('witness (binder)  ', J);
  row('control (no binder)', C);
}
