import {
  DEFAULT_OPTIONS,
  formatValue,
  generateProgram,
  runFuzz,
  type Finding,
  type FuzzResult,
} from '../../scripts/js-profile-fuzz';
import { runBigintFuzz } from '../../scripts/js-profile-fuzz-bigint';

// The random differential tester of the `numeric-kernel` profile
// (scripts/js-profile-fuzz.ts) with three fixed seeds and a small count.
// For each program that both compilers compile, the profile must give the
// doubles of the existing compiler with `cse: false, constantFold: false`
// at every input in the type of each input (docs/COMPILATION-MODEL.md, "The
// `numeric-kernel` profile of the JavaScript target"), its code must make a
// value of the same shape (a number or `{re, im}`, before `run()` turns
// `{re, im: 0}` into a number), and the profile must not fail with an error
// that is not a decline.
//
// A minimal program of a known class is listed in `KNOWN` with its reason
// and its reference; a finding that matches no entry fails the test, and
// an entry that matches no finding fails it too, so that the list is
// cleared when a fix lands. An `optional` entry is a class that only the
// scale runs of the tester reach: it may match no finding here.

type Known = {
  readonly name: string;
  readonly reason: string;
  readonly reference: string;
  readonly classes: readonly Finding['class'][];
  readonly matches: (finding: Finding) => boolean;
  /** The seeds of this test need not reach the entry. */
  readonly optional?: boolean;
};

const KNOWN: readonly Known[] = [
  {
    name: 'an element of a comprehension whose element type is not real, read in the strict mode',
    reason:
      'the existing compiler reads the element as a complex value ' +
      '(`_SYS.cneg(_SYS.atNumeric(…, "complex | signed_infinity"))` is ' +
      '`{re: NaN, im: NaN}` for `-At(Comprehension(Ln(x), …), 1)` at ' +
      '`x = 3`); the profile gives the value of the interpreter',
    reference: 'CE-1203',
    classes: ['difference'],
    // The seeds of this test do not reach it; the scale runs of the tester
    // do (about one program in 50,000).
    optional: true,
    matches: (f) =>
      f.mode === 'strict' && f.shape.includes('At(Comprehension('),
  },
];

let result: FuzzResult;

beforeAll(async () => {
  result = await runFuzz({
    ...DEFAULT_OPTIONS,
    seeds: [1, 2, 3],
    count: 150,
    interp: 0,
  });
}, 300_000);

const describeFinding = (f: Finding) =>
  `${f.class} ${f.shape} (${f.id}, ${f.mode}): ${JSON.stringify(f.minimal)}` +
  (f.input === undefined ? '' : ` at ${formatValue(f.input)}`) +
  (f.profileValue === undefined
    ? ''
    : `: profile ${formatValue(f.profileValue)}, existing ${formatValue(f.existingValue)}`) +
  (f.message === undefined ? '' : `: ${f.message}`);

const checked = (f: Finding) =>
  f.class === 'difference' ||
  f.class === 'shape' ||
  f.class === 'profile-failure';

test('the generator gives programs that both compilers compile', () => {
  expect(result.programs).toBe(450);
  expect(result.classes['both compile']).toBeGreaterThan(300);
  expect(result.points.inType).toBeGreaterThan(30_000);
});

test('the generator writes the functions of lists and the function operands', () => {
  // Slices 2 and 3 of docs/plans/2026-11-11-structured-collections-and-lambdas.md.
  const heads = new Set<string>();
  const visit = (json: unknown): void => {
    if (!Array.isArray(json)) return;
    if (typeof json[0] === 'string') {
      heads.add(json[0]);
      // A function operand that is a function literal of two parameters,
      // or a library operator.
      if ((json[0] === 'Reduce' || json[0] === 'Scan') && Array.isArray(json[2]) && json[2].length === 4)
        heads.add(`${json[0]} of a lambda of two parameters`);
      if (json[0] === 'Map' && typeof json[1] === 'string') heads.add('Map of an operator');
    }
    json.forEach(visit);
  };
  for (let i = 0; i < 4000; i++)
    visit(generateProgram(7, i, { depth: DEFAULT_OPTIONS.depth, size: DEFAULT_OPTIONS.size }).json);
  for (const head of [
    'Norm', 'Mean', 'Median', 'Variance', 'Dot', 'Take', 'Drop', 'Rest', 'Reverse', 'Sort',
    'Join', 'First', 'Last', 'Range', 'Map', 'Map of an operator', 'Filter', 'Count',
    'Reduce', 'Scan', 'Reduce of a lambda of two parameters', 'Scan of a lambda of two parameters',
    'Apply',
  ])
    expect([head, heads.has(head)]).toEqual([head, true]);
});

