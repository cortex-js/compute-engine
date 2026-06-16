// WolframScript benchmark runner.
//
//   node run_wolfram.mjs <case-id>
//
// Runs one case from ../cases.json with Wolfram Language (via the system
// `wolframscript` kernel) and prints ONE line of JSON, matching the shape
// produced by run_ce.mjs / run_py.py / run_mathjs.mjs so the orchestrator can
// treat every tool uniformly.
//
// Unlike the other runners, Wolfram has no native source dialect in cases.json.
// Instead we translate the structured **MathJSON** `ce` input — which already
// exists for every case — into a Wolfram Language expression here, then hand it
// to a small self-timing WL program. MathJSON heads map almost 1:1 onto WL
// (`["Power","x",2]` → `x^2`, `["Sin","x"]` → `Sin[x]`, `["Ln",2]` → `Log[2]`),
// so new cases get Wolfram coverage automatically. Wolfram covers every
// category: arbitrary-precision N[], FullSimplify, D, Integrate, Limit, Solve.
//
// The kernel times the operation internally (warm median, like the other
// runners) so the multi-second kernel start-up is excluded from the reported
// per-call time — it only adds wall-clock to the benchmark run.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { mathJsonToWL } from './mathjson-to-wl.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [, , caseId] = process.argv;

const suite = JSON.parse(readFileSync(join(__dirname, '..', 'cases.json'), 'utf8'));
const kase = suite.cases.find((c) => c.id === caseId);

function emit(o) {
  process.stdout.write(JSON.stringify({ id: caseId, tool: 'wolfram', ...o }) + '\n');
}
if (!kase) { emit({ status: 'error', error: 'unknown case' }); process.exit(0); }

const input = kase.inputs.ce;
if (!input) { emit({ status: 'unsupported' }); process.exit(0); }

// --- MathJSON -> Wolfram Language ------------------------------------------
// The translation is shared with the audit-family batch runner; see
// runners/mathjson-to-wl.mjs.

// --- build the Wolfram program ---------------------------------------------
// The kernel runs the operation `iters` times (warm), records millisecond
// timings, and emits one compact JSON line. `ClearSystemCache[]` before each
// timed call forces real work every iteration (mirrors the SymPy runner, which
// clears its cache for the same reason).

let exprWL;
try { exprWL = mathJsonToWL(input.mathjson); } catch (e) {
  emit({ status: 'error', error: String(e.message || e) }); process.exit(0);
}

const vr = kase.verify;
const op = input.op;

// run[] body + the extraction that turns the result `res` into `payload`.
let runBody;
let extract;
const TIMING = '"timeMs" -> med, "minMs" -> mn, "iterations" -> iters*batch';

if (op === 'N') {
  if (vr.kind === 'integer') runBody = exprWL;
  else runBody = `N[${exprWL}, ${input.precision}]`;
  extract = `payload = Association["status" -> "ok", "text" -> fmtNum[res], ` +
    `"valueText" -> fmtNum[res], "values" -> {}, ${TIMING}];`;
} else if (op === 'simplify') {
  // `x > 0` matches the positive-domain assumption the SymPy runner declares
  // (the verification sample points are all positive), so domain-valid
  // simplifications fire on equal footing — e.g. ln x + ln(x+1) → ln(x(x+1)).
  runBody = `FullSimplify[${exprWL}, x > 0]`;
  const pts = vr.points.join(', ');
  // inputText is the *un-evaluated* input (HoldForm strips its own wrapper in
  // InputForm, so we remove it), mirroring SymPy's `evaluate=False` baseline:
  // the oracle scores a simplify "correct" only when `text` differs from
  // `inputText`. Using the held form (not WL's auto-evaluated form) means a
  // non-trivial input that WL collapses on entry — e.g. x^(-1/2) − 1/√x, which
  // is identically 0 — is still credited as simplified.
  extract =
    `vals = Quiet[Map[fmtNum[Re[N[res /. x -> #]]] &, {${pts}}]];` +
    `itext = StringReplace[ToString[HoldForm[${exprWL}], InputForm], ` +
    `StartOfString ~~ "HoldForm[" ~~ inner___ ~~ "]" ~~ EndOfString :> inner];` +
    `payload = Association["status" -> "ok", "text" -> ToString[res, InputForm], ` +
    `"inputText" -> itext, "values" -> vals, ${TIMING}];`;
} else if (op === 'diff') {
  runBody = `D[${exprWL}, x]`;
  const pts = vr.points.join(', ');
  extract =
    `vals = Quiet[Map[fmtNum[Re[N[res /. x -> #]]] &, {${pts}}]];` +
    `payload = Association["status" -> "ok", "text" -> ToString[res, InputForm], ` +
    `"values" -> vals, ${TIMING}];`;
} else if (op === 'integrate') {
  // `x > 0` for parity with the SymPy runner's positive symbol (the F(b)−F(a)
  // verification intervals are all on the positive axis).
  runBody = `Integrate[${exprWL}, x, Assumptions -> x > 0]`;
  extract =
    `If[! FreeQ[res, Integrate],` +
    `  payload = Association["status" -> "unevaluated", "text" -> ToString[res, InputForm], "values" -> {}, ${TIMING}],` +
    `  dd = Re[N[(res /. x -> ${vr.b}) - (res /. x -> ${vr.a})]];` +
    `  payload = Association["status" -> "ok", "text" -> ToString[res, InputForm], "values" -> {fmtNum[dd]}, ${TIMING}]];`;
} else if (op === 'evaluate') {
  runBody = exprWL; // already a Limit[...] / Integrate[...]
  extract =
    `If[! FreeQ[res, Limit] || ! FreeQ[res, Integrate] || ! FreeQ[res, Sum] || ! NumericQ[N[res]],` +
    `  payload = Association["status" -> "unevaluated", "text" -> ToString[res, InputForm], "values" -> {}, ${TIMING}],` +
    `  payload = Association["status" -> "ok", "text" -> ToString[res, InputForm], "values" -> {fmtNum[Re[N[res]]]}, ${TIMING}]];`;
} else if (op === 'solve') {
  runBody = `Solve[${exprWL} == 0, x]`;
  extract =
    `nroots = Quiet[N[x /. res]];` +
    `reals = Select[Flatten[{nroots}], (NumericQ[#] && Abs[Im[#]] < 10^-9) &];` +
    `realvals = Map[fmtNum[Re[#]] &, reals];` +
    `payload = Association["status" -> If[Length[realvals] > 0, "ok", "unevaluated"], ` +
    `"text" -> ToString[res, InputForm], "values" -> realvals, ${TIMING}];`;
} else {
  emit({ status: 'error', error: 'unknown op ' + op }); process.exit(0);
}

