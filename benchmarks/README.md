# Python/NumPy Performance Benchmarks

This directory contains generated Python benchmarks for comparing NumPy performance
with JavaScript compilation performance.

## Setup

Install dependencies:

```bash
pip install numpy
```

## Running Benchmarks

Run the benchmark script:

```bash
python benchmarks/python-performance.py
```

## Regenerating Benchmarks

The Python benchmark script is generated from TypeScript tests. To regenerate:

```bash
npm run test compute-engine/compile-python-generate
```

## Comparing with JavaScript

To see JavaScript performance for the same expressions:

```bash
npm run test compute-engine/compile-performance
```

## Expected Results

- **NumPy**: Fast for array operations, some overhead for scalar operations
- **JavaScript Compiled**: Very fast for scalar operations, optimized by V8 JIT
- **Both**: Much faster than interpreted evaluation (40-2900x speedup)

## Use Cases

- **NumPy/Python**: Ideal for scientific computing, data analysis, ML workflows
- **JavaScript**: Ideal for browser/Node.js applications, real-time computation
- **GLSL**: Ideal for GPU parallel computation, graphics, WebGL

## Performance Tips

For NumPy:
- Use vectorized operations (arrays) instead of scalar loops
- Leverage NumPy's C-optimized implementations
- Avoid Python loops when possible

For JavaScript:
- Compiled functions are optimized by V8 JIT
- Minimal overhead for function calls
- Works great in browser and Node.js