test('the generator writes captured lists and nodes that read no input', () => {
  const seen = new Set<string>();
  const visit = (json: unknown): void => {
    if (!Array.isArray(json)) return;
    const text = JSON.stringify(json);
    if (text === '["Floor","cr"]' || text === '["Sign","cr"]') seen.add('a jump of a capture');
    if (json[0] === 'Mod' && json[2] === 1) seen.add('Mod(v, 1)');
    if (json[0] === 'At' && json[1] === 'CL') seen.add('a captured list');
    if (json[0] === 'fcr') seen.add('a helper parameter with the name of a capture');
    if (json[0] === 'Function')
      for (const p of json.slice(2))
        if (Array.isArray(p) && p[0] === 'Typed' && (p[1] === 'cr' || p[1] === 'CL'))
          seen.add(`a parameter ${p[1]}`);
    json.forEach(visit);
  };
  for (let i = 0; i < 2000; i++)
    visit(generateProgram(7, i, { depth: DEFAULT_OPTIONS.depth, size: DEFAULT_OPTIONS.size }).json);
  expect([...seen].sort()).toEqual([
    'Mod(v, 1)',
    'a captured list',
    'a helper parameter with the name of a capture',
    'a jump of a capture',
    'a parameter CL',
    'a parameter cr',
  ]);
});

test('the generator writes the forms of slices 4 and 5', () => {
  // User functions as function operands, ranges with a step, rotations,
  // lists of tuples, a local list of tuples and a loop over a list.
  const forms = new Set<string>();
  const visit = (json: unknown): void => {
    if (!Array.isArray(json)) return;
    const [head, ...ops] = json;
    if (typeof head === 'string') {
      forms.add(head);
      if (head === 'Range' && ops.length === 3) forms.add('Range with a step');
      if ((head === 'Reduce' || head === 'Scan') && ops[1] === 'fe') forms.add('a user function of a fold');
      if ((head === 'Filter' || head === 'Count') && ops[1] === 'fc') forms.add('a user predicate');
      if (head === 'Map' && (ops[0] === 'fd' || ops[0] === 'fi')) forms.add('Map of a user function');
      if (head === 'Loop' && Array.isArray(ops[1]) && ops[1][0] === 'Element' && typeof ops[1][2] === 'string')
        forms.add('a loop over a list');
      if (head === 'Declare' && ops[1] === "'list<tuple<real, real>>'") forms.add('a local list of tuples');
      if (head === 'Map' && Array.isArray(ops[0]) && Array.isArray(ops[0][1]) && ops[0][1][0] === 'Tuple')
        forms.add('Map to tuples');
    } else if (head === 'LQ' || head === 'TL') forms.add('a list of tuples');
    json.forEach(visit);
    if (json.includes('LQ') || json.includes('TL')) forms.add('a list of tuples');
  };
  for (let i = 0; i < 3000; i++)
    visit(generateProgram(7, i, { depth: DEFAULT_OPTIONS.depth, size: DEFAULT_OPTIONS.size }).json);
  // A block of statements is larger than most programs of the default size:
  // some programs of the size 100 (`--size 100`) too.
  for (let i = 0; i < 1000; i++)
    visit(generateProgram(7, i, { depth: DEFAULT_OPTIONS.depth, size: 100 }).json);
  for (const form of [
    'Range with a step', 'RotateLeft', 'RotateRight', 'ListJoin', 'a list of tuples',
    'a user function of a fold', 'a user predicate', 'Map of a user function',
    'a loop over a list', 'a local list of tuples', 'Map to tuples',
  ])
    expect([form, forms.has(form)]).toEqual([form, true]);
});

