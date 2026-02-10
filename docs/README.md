# Compute Engine Docs Guide

This directory contains both user-facing guides and internal engineering
snapshots.

## Start Here

For installation, quick-start examples, and the main public API entrypoints,
read the repository [`README.md`](../README.md).

## Documentation Map

| Goal | Recommended doc |
| --- | --- |
| Learn package usage quickly | [`../README.md`](../README.md) |
| Use free functions for common operations | This file (Free Functions section) |
| Understand simplification behavior snapshots | [`SIMPLIFY.md`](./SIMPLIFY.md), [`SIMPLIFICATIONS.md`](./SIMPLIFICATIONS.md) |
| Review playground sample outcomes | [`PLAYGROUND.md`](./PLAYGROUND.md) |
| Review internal architecture boundaries | [`architecture/README.md`](./architecture/README.md) |

## Free Functions

Top-level free functions for common operations — no `ComputeEngine` setup required:

- `parse(latex)` — parse a LaTeX string into a `BoxedExpression`
- `simplify(latex | expr)` — simplify a LaTeX string or expression
- `evaluate(latex | expr)` — evaluate a LaTeX string or expression
- `N(latex | expr)` — compute a numeric approximation
- `expand(latex | expr)` — expand products and powers (distributive law)
- `expandAll(latex | expr)` — recursively expand all sub-expressions
- `factor(latex | expr)` — factor an expression as a product
- `solve(latex | expr, vars)` — solve an equation or system for the given variables
- `compile(latex | expr, options?)` — compile an expression to JavaScript (or another target)
- `assign(id, value)` / `assign({...})` — assign values in the shared engine

These use a shared `ComputeEngine` instance created on first call.
Use `getDefaultEngine()` to configure it (precision, angular unit, etc.).

## Extension Contracts

Runtime contract checks are enforced for extension points:

- `registerCompilationTarget(name, target)` validates target name format and required `LanguageTarget` methods (`getOperators()`, `getFunctions()`, `createTarget()`, `compile()`).
- `new ComputeEngine({ libraries: [...] })` validates custom library shape (`name`, `requires`, `definitions`, `latexDictionary`).
- `compile(expr, options)` validates extension-facing payload shape (`to`, `target`, `operators`, `functions`, `vars`, `imports`, `preamble`, `fallback`).

## Snapshot Reports

These files are useful implementation snapshots, but they are not a canonical
API reference:

- [`PLAYGROUND.md`](./PLAYGROUND.md)
- [`SIMPLIFICATIONS.md`](./SIMPLIFICATIONS.md)
- [`SIMPLIFY.md`](./SIMPLIFY.md)
