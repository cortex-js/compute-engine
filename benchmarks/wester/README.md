# Wester Test Suite (Mathematica)

This directory contains the Mathematica inputs from Michael Wester's
[CAS review test suite](https://math.unm.edu/~wester/cas_review.html).

The source site publishes Mathematica 3.0 session transcripts. The generated
`.m` files retain the `In[n]:=` expressions while removing prompts, results,
timings, and the final `Quit[]`. Terminal-wrapped input lines are rejoined.

Regenerate the files with:

```sh
node benchmarks/wester/extract.mjs
```
