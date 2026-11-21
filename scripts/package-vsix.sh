#! bash

# Usage: bash scripts/package-vsix.sh
#
# Packages the VS Code extension as vscode-epsil/epsil.vsix.
# scripts/release.sh runs this script as its last step, after it tags and
# pushes the release. A plain `npm publish` does not run it: after one, run
# this script by hand, from the tree that was published.
#
# The VS Code extension's language server bundles the engine FROM SOURCE at
# package time, so the .vsix must be built from the exact tree that was
# published: that is what guarantees that the extension and the npm package
# contain the same engine. (The extension's version number was already
# stamped to the engine version by version.sh at `npm version` time.)
#
# Publishing the .vsix to the marketplace is still a manual step: the
# publisher web UI needs no token, whereas `vsce publish` and the CI job in
# .github/workflows/publish.yml require a VSCE_PAT that is not set up yet.

set -e  # exit immediately on error

cd "$(dirname "$0")/../vscode-epsil"

# Each step writes its output to a log and prints one line; a failing step
# prints its log (scripts/run-quietly.sh).
QUIET="bash ../scripts/run-quietly.sh"
$QUIET "VS Code extension: install" npm ci
$QUIET "VS Code extension: build and test" npm test
$QUIET "VS Code extension: package" npm run package

VERSION=$(node -pe "require('./package.json').version")
VSIX_PATH="$(pwd)/epsil.vsix"
echo
echo "─────────────────────────────────────────────────────────────────────"
echo "✓ VS Code extension packaged: v$VERSION"
echo "  $VSIX_PATH"
echo
echo "To publish it to the marketplace:"
echo
echo "  1. Visit https://marketplace.visualstudio.com/manage/publishers/FarfieldStudio"
echo "     (sign in with the personal Microsoft account)"
echo "  2. On the 'epsil' extension row, open the '…' menu and choose 'Update'"
echo "  3. Upload the .vsix file above"
echo "  4. Wait for validation (a few minutes), then confirm the listing"
echo "     shows v$VERSION"
echo "─────────────────────────────────────────────────────────────────────"
