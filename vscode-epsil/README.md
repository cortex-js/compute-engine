# Epsil for VS Code

Language support for [Epsil](https://github.com/cortex-js/compute-engine), the
programming language of the Cortex Compute Engine.

- **Syntax highlighting** for `.epsil` files, plus bracket matching, comment
  toggling and folding.
- **Live diagnostics** as you type: parse errors, lints, and the static type
  errors the engine catches when it canonicalizes a program. This is exactly
  what `epsil check` reports — nothing is evaluated, so checking a program has
  no side effects and never runs a long computation.
- **Epsil: Run File** (`epsil.runFile`) — saves the active file and runs it in
  an integrated terminal named _Epsil_. The command line comes from the
  `epsil.cliCommand` setting (`npx epsil` by default).
- **Epsil: Restart Language Server** (`epsil.restartServer`) for when the
  server needs a nudge.

## Settings

| Setting                    | Default     | Description                                            |
| -------------------------- | ----------- | ------------------------------------------------------ |
| `epsil.cliCommand`         | `npx epsil` | Command used by **Epsil: Run File**.                   |
| `epsil.diagnostics.enable` | `true`      | Report diagnostics as you type.                        |
| `epsil.trace.server`       | `off`       | Trace the client/server protocol in the output channel. |

## Development

This extension lives inside the `compute-engine` repository, under
`vscode-epsil/`, and the language server **bundles the engine straight from
`../src`** — there is no dependency on a published `@cortex-js/compute-engine`
package. A change to the parser or the type checker shows up in the editor as
soon as the extension is rebuilt.

```sh
cd vscode-epsil
npm install
npm run build      # or: npm run watch
```

Then press <kbd>F5</kbd> to launch an **Extension Development Host** — a second
VS Code window with the extension loaded. Open a `.epsil` file there to
exercise highlighting, diagnostics and the run command.

Useful commands:

| Command                       | What it does                                        |
| ----------------------------- | --------------------------------------------------- |
| `npm run build`               | Bundle `dist/extension.js` and `dist/server.js`.     |
| `npm run watch`               | Same, rebuilding on change.                          |
| `./node_modules/.bin/tsc --noEmit` | Type-check the extension (esbuild does the emit). |

The server is transport-agnostic (`vscode-languageserver` picks its transport
from the command line), so it can also be driven directly for debugging:

```sh
node dist/server.js --stdio
```

## License

MIT
