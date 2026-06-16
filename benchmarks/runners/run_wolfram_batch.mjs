// Batched WolframScript runner for the operation-audit family.
//
//   node run_wolfram_batch.mjs <spec.json>
//
// The capability benchmark spawns one `wolframscript` per case (run_wolfram.mjs);
// that is fine for ~39 cases but the audit harnesses run 20–50 each, and a kernel
// launch costs several seconds. This runner instead processes a whole **spec** in
// ONE kernel: it reads a JSON task list, builds a self-timing Wolfram program that
// loops over every task, and prints one JSON line per task — the same shape the
// SymPy batch runners emit (`run_sympy.py`, `run_sympy_wester.py`), so each audit
// harness can grade Wolfram with the identical logic it uses for CE and SymPy.
//
// Spec shape (written by the harness; expressions are already Wolfram Language,
// produced by mathjson-to-wl.mjs):
//
//   {
//     "real": false,                 // assume the variable is real (Wester) ?
//     "tasks": [
//       { "id", "op", "expr", "expr2"?, "var", "points"?, "point"?, "a"?, "b"? }
//     ]
//   }
//
// Supported ops: factor · expand · simplify · gcd · resultant · integrate
// (indefinite) · defint · diff · limit · solve. `point` (for limit) and `a`/`b`
// (for defint) are passed straight into Wolfram, so the harness must already have
// mapped ±∞ to `Infinity` / `-Infinity`.
//
// Per-task results: { id, tool:"wolfram", status, text, values, roots?, timeMs }
//   - integrate : values = d/dx(result) sampled at `points`   (vs the integrand)
//   - diff      : values = result sampled at `points`         (vs central diff)
//   - defint/limit/resultant : values = [the single value]
//   - factor/expand/simplify/gcd : values = result sampled at `points` (vs input)
//   - solve     : roots = real numeric roots; values = |residual| at each root
//
// If `wolframscript` is missing or the kernel dies, every task degrades to a
// single error/timeout line so the harness can still render its other columns.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [, , specPath] = process.argv;

function emit(o) { process.stdout.write(JSON.stringify(o) + '\n'); }

if (!specPath) { emit({ status: 'error', error: 'no spec path' }); process.exit(0); }
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const tasks = Array.isArray(spec.tasks) ? spec.tasks : [];

// --- build the Wolfram op source for one task ------------------------------
// Returned string is parsed (ToExpression) and run once per timed call, so the
// per-call cost includes the WL parse — parity with the SymPy runners, which
// re-`sympify` their source each call.
function buildCore(t) {
  const e = t.expr, e2 = t.expr2, v = t.var || 'x';
  const realAsm = spec.real ? `Element[${v}, Reals]` : '';
  const asmSimplify = realAsm ? `, ${realAsm}` : '';
  const asmInt = realAsm ? `, Assumptions -> ${realAsm}` : '';
  switch (t.op) {
    case 'factor': return `Factor[${e}]`;
    case 'expand': return `Expand[${e}]`;
    case 'simplify': return `FullSimplify[${e}${asmSimplify}]`;
    case 'gcd': return `PolynomialGCD[${e}, ${e2}]`;
    case 'resultant': return `Resultant[${e}, ${e2}, ${v}]`;
    case 'integrate': return `Integrate[${e}, ${v}${asmInt}]`;
    case 'defint': return `Integrate[${e}, {${v}, ${t.a}, ${t.b}}${asmInt}]`;
    // `D` takes no Assumptions, so a non-holomorphic derivative like d/dx|x| stays
    // an unevaluated `Abs'[x]` that won't numericize. Under a real variable,
    // ComplexExpand resolves it (→ Sqrt[x^2]/x = Sign[x]) and leaves ordinary
    // derivatives untouched — the parity of SymPy's `symbols(var, real=True)`.
    case 'diff': return spec.real ? `ComplexExpand[D[${e}, ${v}]]` : `D[${e}, ${v}]`;
    case 'limit': return `Limit[${e}, ${v} -> ${t.point}${asmInt}]`;
    case 'solve': return `Solve[${e} == 0, ${v}]`;
    default: return null;
  }
}

