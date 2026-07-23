---
title: Cortex CLI
sidebar_label: CLI
slug: /cortex/cli/
description: "The cortex command-line interface: run files, evaluate inline programs, or start an interactive REPL."
hide_title: true
date: Last Modified
---
# Cortex CLI

The `@cortex-js/compute-engine` package installs a `cortex` command for
evaluating Cortex source from a terminal. It can run a source file, evaluate an
inline program, read a program from standard input, or start an interactive
REPL.

:::warning

Cortex and its command-line interface are experimental. Their syntax and
behavior may change between releases.

:::

## Installation

Install the Compute Engine package in a project:

```shell
npm install @cortex-js/compute-engine
```

The package exposes `cortex` through npm's local executable directory. Run it
through `npx` or from a package script:

```shell
npx cortex --version
```

## Running Programs

With a source file:

```shell
npx cortex program.cx
```

With an inline program:

```shell
npx cortex --eval 'Simplify(2 + 2x)'
```

From standard input:

```shell
printf '1/2 + 1\n' | npx cortex
```

Use `-` as the file name to explicitly read standard input:

```shell
npx cortex - < program.cortex
```

The conventional Cortex file extensions are `.cx` and `.cortex`. A source file
can be made directly executable with a hashbang:

```cortex
#!/usr/bin/env cortex

let radius = 3
Pi * radius^2
```

## Options

| Option | Description |
|:--|:--|
| `-e`, `--eval <source>` | Evaluate Cortex source supplied on the command line. |
| `--json` | Write the result as formatted MathJSON. |
| `--cortex` | Write the result as serialized Cortex source. |
| `--time-limit <ms>` | Set the evaluation deadline in milliseconds. The default is `10000`; `0` disables it. |
| `--no-color` | Disable color in diagnostics. The [`NO_COLOR`](https://no-color.org/) environment variable is also honored. |
| `-h`, `--help` | Display command help. |
| `-v`, `--version` | Display the package version. |

`--json` and `--cortex` are mutually exclusive. With neither option, results
use the Compute Engine's ordinary textual representation.

## Interactive REPL

Run `cortex` with no file or `--eval` while standard input is a terminal:

```text
$ npx cortex
Cortex 0.92.1
Type .help for more information.

cortex> let x = 5
5
cortex> x^2
25
```

The REPL keeps one `ComputeEngine` for the session, so top-level declarations
and assignments persist between inputs. `.clear` creates a fresh engine and
clears that state.

Unclosed blocks, collections, strings, and expressions ending with an operator
continue at a secondary prompt:

```text
cortex> if (x > 0) {
...   x + 1
... }
6
```

### REPL Commands

| Command | Description |
|:--|:--|
| `.help` | List the available REPL commands. |
| `.clear` | Reset the session to a fresh `ComputeEngine`. |
| `.load <file>` | Execute a Cortex source file in the current session. |
| `.ast` | Toggle MathJSON result output. |
| `.time` | Toggle elapsed-time output. |
| `.editor` | Enter Node's multiline editor mode. |
| `.break` | Abandon the current multiline input. |
| `.save <file>` | Save the entered REPL source to a file. |
| `.exit` | Exit the REPL. |

Command history is stored in `~/.cortex_history`. Set
`CORTEX_REPL_HISTORY` to use a different path.

## Results, Diagnostics, and Exit Status

The value of the last statement is written to standard output. Diagnostics are
written to standard error with their source location and an excerpt:

```text
1:4 error: Unexpected symbol "+"
1 | 1 +
       ^
```

The process exits with:

- `0` after successful evaluation, including evaluations that emit warnings;
- `1` for source, runtime, cancellation, or file errors;
- `2` for invalid command-line usage.

Evaluation is symbolic and exact by default, just like `executeCortex()`. Use
`N(expr)` in the program when a numeric approximation is required.

Host-state pragmas such as `#env` and `#navigator` remain disabled in the CLI.
The command does not provide an option to enable them.

## Evaluation Limits

Each input has a 10-second evaluation deadline by default. This prevents a
runaway synchronous calculation from leaving an interactive session
unresponsive:

```shell
npx cortex --time-limit 30000 long-running.cx
```

Set `--time-limit 0` for no deadline. The Compute Engine's iteration and
recursion limits continue to apply independently.