// Each call is built from its WL source string via ToExpression — i.e. parsed
// each time, matching the report's "built from its source representation each
// call" protocol and the other string-parsing runners (SymPy re-`sympify`s,
// math.js re-`evaluate`s, NumPy re-`eval`s; CE re-boxes its MathJSON). Parsing a
// short WL string costs ~2–4µs, so it dominates a stored-constant read (π² ≈ 0.6
// → 4µs) but is negligible once there is real work (Γ ≈ 44µs, any symbolic op).
const runSource = runBody.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// Timing & WL's memoization. Wolfram caches the result of essentially every
// evaluation, so a naive repeat-loop measures ~25ns cache hits, not real work —
// while ClearSystemCache (the obvious antidote) costs ~0.12ms per call and would
// floor every figure there. We instead DISABLE the result caches
// (SetSystemOptions, below), warm up to pay one-time machinery loading
// (FullSimplify / Integrate first-call cost is tens of ms), then time the warm,
// uncached repeat — real work each call, no clear tax. Fundamental constants
// (π, e, factorials) are stored by the kernel and still return in ~0.1µs even
// uncached — that is genuinely how fast Wolfram is on them — whereas Γ/ζ and the
// symbolic ops then show their true cost.
const program = `
Quiet[SetSystemOptions["CacheOptions" -> {"Numeric" -> {"Cache" -> False},
  "Symbolic" -> {"Cache" -> False}, "Derivative" -> {"Cache" -> False},
  "Simplify" -> {"Cache" -> False}}]];
fmtNum[x_] := StringReplace[First[StringSplit[ToString[x, InputForm], "\`"]], "*^" -> "e"];
emit[a_] := (WriteString[$Output, ExportString[a, "JSON", "Compact" -> True]]; WriteString[$Output, "\\n"]);
result = TimeConstrained[
  Module[{run, res, t0, first, batch, iters, times, med, mn, vals, itext, dd, nroots, reals, realvals, payload},
    run[] := ToExpression["${runSource}"];
    (* Warm up first so the estimate excludes one-time machinery loading. *)
    run[]; run[]; run[];
    {t0, res} = AbsoluteTiming[run[]];
    first = Max[t0*1000., 0.00005];
    (* Batch enough warm calls that each timed sample spans >= ~2ms, far above
       the ~1us AbsoluteTiming resolution (so sub-µs ops like D[sin x] or a
       stored-constant lookup don't quantize to 0). Ops already >= 2ms get
       batch 1. Caching is disabled (above), so every call does real work. *)
    batch = Min[2000000, Max[1, Ceiling[2.0/first]]];
    iters = Min[30, Max[5, Round[200./(first*batch)]]];
    Do[run[], {Min[3, iters]*batch}];
    times = Table[First[AbsoluteTiming[Do[run[], {batch}]]]*1000./batch, {iters}];
    med = N[Median[times]]; mn = N[Min[times]];
    res = run[];
    ${extract}
    payload
  ], 16, "TIMEOUT"];
If[result === "TIMEOUT",
  emit[Association["status" -> "timeout"]],
  If[AssociationQ[result], emit[result],
    emit[Association["status" -> "error", "error" -> "no payload"]]]];
`;

const tmp = join(tmpdir(), `ce-wl-${caseId}-${process.pid}.wl`);
try {
  writeFileSync(tmp, program);
  const out = execFileSync('wolframscript', ['-file', tmp], {
    timeout: 18000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  // The kernel may print license/banner noise on other lines; take the last
  // line that parses as a JSON object.
  let parsed = null;
  for (const line of out.trim().split('\n')) {
    const s = line.trim();
    if (s.startsWith('{')) { try { parsed = JSON.parse(s); } catch { /* keep scanning */ } }
  }
  if (parsed) emit(parsed);
  else emit({ status: 'error', error: (out.trim().split('\n').pop() || 'no output').slice(0, 200) });
} catch (e) {
  if (e.killed || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT') emit({ status: 'timeout' });
  else emit({ status: 'error', error: String((e.stderr || e.message || e)).split('\n')[0].slice(0, 200) });
} finally {
  try { unlinkSync(tmp); } catch { /* ignore */ }
}
