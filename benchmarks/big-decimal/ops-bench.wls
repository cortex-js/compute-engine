(* Primitive-op timing at 100 significant digits, mirroring ops-bench.mjs:
   distinct 100-digit operands cycled from a pool, warm, median of batches.
   Caches disabled per the run_wolfram.mjs discipline. *)
Quiet[SetSystemOptions["CacheOptions" -> {"Numeric" -> {"Cache" -> False},
  "Symbolic" -> {"Cache" -> False}}]];

prec = 100;
SeedRandom[42];
(* pool of 64 distinct ~100-digit arbitrary-precision reals, magnitude ~1 *)
pool = Table[SetPrecision[RandomReal[{1, 10}], prec], {64}];
pool2 = Table[SetPrecision[RandomReal[{1, 10}], prec], {64}];

timeOp[f_] := Module[{batch = 2000, iters = 9, times, i = 0},
  (* warmup *)
  Do[f[Mod[k, 64] + 1], {k, 200}];
  times = Table[
    First[AbsoluteTiming[
      Do[f[Mod[k, 64] + 1], {k, batch}]
    ]]*1.*^9/batch, {iters}];
  Median[times]];

ops = {
  {"add",  Function[k, pool[[k]] + pool2[[k]]]},
  {"sub",  Function[k, pool[[k]] - pool2[[k]]]},
  {"mul",  Function[k, pool[[k]]*pool2[[k]]]},
  {"div",  Function[k, pool[[k]]/pool2[[k]]]},
  {"sqrt", Function[k, Sqrt[pool[[k]]]]},
  {"cmp",  Function[k, Order[pool[[k]], pool2[[k]]]]},
  {"ln",   Function[k, Log[pool[[k]]]]},
  {"exp",  Function[k, Exp[pool[[k]]/10]]},
  {"cos",  Function[k, Cos[pool[[k]]]]}
};

Do[
  Print[op[[1]], " ", NumberForm[timeOp[op[[2]]], {10, 1}], " ns/op"],
  {op, ops}];

(* zeta(3) at 100d: fresh N each call, cache-disabled *)
zt = Module[{batch = 20, iters = 7},
  Do[N[Zeta[3], prec], {5}];
  Median[Table[First[AbsoluteTiming[Do[N[Zeta[3], prec], {batch}]]]*1.*^9/batch, {iters}]]];
Print["zeta3 ", NumberForm[zt, {10, 1}], " ns/op"];
