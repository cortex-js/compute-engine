#! bash

# This script is run by npm as the `postpublish` hook, i.e. automatically
# after a successful `npm publish` of the engine.
#
# The VS Code extension's language server bundles the engine FROM SOURCE at
# package time, so the .vsix must be built from the exact tree that was just
# published — running here, right after publish, is what guarantees the
# extension and the npm package contain the same engine. (The extension's
# version number was already stamped to the engine version by version.sh at
# `npm version` time.)
#
# Publishing the .vsix to the marketplace is still a manual step: the
# publisher web UI needs no token, whereas `vsce publish` and the CI job in
# .github/workflows/publish.yml require a VSCE_PAT that is not set up yet.

set -e  # exit immediately on error
cd "$(dirname "$0")/../vscode-epsil"

npm ci
npm test
npm run package

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
