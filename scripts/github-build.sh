#!/bin/bash

# assume we are run from the top level
./scripts/build.sh development

mkdir -p s3-dist
cp -r dist s3-dist
mkdir -p s3-dist/test
cp test/simple.html s3-dist/test
cp test/style.css s3-dist/test
