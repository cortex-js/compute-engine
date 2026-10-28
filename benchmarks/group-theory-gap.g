# Independent mathematical workloads; no GAP implementation source is copied.
# Run in GAP 4.15.1 with -q -A -b. The companion result records Docker limits.
# Group objects are fresh per sample: cached attributes never cross samples.
# Query timing excludes descriptor construction, as in the CE kernel benchmarks.
# Generic permutation/matrix groups avoid precomputed orders from named groups.

BreakOnError := false;;
SizeScreen([4096, 24]);;
warmups := 3;;
samples := 9;;
timer := NanosecondsSinceEpochInfo();;
Print("{\"kind\":\"metadata\",\"gap\":\"", GAPInfo.Version,
  "\",\"architecture\":\"", GAPInfo.Architecture,
  "\",\"timer\":\"", timer.Method, "\",\"timerResolutionNs\":",
  timer.Resolution, ",\"timerMonotonic\":", timer.Monotonic,
  ",\"timerReliable\":", timer.Reliable,
  ",\"warmups\":", warmups, ",\"samples\":", samples,
  ",\"packagesAutoloaded\":false,\"platform\":\"Linux container\",",
  "\"cpuLimit\":2,\"memoryLimitBytes\":1073741824,",
  "\"image\":\"ghcr.io/gap-system/gap:4.15.1-bare\",",
  "\"imageDigest\":\"sha256:7d5e5f22fa865a24080d544b1067932250e453b713f03925746bea3a775d15cc\",",
  "\"comparisonLimits\":\"Windows Node26 versus Linux Docker; different group representations and implementations; query construction excluded; GAP timer is not monotonic\"}\n");

Measure := function(name, factory, query, expected)
  local run, group, started, elapsed, result, timings, sorted, caught;
  timings := [];
  for run in [1..warmups + samples] do
    group := factory();
    started := NanosecondsSinceEpoch();
    caught := CALL_WITH_CATCH(function() return query(group); end, []);
    elapsed := NanosecondsSinceEpoch() - started;
    if not caught[1] then
      Print("{\"kind\":\"measurement\",\"name\":\"", name,
        "\",\"status\":\"skipped\",\"reason\":\"workload unavailable in bare GAP; see stderr\"}\n");
      return;
    fi;
    result := caught[2];
    if result <> expected then
      Print("{\"kind\":\"measurement\",\"name\":\"", name,
        "\",\"status\":\"incorrect\",\"result\":\"", result,
        "\",\"expected\":\"", expected, "\"}\n");
      QUIT_GAP(2);
    fi;
    if elapsed < 0 then
      Print("{\"kind\":\"measurement\",\"name\":\"", name,
        "\",\"status\":\"skipped\",\"reason\":\"non-monotonic clock moved backwards\"}\n");
      return;
    fi;
    if run > warmups then Add(timings, elapsed); fi;
  od;
  sorted := SortedList(timings);
  Print("{\"kind\":\"measurement\",\"name\":\"", name,
    "\",\"status\":\"ok\",\"result\":", result,
    ",\"samplesNs\":", timings, ",\"medianNs\":", sorted[5],
    ",\"minNs\":", sorted[1], ",\"maxNs\":", sorted[9], "}\n");
end;;

Elementary := function()
  local generators, bit;
  generators := [];
  for bit in List([0..6], i -> 2^i) do
    Add(generators, PermList(List([0..127],
      point -> point + bit * (1 - 2 * (QuoInt(point, bit) mod 2)) + 1)));
  od;
  return Group(generators);
end;;

Dihedral := function()
  local rotation, reflection;
  rotation := PermList(List([0..127], function(point)
    if point < 64 then return ((point + 1) mod 64) + 1; fi;
    return ((point - 1) mod 64) + 65;
  end));
  reflection := PermList(List([0..127], point -> ((point + 64) mod 128) + 1));
  return Group(rotation, reflection);
end;;

# Automorphism queries use GAP's solvable-group methods. Conversion to its
# polycyclic representation is measured separately and excluded from the query.
DihedralPc := function() return Image(IsomorphismPcGroup(Dihedral())); end;;

SymmetricFour := function() return Group((1,2,3,4), (1,2)); end;;

Linear := function(dimension)
  local generators, i, matrix;
  generators := [];
  for i in [1..dimension - 1] do
    matrix := IdentityMat(dimension, GF(2));
    matrix[i][i + 1] := One(GF(2));
    Add(generators, matrix);
    matrix := IdentityMat(dimension, GF(2));
    matrix[i + 1][i] := One(GF(2));
    Add(generators, matrix);
  od;
  return Group(generators);
end;;

Measure("C2^7 generic descriptor construction", function() return fail; end,
  ignored -> Length(GeneratorsOfGroup(Elementary())), 7);
Measure("C2^7 Sylow(2)", Elementary, group -> Size(SylowSubgroup(group, 2)), 128);
Measure("C2^7 Frattini", Elementary, group -> Size(FrattiniSubgroup(group)), 1);
Measure("C2^7 simplicity", Elementary, IsSimpleGroup, false);
Measure("C2^7 minimum generators", Elementary, group -> Length(MinimalGeneratingSet(group)), 7);
Measure("D128 pc representation construction", function() return fail; end,
  ignored -> Size(DihedralPc()), 128);
Measure("D128 pc automorphisms explicit images", DihedralPc, function(group)
  local elements, maps, images;
  elements := Elements(group);
  maps := Elements(AutomorphismGroup(group));
  images := List(maps, mapping -> List(elements, point -> Image(mapping, point)));
  return Length(images);
end, 2048);
Measure("S4 pcgs", SymmetricFour, group -> Product(RelativeOrders(Pcgs(group))), 24);
Measure("C2^7 pcgs", Elementary, group -> Product(RelativeOrders(Pcgs(group))), 128);

for dimension in [4..6] do
  expected := Product([0..dimension - 1], i -> 2^dimension - 2^i);
  Measure(Concatenation("GL(", String(dimension), ",2) generic descriptor construction"),
    function() return fail; end, ignored -> Length(GeneratorsOfGroup(Linear(dimension))),
    2 * (dimension - 1));
  Measure(Concatenation("GL(", String(dimension), ",2) exact order"),
    function() return Linear(dimension); end, Size, expected);
od;
QUIT_GAP(0);