// Split tasks into runnable (valid op) and ones we reject up front.
const wlTasks = [];
const rejected = [];
for (const t of tasks) {
  const core = buildCore(t);
  if (core == null) { rejected.push({ id: t.id, tool: 'wolfram', status: 'error', error: 'unknown op ' + t.op }); continue; }
  wlTasks.push({ id: t.id, op: t.op, var: t.var || 'x', points: t.points || [], core, expr: t.expr });
}

if (!wlTasks.length) { for (const r of rejected) emit(r); process.exit(0); }

// --- the Wolfram program ----------------------------------------------------
// One kernel, one loop. Caching is disabled so warm repeats do real work (see
// the long note in run_wolfram.mjs); a tiny global warm-up pays the one-time
// FullSimplify/Integrate machinery load before the first real case is timed.
// Each task is TimeConstrained so one hard case can't stall the batch.
const tasksFile = join(tmpdir(), `ce-wlb-tasks-${process.pid}.json`);
const programFile = join(tmpdir(), `ce-wlb-prog-${process.pid}.wl`);
writeFileSync(tasksFile, JSON.stringify({ tasks: wlTasks }));

const TASK_TIMEOUT_S = 25;
const program = `
Quiet[SetSystemOptions["CacheOptions" -> {"Numeric" -> {"Cache" -> False},
  "Symbolic" -> {"Cache" -> False}, "Derivative" -> {"Cache" -> False},
  "Simplify" -> {"Cache" -> False}}]];

fmtNum[x_] := StringReplace[First[StringSplit[ToString[x, InputForm], "\`"]], "*^" -> "e"];
sampleAt[res_, var_, pts_] := Quiet[Map[
  Function[p, Module[{v = Re[N[res /. var -> p]]}, If[NumericQ[v], fmtNum[v], Null]]], pts]];
clip[s_] := StringTake[s, UpTo[200]];
emit[a_] := (WriteString[$Output, ExportString[a, "JSON", "Compact" -> True]]; WriteString[$Output, "\\n"]);

extract[op_, res_, var_, pts_, expr_] := Switch[op,
  "factor" | "expand" | "simplify" | "diff" | "gcd",
    <|"status" -> "ok", "text" -> clip[ToString[res, InputForm]], "values" -> sampleAt[res, var, pts]|>,
  "integrate",
    If[! FreeQ[res, Integrate],
      <|"status" -> "unsolved", "text" -> clip[ToString[res, InputForm]], "values" -> {}|>,
      <|"status" -> "ok", "text" -> clip[ToString[res, InputForm]], "values" -> sampleAt[D[res, var], var, pts]|>],
  "defint",
    If[! FreeQ[res, Integrate] || ! NumericQ[N[res]],
      <|"status" -> "unsolved", "text" -> clip[ToString[res, InputForm]], "values" -> {}|>,
      <|"status" -> "ok", "text" -> clip[ToString[res, InputForm]], "values" -> {fmtNum[Re[N[res]]]}|>],
  "resultant",
    If[NumericQ[N[res]],
      <|"status" -> "ok", "text" -> clip[ToString[res, InputForm]], "values" -> {fmtNum[Re[N[res]]]}|>,
      <|"status" -> "unsolved", "text" -> clip[ToString[res, InputForm]], "values" -> {}|>],
  "limit",
    If[NumericQ[N[res]] && Abs[Im[N[res]]] < 10^-9,
      <|"status" -> "ok", "text" -> clip[ToString[res, InputForm]], "values" -> {fmtNum[Re[N[res]]]}|>,
      <|"status" -> "unsolved", "text" -> clip[ToString[res, InputForm]], "values" -> {}|>],
  "solve",
    Module[{nroots, reals},
      nroots = Quiet[var /. res];
      (* Solve returns periodic / transcendental roots as parametric families,
         e.g. ConditionalExpression[2 I Pi C[1] + Log[5], C[1] in Integers].
         Take the principal member (the integer parameter = 0) so we get a
         concrete sample root; the |residual| check below still guards soundness. *)
      nroots = nroots /. ConditionalExpression[e_, _] :> e /. C[_] -> 0;
      reals = Select[Flatten[{nroots}], (NumericQ[N[#]] && Abs[Im[N[#]]] < 10^-9) &];
      If[Length[reals] > 0,
        <|"status" -> "ok", "text" -> clip[ToString[res, InputForm]],
          "values" -> Map[fmtNum[Abs[N[expr /. var -> #]]] &, reals],
          "roots" -> Map[fmtNum[Re[N[#]]] &, reals]|>,
        <|"status" -> "unsolved", "text" -> clip[ToString[res, InputForm]], "values" -> {}, "roots" -> {}|>]],
  _, <|"status" -> "error", "error" -> "unknown op"|>];

processTask[t_] := Module[{op, var, pts, expr, run, res, t0, first, batch, timeMs, payload},
  op = t["op"]; var = Symbol[t["var"]]; pts = t["points"]; expr = ToExpression[t["expr"]];
  run[] := ToExpression[t["core"]];
  payload = TimeConstrained[
    (run[];  (* warm once: pays this op's one-time machinery load (the first
                FullSimplify / Integrate of a kind is far slower), so the timing
                is steady-state — the same warm basis as the CE and SymPy runners. *)
      {t0, res} = AbsoluteTiming[run[]];
      (* AbsoluteTiming resolves to ~1µs, so a single sub-µs call would quantize
         (a fast Factor/Expand floors toward 0). Batch enough warm calls that each
         timed sample spans ~2ms — real sub-µs resolution. Slow ops get batch 1
         and the one warm measurement. Mirrors run_wolfram.mjs. *)
      first = Max[t0*1000., 0.00005];
      batch = Min[2000000, Max[1, Ceiling[2.0/first]]];
      timeMs = t0*1000.;
      If[batch > 1,
        Do[run[], {Min[3, batch]}];
        timeMs = N[Median[Table[First[AbsoluteTiming[Do[run[], {batch}]]]*1000./batch, {7}]]]];
      Append[extract[op, res, var, pts, expr], "timeMs" -> timeMs]),
    ${TASK_TIMEOUT_S}, <|"status" -> "timeout"|>];
  If[! AssociationQ[payload], payload = <|"status" -> "error", "error" -> "no payload"|>];
  Join[<|"id" -> t["id"], "tool" -> "wolfram"|>, payload]];

Quiet[Module[{xx}, FullSimplify[Sin[xx]^2 + Cos[xx]^2]; Integrate[xx^2, xx];
  D[Sin[xx], xx]; Limit[Sin[xx]/xx, xx -> 0]; Factor[xx^2 - 1]; Solve[xx^2 - 1 == 0, xx]]];

data = Import["${tasksFile.replace(/\\/g, '\\\\')}", "RawJSON"];
Do[emit[processTask[t]], {t, data["tasks"]}];
`;

