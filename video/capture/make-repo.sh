#!/usr/bin/env bash
# ./make-repo.sh <folder>   a small throwaway Node project for the video's agents to work on
set -euo pipefail

repo="${1:?folder for the throwaway repository}"
rm -rf "$repo"
mkdir -p "$repo/src" "$repo/test" "$repo/.claude"
cd "$repo"

cat > package.json <<'JSON'
{
  "name": "tiny-shop",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
JSON

cat > src/cart.js <<'JS'
export function total(items) {
  return items.reduce((sum, item) => sum + item.cents * item.quantity, 0);
}
JS

cat > test/cart.test.js <<'JS'
import assert from "node:assert/strict";
import test from "node:test";
import { total } from "../src/cart.js";

test("total adds up every line", () => {
  assert.equal(total([{ cents: 250, quantity: 2 }, { cents: 100, quantity: 1 }]), 600);
});
JS

cat > AGENTS.md <<'MD'
# tiny-shop

A tiny cart library. Plain Node, no dependencies. `npm test` runs the tests.
Keep every change small: one module in `src/`, one test file in `test/`.
MD
ln -s AGENTS.md CLAUDE.md

cat > .claude/settings.json <<'JSON'
{
  "permissions": {
    "allow": ["Read", "Edit", "Write", "Bash"]
  }
}
JSON

git init -q -b main
git add -A
git -c user.name="tiny-shop" -c user.email="tiny-shop@example.com" -c commit.gpgsign=false commit -qm "Start tiny-shop"
git config user.name "tiny-shop"
git config user.email "tiny-shop@example.com"
git config commit.gpgsign false
echo "$repo"
