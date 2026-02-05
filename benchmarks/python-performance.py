#!/usr/bin/env python3
"""
Python/NumPy Performance Benchmarks
Generated from Compute Engine expressions

This script benchmarks NumPy-compiled mathematical expressions
and compares performance with pure Python evaluation.

Run with: python benchmarks/python-performance.py

Requirements:
  pip install numpy
"""

import numpy as np
import os
import sys
import time
from typing import Dict, Any, Callable

def benchmark(fn: Callable, iterations: int, **kwargs) -> float:
    """Benchmark a function over multiple iterations"""
    start = time.perf_counter()
    for _ in range(iterations):
        fn(**kwargs)
    end = time.perf_counter()
    return (end - start) * 1000  # Convert to milliseconds

def is_verbose() -> bool:
    return ('--verbose' in sys.argv) or ('-v' in sys.argv) or (os.getenv('BENCH_VERBOSE') == '1')

# Generated benchmark functions

def simple_power(x, y, z):
    r"""Simple Power: x^2 + y^2 + z^2"""
    return x ** 2 + y ** 2 + z ** 2


def polynomial(x):
    r"""Polynomial: x^4 + 3x^3 + 2x^2 + x + 1"""
    return x ** 4 + 3 * x ** 3 + 2 * x ** 2 + x + 1


def trigonometric(x, y, z):
    r"""Trigonometric: \sin(x) + \cos(y) + \tan(z)"""
    return np.sin(x) + np.cos(y) + np.tan(z)


def nested_expression(x, y, z, a, b, c):
    r"""Nested Expression: \sqrt{(x-a)^2 + (y-b)^2 + (z-c)^2}"""
    return np.sqrt((-a + x) ** 2 + (-b + y) ** 2 + (-c + z) ** 2)


def large_expression__50_terms_(x):
    r"""Large Expression (50 terms): x^0 + x^1 + x^2 + x^3 + x^4 + x^5 + x^6 + x^7 + x^8 + x^9 + x^10 + x^11 + x^12 + x^13 + x^14 + x^15 + x^16 + x^17 + x^18 + x^19 + x^20 + x^21 + x^22 + x^23 + x^24 + x^25 + x^26 + x^27 + x^28 + x^29 + x^30 + x^31 + x^32 + x^33 + x^34 + x^35 + x^36 + x^37 + x^38 + x^39 + x^40 + x^41 + x^42 + x^43 + x^44 + x^45 + x^46 + x^47 + x^48 + x^49"""
    return x ** 9 + x ** 8 + x ** 7 + x ** 6 + x ** 5 + 0 * x ** 4 + 2 * x ** 4 + 3 * x ** 4 + 4 * x ** 4 + 5 * x ** 4 + 6 * x ** 4 + 7 * x ** 4 + 8 * x ** 4 + 9 * x ** 4 + x ** 4 + x ** 4 + 0 * x ** 3 + 2 * x ** 3 + 3 * x ** 3 + 4 * x ** 3 + 5 * x ** 3 + 6 * x ** 3 + 7 * x ** 3 + 8 * x ** 3 + 9 * x ** 3 + x ** 3 + x ** 3 + 0 * x ** 2 + 2 * x ** 2 + 3 * x ** 2 + 4 * x ** 2 + 5 * x ** 2 + 6 * x ** 2 + 7 * x ** 2 + 8 * x ** 2 + 9 * x ** 2 + x ** 2 + x ** 2 + x + x + 0 * x + 2 * x + 3 * x + 4 * x + 5 * x + 6 * x + 7 * x + 8 * x + 9 * x + x ** 0


def many_variables__20_vars_(x_0, x_1, x_2, x_3, x_4, x_5, x_6, x_7, x_8, x_9, x_10, x_11, x_12, x_13, x_14, x_15, x_16, x_17, x_18, x_19):
    r"""Many Variables (20 vars): x_{0} + x_{1} + x_{2} + x_{3} + x_{4} + x_{5} + x_{6} + x_{7} + x_{8} + x_{9} + x_{10} + x_{11} + x_{12} + x_{13} + x_{14} + x_{15} + x_{16} + x_{17} + x_{18} + x_{19}"""
    return x_0 + x_1 + x_10 + x_11 + x_12 + x_13 + x_14 + x_15 + x_16 + x_17 + x_18 + x_19 + x_2 + x_3 + x_4 + x_5 + x_6 + x_7 + x_8 + x_9


def distance_formula(x_1, y_1, x_2, y_2):
    r"""Distance Formula: \sqrt{(x_2-x_1)^2 + (y_2-y_1)^2}"""
    return np.sqrt((-x_1 + x_2) ** 2 + (-y_1 + y_2) ** 2)