// --- run --------------------------------------------------------------------
const got = new Set();
try {
  writeFileSync(programFile, program);
  // Generous overall ceiling: per-task TimeConstrained bounds each case, but a
  // big suite of slow integrals can still take minutes in aggregate.
  const out = execFileSync('wolframscript', ['-file', programFile], {
    timeout: Math.max(120000, wlTasks.length * 30000),
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
  for (const line of out.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try { const o = JSON.parse(s); if (o.id) { got.add(o.id); emit(o); } } catch { /* banner noise */ }
  }
} catch (e) {
  const isTimeout = e.killed || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT';
  const note = isTimeout ? 'timeout' : String(e.stderr || e.message || e).split('\n')[0].slice(0, 160);
  // Salvage any lines the kernel printed before it died.
  for (const line of String(e.stdout || '').split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try { const o = JSON.parse(s); if (o.id) { got.add(o.id); emit(o); } } catch { /* */ }
  }
  for (const t of wlTasks) if (!got.has(t.id)) emit({ id: t.id, tool: 'wolfram', status: isTimeout ? 'timeout' : 'error', error: note });
} finally {
  try { unlinkSync(tasksFile); } catch { /* */ }
  try { unlinkSync(programFile); } catch { /* */ }
}

// Anything the kernel silently dropped, plus the up-front rejects.
for (const t of wlTasks) if (!got.has(t.id)) emit({ id: t.id, tool: 'wolfram', status: 'error', error: 'no result' });
for (const r of rejected) emit(r);