test('the generator writes the statement and loop forms', () => {
  // Loops over two index sets or none, `Continue`, comprehensions with two
  // generators or over a list, destructuring declarations and writes, and
  // helpers with a default value or a `Continue` (`fdf`, `fdu`, `fcw`).
  const forms = new Set<string>();
  const visit = (json: unknown): void => {
    if (!Array.isArray(json)) return;
    const [head, ...ops] = json;
    if (head === 'Loop' && ops.length >= 3) forms.add('a loop over two index sets');
    if (head === 'Loop' && ops.length === 1) forms.add('a loop with no index set');
    if (head === 'Continue') forms.add('Continue');
    if (head === 'Comprehension' && ops.length >= 3) forms.add('a comprehension with two generators');
    if (head === 'Comprehension' && Array.isArray(ops[1]) && ops[1][0] === 'Element' && (typeof ops[1][2] === 'string' || (Array.isArray(ops[1][2]) && ops[1][2][0] === 'List')))
      forms.add('a comprehension over a list');
    if ((head === 'Assign' || head === 'Declare') && Array.isArray(ops[0]) && ops[0][0] === 'Tuple') forms.add('a destructuring');
    if (head === 'fdf' || head === 'fdu') forms.add('a helper with a default value');
    if (head === 'fcw') forms.add('a helper with a Continue');
    json.forEach(visit);
  };
  for (let i = 0; i < 1000; i++)
    visit(generateProgram(7, i, { depth: DEFAULT_OPTIONS.depth, size: 100 }).json);
  for (const form of [
    'a loop over two index sets', 'a loop with no index set', 'Continue',
    'a comprehension with two generators', 'a comprehension over a list',
    'a destructuring', 'a helper with a default value', 'a helper with a Continue',
  ])
    expect([form, forms.has(form)]).toEqual([form, true]);
});

test('the generator writes the integrals of the routine integrate (--calculus)', () => {
  // Slice 2 of docs/plans/2026-11-11-structured-numeric-calculus.md:
  // definite integrals with no closed form, with infinite bounds, two
  // clauses and an integral in an integrand.
  const forms = new Set<string>();
  const visit = (json: unknown): void => {
    if (!Array.isArray(json)) return;
    const [head, ...ops] = json;
    if (head === 'Integrate') {
      const limits = ops.slice(1) as unknown[][];
      if (limits.length === 2) forms.add('two clauses');
      if (Array.isArray(ops[0]) && ops[0][0] === 'Integrate') forms.add('a nested integral');
      if (limits.some((l) => l.includes('PositiveInfinity') || l.includes('NegativeInfinity')))
        forms.add('an infinite bound');
      if (JSON.stringify(ops[0]).includes('["Power","t",4]')) forms.add('an integrand with no closed form');
    }
    json.forEach(visit);
  };
  for (let i = 0; i < 3000; i++)
    visit(
      generateProgram(7, i, {
        depth: DEFAULT_OPTIONS.depth,
        size: DEFAULT_OPTIONS.size,
        calculus: true,
      }).json
    );
  for (const form of ['two clauses', 'a nested integral', 'an infinite bound', 'an integrand with no closed form'])
    expect([form, forms.has(form)]).toEqual([form, true]);
});

test('the generator writes the element-wise heads and selections', () => {
  // `genBroadcastList()`: slices 1 and 2 of
  // docs/plans/2026-11-12-structured-broadcast-over-lists.md.
  const forms = new Set<string>();
  const isList = (json: unknown): boolean =>
    ['L', 'I', 'LN', 'VN', 'CL', 'W', 'NV'].includes(json as string) ||
    (Array.isArray(json) && (json[0] === 'List' || json[0] === 'Comprehension'));
  const visit = (json: unknown): void => {
    if (!Array.isArray(json)) return;
    const [head, ...ops] = json;
    if (['Sqrt', 'Ln', 'Exp', 'Sin', 'Gamma', 'Floor', 'Abs', 'Erf'].includes(head) && isList(ops[0]))
      forms.add('a function of a list');
    // A list operand, also inside an element-wise sum or function of a list.
    const listValued = (op: unknown): boolean =>
      isList(op) ||
      (Array.isArray(op) &&
        ['Add', 'Multiply', 'Negate', 'Divide', 'Subtract', 'Sqrt', 'Abs', 'Sin'].includes(op[0]) &&
        op.slice(1).some(listValued));
    if (['Power', 'Root', 'Log', 'Mod', 'Hypot', 'Arctan2', 'Remainder', 'Binomial'].includes(head) && ops.some(listValued))
      forms.add('a function of two operands of a list');
    if ((head === 'If' || head === 'Which') && Array.isArray(ops[0]) && ops[0].slice(1).some(isList))
      forms.add('a selection with a list condition');
    if (head === 'Length' && Array.isArray(ops[0]) && ['Less', 'GreaterEqual', 'Equal'].includes(ops[0][0]))
      forms.add('a length of a list of booleans');
    json.forEach(visit);
  };
  for (let i = 0; i < 4000; i++)
    visit(generateProgram(7, i, { depth: DEFAULT_OPTIONS.depth, size: DEFAULT_OPTIONS.size }).json);
  expect([...forms].sort()).toEqual([
    'a function of a list',
    'a function of two operands of a list',
    'a length of a list of booleans',
    'a selection with a list condition',
  ]);
});

