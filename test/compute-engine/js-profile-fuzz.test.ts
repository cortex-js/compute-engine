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
  for (let i = 0; i < 2000; i++)
    visit(generateProgram(7, i, { depth: DEFAULT_OPTIONS.depth, size: DEFAULT_OPTIONS.size }).json);
  for (const head of [
    'Norm', 'Mean', 'Median', 'Variance', 'Dot', 'Take', 'Drop', 'Rest', 'Reverse', 'Sort',
    'Join', 'First', 'Last', 'Range', 'Map', 'Map of an operator', 'Filter', 'Count',
    'Reduce', 'Scan', 'Reduce of a lambda of two parameters', 'Scan of a lambda of two parameters',
    'Apply',
  ])
    expect([head, heads.has(head)]).toEqual([head, true]);
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
  for (const form of [
    'Range with a step', 'RotateLeft', 'RotateRight', 'ListJoin', 'a list of tuples',
    'a user function of a fold', 'a user predicate', 'Map of a user function',
    'a loop over a list', 'a local list of tuples', 'Map to tuples',
  ])
    expect([form, forms.has(form)]).toEqual([form, true]);
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
