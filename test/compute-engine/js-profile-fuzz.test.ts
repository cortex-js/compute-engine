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
// cleared when a fix lands.

type Known = {
  readonly name: string;
  readonly reason: string;
  readonly reference: string;
  readonly classes: readonly Finding['class'][];
  readonly matches: (finding: Finding) => boolean;
};

const KNOWN: readonly Known[] = [
  {
    name: 'a complex sum with a real operand that is a sum or a conditional',
    reason:
      'the emitter of the profile fails ("a real operand of a complex sum ' +
      'is a sum or a conditional, which the existing emitter writes with ' +
      'another grouping"), a `compile-error` and not a decline',
    reference:
      'docs/plans/2026-11-09-js-pilot-emission-rewrites.md, the row "The complex branch of `Add`"',
    classes: ['profile-failure'],
    matches: (f) =>
      (f.message ?? '').includes(
        'a real operand of a complex sum is a sum or a conditional'
      ),
  },
  {
    name: 'a local declared real keeps the kind of a complex initializer',
    reason:
      'the profile does not apply the declared type of a `Declare`: the ' +
      'local is complex where the existing compiler writes ' +
      '`_SYS.crealElements(v)` (NaN) in the `complex` mode',
    reference:
      'the class D1 of the random differential tester, fixed by the change ' +
      'to the rules of locals; remove this entry with that change',
    classes: ['difference', 'shape'],
    matches: (f) => f.shape.includes("Declare(_, 'real', "),
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
}, 60_000);

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
}, 60_000);