test('the generator writes loops that carry a list or a list of lists', () => {
  // `genCarriedList()`: the patterns of `withOwnedCopies()` and of the rows
  // of `inPlaceUpdates()` (structured-in-place.ts). Most of them are larger
  // than the default size: the runs of the tester with `--size 100` reach
  // them more often.
  const forms = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const text = JSON.stringify(generateProgram(7, i, { depth: DEFAULT_OPTIONS.depth, size: 100 }).json);
    if (!text.includes('["Declare","A",')) continue;
    forms.add(text.includes(`["Declare","A","'list<list<real>>'"`) ? 'a list of lists' : 'a list');
    if (text.includes('["Declare","B","')) forms.add('an alias');
    if (text.includes('["Break"]')) forms.add('a break');
    if (text.includes('"k2"')) forms.add('an inner loop');
    if (/\["Declare","A","'list<real>'","(L|CL|V)"\]/.test(text)) forms.add('an input');
    if (/\["Declare","A","'list<list<real>>'","(R|MA|M2|RP|MP)"\]/.test(text)) forms.add('an input of rows');
  }
  expect([...forms].sort()).toEqual([
    'a break',
    'a list',
    'a list of lists',
    'an alias',
    'an inner loop',
    'an input',
    'an input of rows',
  ]);
});

test('no difference between the two compilers and no failure of the profile, but the known ones', () => {
  const unexplained = result.findings.filter(
    (f) =>
      checked(f) &&
      !KNOWN.some((k) => k.classes.includes(f.class) && k.matches(f))
  );
  expect(unexplained.map(describeFinding)).toEqual([]);
});

test('each entry of the allow-list is still needed', () => {
  const unused = KNOWN.filter(
    (k) =>
      k.optional !== true &&
      !result.findings.some(
        (f) => checked(f) && k.classes.includes(f.class) && k.matches(f)
      )
  );
  expect(unused.map((k) => k.name)).toEqual([]);
});

test('the same seed gives the same result', async () => {
  const again = await runFuzz({
    ...DEFAULT_OPTIONS,
    seeds: [2],
    count: 30,
    interp: 0,
  });
  const once = await runFuzz({
    ...DEFAULT_OPTIONS,
    seeds: [2],
    count: 30,
    interp: 0,
  });
  expect(JSON.stringify(again, (_k, v) => (Number.isNaN(v) ? 'NaN' : v))).toBe(
    JSON.stringify(once, (_k, v) => (Number.isNaN(v) ? 'NaN' : v))
  );
}, 300_000);

// The `--bigint` run (scripts/js-profile-fuzz-bigint.ts): integer programs
// in the compile mode `bigint`. A `bigint` or a `boolean` result of the
// profile is the result of the existing compiler (`===`) and the exact
// value of the interpreter, and a thrown error has the class of the error
// of the existing compiler.
test('the bigint run: no difference, no failure, no disagreement with the interpreter', async () => {
  const run = await runBigintFuzz({
    seeds: [1, 2],
    count: 150,
    depth: 4,
    size: 40,
    points: 40,
    interp: 2,
    shrink: 100,
  });
  expect(run.programs).toBe(300);
  expect(run.classes['both compile']).toBeGreaterThan(200);
  expect(run.classes['profile declines only']).toBe(0);
  expect(run.interpreterPoints.compared).toBeGreaterThan(300);
  expect(
    run.findings
      .filter((f) => f.class !== 'number')
      .map((f) => `${f.class} ${JSON.stringify(f.minimal)}`)
  ).toEqual([]);
}, 300_000);
