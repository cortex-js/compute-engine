# Developing the Epsil extension

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
VS Code window with the extension loaded. Open a `.epsil` file there to exercise
highlighting, diagnostics and the run command.

Useful commands:

| Command                            | What it does                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run build`                    | Bundle the extension, language server, debug adapter/worker and inline runner into `dist/`. |
| `npm run watch`                    | Same, rebuilding on change.                                                                 |
| `npm test`                         | Build, then run the DAP and LSP test suites (`test/dap.test.mjs`, `test/lsp.test.mjs`).     |
| `./node_modules/.bin/tsc --noEmit` | Type-check the extension (esbuild does the emit).                                           |

The extension sources (`src/` and `test/`) use the root prettier configuration,
like the rest of the repository. The root `npm run format` and
`npm run format:check` include them, and the pre-commit hook formats them when
they are staged.

The server is transport-agnostic (`vscode-languageserver` picks its transport
from the command line), so it can also be driven directly for debugging:

```sh
node dist/server.js --stdio
```
