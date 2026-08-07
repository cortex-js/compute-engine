---
title: Epsil in Visual Studio Code
sidebar_label: VSCode
slug: /epsil/vscode/
description: "The Epsil extension for Visual Studio Code: syntax highlighting, live diagnostics, and running programs from the editor."
hide_title: true
date: Last Modified
---
# Epsil in Visual Studio Code

The Epsil extension for Visual Studio Code provides language support for
`.epsil` source files:

- **Syntax highlighting** for the full grammar: nested block comments, string
  interpolation, multiline and raw strings, verbatim symbols, `$…$` LaTeX
  islands, pragmas, and number literals.
- **Live diagnostics** as you type: parse errors, lints, and static type
  errors, reported by the same checker as `epsil check`.
- **Run commands**: execute the current file in the integrated terminal with
  one click.

:::warning

Epsil and its Visual Studio Code extension are experimental. Their syntax and
behavior may change between releases.

:::

## Installation

The extension is not yet published to the Visual Studio Code Marketplace. To
install it from the repository:

```shell
git clone https://github.com/cortex-js/compute-engine.git
cd compute-engine/vscode-epsil
npm install
npm run build
npx @vscode/vsce package
code --install-extension epsil-0.1.0.vsix
```

Reinstall the `.vsix` after pulling changes to the extension.

## Editing

Opening a file with the `.epsil` extension activates the language support.
Highlighting follows the conventions of the language: capitalized identifiers
(`Sin`, `Simplify`) are library operators, lowercase identifiers are user
symbols, and merely-reserved words are not highlighted as keywords.

Diagnostics appear inline (squiggles) and in the Problems panel. They are the
same diagnostics `epsil check` reports: syntax errors, lints such as
`zero-index`, and the type errors the engine detects when the program is
canonicalized. The editor **never evaluates your program** — checking is
static, so a long-running computation in a file does not affect editing.

```epsil
let radius = 1/2
let area = Pi * radius^2
N(area)
```

## Running

With an Epsil file in the active editor, use the run button (▷) in the editor
title bar, or **Epsil: Run File** from the Command Palette. The file is saved,
then executed in an integrated terminal named `Epsil`, from the workspace
folder of the file:

```shell
npx epsil program.epsil
```

The command used is configurable (see below): by default it is `npx epsil`,
which resolves the CLI from the project's installed
`@cortex-js/compute-engine` package.

## Commands

<div className="symbols-table" style={{"--first-col-width":"26ch"}}>

| Command                              | Action                                                          |
| :----------------------------------- | :-------------------------------------------------------------- |
| **Epsil: Run File**                  | Save the active Epsil file and run it in the integrated terminal |
| **Epsil: Restart Language Server**   | Restart the diagnostics server                                  |

</div>

## Settings

<div className="symbols-table" style={{"--first-col-width":"26ch"}}>

| Setting                     | Default     | Purpose                                                     |
| :-------------------------- | :---------- | :---------------------------------------------------------- |
| `epsil.cliCommand`          | `npx epsil` | Command used by **Epsil: Run File** to execute a source file |
| `epsil.diagnostics.enable`  | `true`      | Report diagnostics as you type                              |
| `epsil.trace.server`        | `off`       | Log the language-server protocol traffic (for debugging)    |

</div>

Settings can be set per workspace. For example, a project that runs Epsil from
a local build rather than an installed package can override the run command in
its `.vscode/settings.json`:

```json
{ "epsil.cliCommand": "node ./build/epsil.js" }
```

## Contributing

The extension lives in the
[`vscode-epsil/`](https://github.com/cortex-js/compute-engine/tree/main/vscode-epsil)
directory of the Compute Engine repository. It bundles the engine from source,
so changes to the language are picked up by rebuilding the extension. See its
`README.md` for the development workflow (launch configurations for running
and debugging the extension and its language server are included), and
`examples/demo.epsil` for a tour of the language support.

Completions, hover documentation, formatting, and notebook support are planned
but not yet implemented.
