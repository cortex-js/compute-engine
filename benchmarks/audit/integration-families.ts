// Exact definite-integration families (run with `npx tsx`).
//
//   npx tsx benchmarks/audit/integration-families.ts [--suite <name>] [--timeout <ms>]
//
// Runs the case tables of the guarded definite-integration families on two
// configurations, base CE and CE with the Rubi integrator, and writes
// `audit/REPORT-integration-families.md`. The cases come from the fixtures in
// `test/compute-engine/fixtures/` (`competition-exact.ts`,
// `integration-families.ts`, `integration-composed.ts`). The test suite keeps
// the guard tests of these families (decline conditions, routing order, Rubi
// helper contracts); the sweeps over the case tables run here instead, because
// they take minutes on the continuous-integration runners.
//
// Each result is graded against the reference value of its case:
//
// - `exact`: no `Integrate`, `Limit`, `EvaluateAt`, `Sum` or `Product` is
//   left, every number literal is exact, and the value agrees with the
//   reference to `DIGITS` significant digits (real and imaginary parts,
//   compared at a working precision of `PRECISION` digits).
// - `inexact`: the result holds a float, and its value agrees with the
//   reference to `FLOAT_DIGITS` significant digits.
// - `wrong`: the value disagrees with the reference, or is infinite or has no
//   value (`NaN`, `Indeterminate`) where the reference is finite. The script
//   exits with code 1 when any result is wrong.
// - `unverified`: the result has no numeric value to compare (for example a
//   special function that does not evaluate numerically), or it is exact and
//   agrees with the reference to `FLOAT_DIGITS` digits but not to `DIGITS`
//   digits (a numeric evaluation that is accurate only to machine precision).
// - `unevaluated`, `timeout` (the time limit or the Rubi step budget is
//   spent), `error`: no answer.
//
// Separately, `reduced` records whether `simplify()` reduces
// `result − reference` to 0. A correct exact value that `simplify()` cannot
// reduce shows a simplification gap, not an integration error.
//
// CE runs from source, like `dsolve.ts`, so no build is needed. Source builds
// keep live `console.assert` calls, so the timings are diagnostics on this
// machine, not a comparison with other systems.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

import { ComputeEngine } from '../../src/compute-engine';
import { loadIntegrationRules } from '../../src/integration-rules';
import type {
  Expression,
  ExpressionInput,
} from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { cases as competition } from '../../test/compute-engine/fixtures/competition-exact';
import {
  cases as families,
  polynomialCases,
  reciprocalCases,
} from '../../test/compute-engine/fixtures/integration-families';
import { composedCases } from '../../test/compute-engine/fixtures/integration-composed';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Case = [
  string,
  ExpressionInput,
  ExpressionInput,
  ExpressionInput,
  ExpressionInput,
];

// `reversed: true` also runs each case with the bounds exchanged, against the
// negated reference: the orientation of the bounds must not change the answer
// up to its sign.
const SUITES: Record<string, { cases: Case[]; reversed: boolean }> = {
  competition: { cases: competition, reversed: true },
  families: { cases: families, reversed: true },
  reciprocal: { cases: reciprocalCases, reversed: true },
  polynomials: { cases: polynomialCases, reversed: false },
  composed: { cases: composedCases as Case[], reversed: false },
};

const { values: args } = parseArgs({
  options: {
    suite: { type: 'string', multiple: true },
    timeout: { type: 'string', default: '30000' },
  },
});
const suiteNames = args.suite ?? Object.keys(SUITES);
for (const name of suiteNames)
  if (!(name in SUITES)) throw new Error(`Unknown suite "${name}"`);
const TIMEOUT = Number(args.timeout);

const PRECISION = 60;
const DIGITS = 40;
const FLOAT_DIGITS = 10;

type Grade =
  | 'exact'
  | 'inexact'
  | 'wrong'
  | 'unverified'
  | 'unevaluated'
  | 'timeout'
  | 'error';

type Row = {
  suite: string;
  config: string;
  name: string;
  reversed: boolean;
  grade: Grade;
  reduced: boolean;
  ms: number;
  result: string;
  detail?: string;
};

function exactLeaves(e: Expression): boolean {
  if (isNumber(e)) return e.isExact;
  return !isFunction(e) || e.ops.every(exactLeaves);
}

// The comparison runs in an engine of its own, at `PRECISION` digits for the
// duration of each comparison only: `_withTransientPrecision` restores the
// precision of the engine and the global precision of the big decimals after
// it, so the solving engines keep their default precision.
const cmp = new ComputeEngine();

type Verdict = { agrees: boolean | undefined; detail?: string };