def quadratic_formula(a, b, c):
    r"""Quadratic Formula: \frac{-b + \sqrt{b^2 - 4ac}}{2a}"""
    return (-b + np.sqrt(b ** 2 + -4 * a * c)) / (2 * a)


def kinematics(u, a, t):
    r"""Kinematics: u \cdot t + \frac{1}{2} a \cdot t^2"""
    return 0.5 * a * t ** 2 + t * u


# Benchmark suite
def run_benchmarks():
    """Run all benchmarks and display results"""
    verbose = is_verbose()
    if verbose:
        print("=" * 80)
        print("Python/NumPy Performance Benchmarks")
        print("=" * 80)
        print()
    else:
        print("Python/NumPy Performance Benchmarks (summary)")

    results = []

    # Simple Power
    if verbose:
        print(f"Running: Simple Power (10,000 iterations)")
    test_data_simple_power = {"x":3,"y":4,"z":5}
    time_simple_power = benchmark(simple_power, 10000, **test_data_simple_power)
    result_simple_power = simple_power(**test_data_simple_power)
    if verbose:
        print(f"  Time: {time_simple_power:.2f} ms")
        print(f"  Result: {result_simple_power}")
    results.append({
        'name': 'Simple Power',
        'iterations': 10000,
        'time_ms': time_simple_power,
        'time_per_op_us': (time_simple_power * 1000) / 10000,
        'result': result_simple_power
    })
    if verbose:
        print()

    # Polynomial
    if verbose:
        print(f"Running: Polynomial (10,000 iterations)")
    test_data_polynomial = {"x":2.5}
    time_polynomial = benchmark(polynomial, 10000, **test_data_polynomial)
    result_polynomial = polynomial(**test_data_polynomial)
    if verbose:
        print(f"  Time: {time_polynomial:.2f} ms")
        print(f"  Result: {result_polynomial}")
    results.append({
        'name': 'Polynomial',
        'iterations': 10000,
        'time_ms': time_polynomial,
        'time_per_op_us': (time_polynomial * 1000) / 10000,
        'result': result_polynomial
    })
    if verbose:
        print()

    # Trigonometric
    if verbose:
        print(f"Running: Trigonometric (10,000 iterations)")
    test_data_trigonometric = {"x":1,"y":2,"z":3}
    time_trigonometric = benchmark(trigonometric, 10000, **test_data_trigonometric)
    result_trigonometric = trigonometric(**test_data_trigonometric)
    if verbose:
        print(f"  Time: {time_trigonometric:.2f} ms")
        print(f"  Result: {result_trigonometric}")
    results.append({
        'name': 'Trigonometric',
        'iterations': 10000,
        'time_ms': time_trigonometric,
        'time_per_op_us': (time_trigonometric * 1000) / 10000,
        'result': result_trigonometric
    })
    if verbose:
        print()

    # Nested Expression
    if verbose:
        print(f"Running: Nested Expression (10,000 iterations)")
    test_data_nested_expression = {"x":5,"y":6,"z":7,"a":1,"b":2,"c":3}
    time_nested_expression = benchmark(nested_expression, 10000, **test_data_nested_expression)
    result_nested_expression = nested_expression(**test_data_nested_expression)
    if verbose:
        print(f"  Time: {time_nested_expression:.2f} ms")
        print(f"  Result: {result_nested_expression}")
    results.append({
        'name': 'Nested Expression',
        'iterations': 10000,
        'time_ms': time_nested_expression,
        'time_per_op_us': (time_nested_expression * 1000) / 10000,
        'result': result_nested_expression
    })
    if verbose:
        print()

    # Large Expression (50 terms)
    if verbose:
        print(f"Running: Large Expression (50 terms) (1,000 iterations)")
    test_data_large_expression__50_terms_ = {"x":1.1}
    time_large_expression__50_terms_ = benchmark(large_expression__50_terms_, 1000, **test_data_large_expression__50_terms_)
    result_large_expression__50_terms_ = large_expression__50_terms_(**test_data_large_expression__50_terms_)
    if verbose:
        print(f"  Time: {time_large_expression__50_terms_:.2f} ms")
        print(f"  Result: {result_large_expression__50_terms_}")
    results.append({
        'name': 'Large Expression (50 terms)',
        'iterations': 1000,
        'time_ms': time_large_expression__50_terms_,
        'time_per_op_us': (time_large_expression__50_terms_ * 1000) / 1000,
        'result': result_large_expression__50_terms_
    })
    if verbose:
        print()

    # Many Variables (20 vars)
    if verbose:
        print(f"Running: Many Variables (20 vars) (10,000 iterations)")
    test_data_many_variables__20_vars_ = {"x_0":1,"x_1":2,"x_2":3,"x_3":4,"x_4":5,"x_5":6,"x_6":7,"x_7":8,"x_8":9,"x_9":10,"x_10":11,"x_11":12,"x_12":13,"x_13":14,"x_14":15,"x_15":16,"x_16":17,"x_17":18,"x_18":19,"x_19":20}
    time_many_variables__20_vars_ = benchmark(many_variables__20_vars_, 10000, **test_data_many_variables__20_vars_)
    result_many_variables__20_vars_ = many_variables__20_vars_(**test_data_many_variables__20_vars_)
    if verbose:
        print(f"  Time: {time_many_variables__20_vars_:.2f} ms")
        print(f"  Result: {result_many_variables__20_vars_}")
    results.append({
        'name': 'Many Variables (20 vars)',
        'iterations': 10000,
        'time_ms': time_many_variables__20_vars_,
        'time_per_op_us': (time_many_variables__20_vars_ * 1000) / 10000,
        'result': result_many_variables__20_vars_
    })
    if verbose:
        print()

    # Distance Formula
    if verbose:
        print(f"Running: Distance Formula (10,000 iterations)")
    test_data_distance_formula = {"x_1":0,"y_1":0,"x_2":3,"y_2":4}
    time_distance_formula = benchmark(distance_formula, 10000, **test_data_distance_formula)
    result_distance_formula = distance_formula(**test_data_distance_formula)
    if verbose:
        print(f"  Time: {time_distance_formula:.2f} ms")
        print(f"  Result: {result_distance_formula}")
    results.append({
        'name': 'Distance Formula',
        'iterations': 10000,
        'time_ms': time_distance_formula,
        'time_per_op_us': (time_distance_formula * 1000) / 10000,
        'result': result_distance_formula
    })
    if verbose:
        print()

    # Quadratic Formula
    if verbose:
        print(f"Running: Quadratic Formula (10,000 iterations)")
    test_data_quadratic_formula = {"a":1,"b":-5,"c":6}
    time_quadratic_formula = benchmark(quadratic_formula, 10000, **test_data_quadratic_formula)
    result_quadratic_formula = quadratic_formula(**test_data_quadratic_formula)
    if verbose:
        print(f"  Time: {time_quadratic_formula:.2f} ms")
        print(f"  Result: {result_quadratic_formula}")
    results.append({
        'name': 'Quadratic Formula',
        'iterations': 10000,
        'time_ms': time_quadratic_formula,
        'time_per_op_us': (time_quadratic_formula * 1000) / 10000,
        'result': result_quadratic_formula
    })
    if verbose:
        print()

    # Kinematics
    if verbose:
        print(f"Running: Kinematics (10,000 iterations)")
    test_data_kinematics = {"u":10,"a":9.8,"t":2}
    time_kinematics = benchmark(kinematics, 10000, **test_data_kinematics)
    result_kinematics = kinematics(**test_data_kinematics)
    if verbose:
        print(f"  Time: {time_kinematics:.2f} ms")
        print(f"  Result: {result_kinematics}")
    results.append({
        'name': 'Kinematics',
        'iterations': 10000,
        'time_ms': time_kinematics,
        'time_per_op_us': (time_kinematics * 1000) / 10000,
        'result': result_kinematics
    })
    if verbose:
        print()

    # Summary
    print("=" * 80)
    print("Summary")
    print("=" * 80)
    print()
    print(f"{'Benchmark':<30} {'Iterations':<12} {'Total (ms)':<12} {'Per Op (μs)':<12}")
    print("-" * 80)

    for r in results:
        print(f"{r['name']:<30} {r['iterations']:<12,} {r['time_ms']:<12.2f} {r['time_per_op_us']:<12.6f}")

    print()
    if verbose:
        print("=" * 80)
        print("Comparison with JavaScript (from compile-performance.test.ts)")
        print("=" * 80)
        print()
        print("To compare with JavaScript performance:")
        print("  npm run test compute-engine/compile-performance")
        print()
        print("Expected results:")
        print("  - NumPy should be faster than JavaScript for vectorized operations")
        print("  - JavaScript may be faster for single evaluations (less overhead)")
        print("  - Both should be much faster than interpreted evaluation")
        print()
    else:
        print("Tip: run with --verbose (or set BENCH_VERBOSE=1) for per-benchmark output.")

if __name__ == '__main__':
    run_benchmarks()
