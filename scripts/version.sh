#! bash

# This script is run by npm when `npm version` is invoked
# At this point the package.json version field has been
# updated and a corresponding git tag has been created

set -e  # exit immediately on error
cd "$(dirname "$0")/.."


# Update the CHANGELOG file with the current version number and date
PACKAGE_VERSION=$(node -pe "require('./package.json').version")
DATE_STAMP=$(date +%F)

# On Linux, the -i switch can be used without an extension argument
# On macOS, the -i switch must be followed by an extension argument (which can be empty)
# On Windows, the argument of the -i switch is optional, but if present it must follow it immediately without a space in between
sedi () {
    sed --version >/dev/null 2>&1 && sed -i -- "$@" || sed -i "" "$@"
}

sedi -e 's/\[Unreleased\]/'"$PACKAGE_VERSION"' _'"$DATE_STAMP"'_/g' CHANGELOG.md

git add CHANGELOG.md


# Keep the VS Code extension version in lockstep with the engine.
#
# The extension's language server bundles the engine FROM SOURCE at package
# time, so a published extension is frozen to whatever engine was in the tree
# when it was built. Sharing the version number is what makes "which engine is
# inside this extension?" answerable without a lookup table.
#
# Both package.json and package-lock.json carry the version: `npm ci` in
# vscode-epsil/ fails if the two disagree, which would break the release
# workflow rather than the local build.
node -e '
  const fs = require("fs");
  const version = process.argv[1];
  for (const f of ["vscode-epsil/package.json", "vscode-epsil/package-lock.json"]) {
    const json = JSON.parse(fs.readFileSync(f, "utf8"));
    json.version = version;
    if (json.packages && json.packages[""]) json.packages[""].version = version;
    fs.writeFileSync(f, JSON.stringify(json, null, 2) + "\n");
  }
' "$PACKAGE_VERSION"

git add vscode-epsil/package.json vscode-epsil/package-lock.json