function describe(v: Expression): string {
  if (!isNumber(v)) return v.toString();
  const { re, im } = v;
  return `${re.toPrecision(6)}${
    im !== 0 ? ` ${im >= 0 ? '+' : '-'} ${Math.abs(im).toPrecision(6)}i` : ''
  }`;
}

function compare(
  result: Expression,
  reference: ExpressionInput,
  exact: boolean
): Verdict {
  try {
    return cmp._withTransientPrecision(PRECISION, (): Verdict => {
      const value = cmp.box(result.json);
      const ref = cmp.box(reference).evaluate();
      if (value.isSame(ref)) return { agrees: true };
      const valueN = value.N();
      const refN = ref.N();
      if (!isNumber(valueN) || !isNumber(refN))
        return {
          agrees: undefined,
          detail: `no numeric value: ${valueN.toString()}`,
        };
      // An infinite value, or no value, where the reference is finite (or the
      // reverse) is a wrong decision of divergence, not a rounding question.
      const finite = (n: Expression) => n.isNaN !== true && n.isFinite === true;
      if (!finite(valueN) || !finite(refN))
        return valueN.isSame(refN)
          ? { agrees: true }
          : { agrees: false, detail: `value ${valueN.toString()}` };
      // Divide by the reference inside the engine: some values (a factorial
      // ratio, a power of 2 with 600 digits) are beyond the range of a machine
      // float, but their relative difference is not.
      const diff = cmp.function('Subtract', [valueN, refN]).N();
      const rel =
        refN.re === 0 && refN.im === 0
          ? diff
          : cmp.function('Divide', [diff, refN]).N();
      const d = Math.hypot(rel.re, rel.im);
      if (!Number.isFinite(d))
        return { agrees: undefined, detail: `difference ${diff.toString()}` };
      if (d <= 10 ** -(exact ? DIGITS : FLOAT_DIGITS)) return { agrees: true };
      if (exact && d <= 10 ** -FLOAT_DIGITS)
        return {
          agrees: undefined,
          detail: `agrees to ${Math.floor(-Math.log10(d))} digits only`,
        };
      return { agrees: false, detail: `difference ${describe(diff)}` };
    });
  } catch (e) {
    return { agrees: undefined, detail: `comparison failed: ${String(e)}` };
  }
}

function reduces(
  ce: ComputeEngine,
  result: Expression,
  reference: ExpressionInput
): boolean {
  try {
    return ce.withTimeLimit(TIMEOUT, () =>
      ce
        .function('Subtract', [result, ce.box(reference).evaluate()])
        .simplify()
        .isSame(0)
    );
  } catch {
    return false;
  }
}

function makeEngine(rubi: boolean): ComputeEngine {
  const ce = new ComputeEngine();
  // The same budgets as the guard tests that load Rubi.
  if (rubi) loadIntegrationRules(ce, { timeLimitMs: 4000, stepBudget: 300000 });
  return ce;
}

const configs: [string, ComputeEngine][] = [
  ['CE', makeEngine(false)],
  ['CE+Rubi', makeEngine(true)],
];

const rows: Row[] = [];
const started = Date.now();
for (const suite of suiteNames) {
  const { cases, reversed: both } = SUITES[suite];
  for (const [config, ce] of configs) {
    for (const [name, body, lo, hi, expected] of cases) {
      for (const reversed of both ? [false, true] : [false]) {
        const reference: ExpressionInput = reversed
          ? ['Negate', expected]
          : expected;
        const request: ExpressionInput = [
          'Integrate',
          body,
          ['Limits', 'x', reversed ? hi : lo, reversed ? lo : hi],
        ];
        const row: Row = {
          suite,
          config,
          name,
          reversed,
          grade: 'error',
          reduced: false,
          ms: 0,
          result: '',
        };
        const t0 = performance.now();
        let result: Expression | undefined;
        try {
          result = ce.withTimeLimit(TIMEOUT, () => ce.box(request).evaluate());
        } catch (e) {
          // The engine signals a spent time limit or step budget with a
          // `CancellationError`. The name is checked, not the class: the Rubi
          // rules are a separate module with their own copy of the class.
          row.grade =
            e instanceof Error && e.name === 'CancellationError'
              ? 'timeout'
              : 'error';
          row.detail = String(e).slice(0, 200);
        }
        row.ms = performance.now() - t0;
        if (result) {
          row.result = result.toString();
          if (
            result.has(['Integrate', 'Limit', 'EvaluateAt', 'Sum', 'Product'])
          ) {
            row.grade = 'unevaluated';
          } else {
            const exact = exactLeaves(result);
            const { agrees, detail } = compare(result, reference, exact);
            row.detail = detail;
            if (agrees === undefined) row.grade = 'unverified';
            else if (!agrees) row.grade = 'wrong';
            else row.grade = exact ? 'exact' : 'inexact';
            row.reduced = reduces(ce, result, reference);
          }
        }
        rows.push(row);
        process.stdout.write(
          row.grade === 'exact' ? '.' : row.grade[0].toUpperCase()
        );
      }
    }
  }
}
process.stdout.write('\n');
const elapsed = (Date.now() - started) / 1000;

