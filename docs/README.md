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
| Use parse-and-transform helper methods | This file (Workflow Helpers section) |
| Understand simplification behavior snapshots | [`SIMPLIFY.md`](./SIMPLIFY.md), [`SIMPLIFICATIONS.md`](./SIMPLIFICATIONS.md) |
| Review playground sample outcomes | [`PLAYGROUND.md`](./PLAYGROUND.md) |
| Review internal architecture boundaries | [`architecture/README.md`](./architecture/README.md) |

## Workflow Helpers

High-level workflow entrypoints:

- `ce.parseSimplify(latex, options?)`
- `ce.parseEvaluate(latex, options?)`
- `ce.parseNumeric(latex, options?)`

Policy presets:

- Parse policy: `parseMode: 'strict' | 'permissive'`
- Evaluation policy: `evaluateMode: 'exact' | 'numeric'` (`parseEvaluate`)
- Simplification policy: `simplifyMode: 'default' | 'trigonometric'` (`parseSimplify`)

Option precedence (explicit low-level options win):

- `parse.strict` overrides `parseMode`
- `evaluate.numericApproximation` overrides `evaluateMode`
- `simplify.strategy` overrides `simplifyMode`

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
