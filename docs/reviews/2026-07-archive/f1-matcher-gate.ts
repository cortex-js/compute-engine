// F.1 acceptance: SYMBOLIC P0-5 repros + capture-multiset property + repeated-wildcard conflicts
import { ComputeEngine } from '/Users/arno/dev/compute-engine/src/compute-engine';

const ce = new ComputeEngine();
let pass = 0,
  fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
}

// Repro 1: replace must not silently delete an operand
{
  const r = ce.parse('w+x+y+z').replace(['...a + b -> a']);
  // sequence __a should capture (w,x,y) and b=z → result w+x+y
  const expected = ce.parse('w+x+y');
  check('replace ...a+b->a on w+x+y+z gives w+x+y', r !== null && r.isSame(expected) === true, String(r));
}

// Repro 2: capture multiset property — __a ⊎ _b equals subject operands
{
  const subj = ce.parse('w+x+y+z');
  const m = subj.match(ce.box(['Add', '__a', '_b'], { canonical: false }));
  if (m === null) check('match Add __a _b non-null', false);
  else {
    const names = (e: any): string[] =>
      e.operator === 'Add' || e.operator === 'Sequence'
        ? e.ops.flatMap(names)
        : [e.toString()];
    const got = [...names(m['__a']), ...names(m['_b'])].sort().join(',');
    check('capture multiset = {w,x,y,z}', got === 'w,x,y,z', `got {${got}}  __a=${m['__a']} _b=${m['_b']}`);
  }
}

// Repro 3: non-commutative Tuple — __a must capture a CONTIGUOUS prefix (w,x,y)
{
  const subj = ce.box(['Tuple', 'w', 'x', 'y', 'z']);
  const m = subj.match(ce.box(['Tuple', '__a', '_b'], { canonical: false }));
  check(
    'Tuple __a _b: __a=(w,x,y), _b=z',
    m !== null && String(m['_b']) === 'z' && String(m['__a']).includes('w') && String(m['__a']).includes('x') && String(m['__a']).includes('y'),
    m ? `__a=${m['__a']} _b=${m['_b']}` : 'no match'
  );
}

// Repro 4 (failing-first-split shape): '...a + _n + b' vs '3 + 4 + x + b' — needs seq to grow
{
  const subj = ce.parse('3 + 4 + x + b');
  const m = subj.match(ce.box(['Add', '__a', '_n', 'b'], { canonical: false }));
  check('growing sequence still matches', m !== null, 'no match');
}

// Repeated sequence wildcard: consistent binding must match
{
  const subj = ce.box(['Tuple', 'x', 'y', 'q', 'x', 'y']);
  const m = subj.match(ce.box(['Tuple', '__a', '_m', '__a'], { canonical: false }));
  check(
    'repeated __a consistent (x,y | q | x,y) matches',
    m !== null && String(m['_m']) === 'q',
    m ? JSON.stringify(Object.keys(m)) : 'no match'
  );
}

// Repeated sequence wildcard: INCONSISTENT binding must NOT match (pre-fix fail-open)
{
  const subj = ce.box(['Tuple', 'x', 'y', 'q', 'x', 'z']);
  const m = subj.match(ce.box(['Tuple', '__a', '_m', '__a'], { canonical: false }));
  check('repeated __a inconsistent must not match', m === null, m ? `false match: ${JSON.stringify(m, null, 0).slice(0, 120)}` : '');
}

// Property fuzz: random operand lists, pattern [Op __a _b] — captures must reconstruct subject
{
  let bad = 0;
  const syms = ['p', 'q', 'r', 's', 't', 'u'];
  for (let n = 3; n <= 6; n++) {
    for (let trial = 0; trial < 20; trial++) {
      // deterministic pseudo-shuffle (no Math.random needed)
      const opsList = Array.from({ length: n }, (_, k) => syms[(k * 2 + trial * 3 + n) % syms.length] + String(k));
      const subj = ce.box(['Tuple', ...opsList]);
      const m = subj.match(ce.box(['Tuple', '__a', '_b'], { canonical: false }));
      if (m === null) {
        bad++;
        continue;
      }
      const names = (e: any): string[] =>
        e.operator === 'Sequence' || e.operator === 'Tuple' ? e.ops.flatMap(names) : [e.symbol ?? e.toString()];
      const got = [...names(m['__a']), ...names(m['_b'])].join(',');
      if (got !== opsList.join(',')) bad++;
    }
  }
  check('property fuzz 80/80 reconstruct subject', bad === 0, `${bad} bad`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