// --- Report -------------------------------------------------------------------

const GRADES: Grade[] = [
  'exact',
  'inexact',
  'wrong',
  'unverified',
  'unevaluated',
  'timeout',
  'error',
];
const label = (r: Row) => `${r.name}${r.reversed ? ' (reversed bounds)' : ''}`;
const clip = (s: string, n = 160) =>
  s.length > n ? s.slice(0, n - 1) + '…' : s;
const cell = (s: string) => clip(s).replace(/\|/g, '\\|');

const md: string[] = [];
md.push('# Exact definite-integration families');
md.push('');
md.push(
  'Generated by `npx tsx benchmarks/audit/integration-families.ts`. Do not edit by hand.'
);
md.push('');
md.push(
  `Run on ${new Date().toISOString().slice(0, 10)}, Node ${process.version}, ` +
    `CE from source, ${TIMEOUT / 1000} s per case, ${elapsed.toFixed(0)} s in total. ` +
    `A value agrees when it matches the reference to ${DIGITS} significant digits. ` +
    '"Reduced" counts the results for which `simplify()` reduces ' +
    '`result − reference` to 0. See the header of the script for each grade.'
);
md.push('');
md.push(
  `| Suite | Configuration | Runs | ${GRADES.join(' | ')} | Reduced | Time (s) |`
);
md.push(`|---|---|---:|${GRADES.map(() => '---:').join('|')}|---:|---:|`);
for (const suite of suiteNames)
  for (const [config] of configs) {
    const rs = rows.filter((r) => r.suite === suite && r.config === config);
    const count = (g: Grade) => rs.filter((r) => r.grade === g).length || '';
    md.push(
      `| ${suite} | ${config} | ${rs.length} | ${GRADES.map(count).join(' | ')} | ` +
        `${rs.filter((r) => r.reduced).length} | ${(rs.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1)} |`
    );
  }
md.push('');

const section = (
  title: string,
  intro: string,
  rs: Row[],
  showDetail: boolean
) => {
  md.push(`## ${title}`);
  md.push('');
  md.push(intro);
  md.push('');
  if (rs.length === 0) {
    md.push('None.');
    md.push('');
    return;
  }
  md.push(
    `| Suite | Configuration | Case | Grade | Result${showDetail ? ' | Detail' : ''} |`
  );
  md.push(`|---|---|---|---|---${showDetail ? '|---' : ''}|`);
  for (const r of rs)
    md.push(
      `| ${r.suite} | ${r.config} | ${cell(label(r))} | ${r.grade} | \`${cell(r.result || '—')}\`` +
        `${showDetail ? ` | ${cell(r.detail ?? '')}` : ''} |`
    );
  md.push('');
};

section(
  'Wrong values',
  'Each of these results disagrees with the reference value. Each is a defect.',
  rows.filter((r) => r.grade === 'wrong'),
  true
);
section(
  'No exact answer',
  'Inexact, unverified, unevaluated, timed-out and failed runs.',
  rows.filter((r) => !['exact', 'wrong'].includes(r.grade)),
  true
);
section(
  'Exact values that `simplify()` does not reduce to the reference',
  'The value is right and exact, but `simplify()` cannot show that ' +
    '`result − reference` is 0. Each line shows a simplification gap or a ' +
    'result in a form that is less simple than the reference.',
  rows.filter((r) => r.grade === 'exact' && !r.reduced),
  false
);

const slowest = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 10);
md.push('## Slowest runs');
md.push('');
md.push('| Suite | Configuration | Case | Grade | Time (ms) |');
md.push('|---|---|---|---|---:|');
for (const r of slowest)
  md.push(
    `| ${r.suite} | ${r.config} | ${cell(label(r))} | ${r.grade} | ${r.ms.toFixed(0)} |`
  );
md.push('');

writeFileSync(join(__dirname, 'REPORT-integration-families.md'), md.join('\n'));

const wrong = rows.filter((r) => r.grade === 'wrong').length;
const exact = rows.filter((r) => r.grade === 'exact').length;
console.log(
  `${rows.length} runs: ${exact} exact, ${wrong} wrong, ${rows.length - exact - wrong} other; ` +
    `${elapsed.toFixed(0)} s. Report: benchmarks/audit/REPORT-integration-families.md`
);
if (wrong > 0) process.exitCode = 1;
