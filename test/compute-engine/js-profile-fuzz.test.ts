import {
  DEFAULT_OPTIONS,
  formatValue,
  runFuzz,
  type Finding,
  type FuzzResult,
} from '../../scripts/js-profile-fuzz';

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
