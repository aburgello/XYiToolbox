// =============================================================================
// scripts/audit-jsx-precedence.cjs
// -----------------------------------------------------------------------------
// Guards against the ExtendScript logical-precedence engine bug that broke
// MC It! (July 2026): ExtendScript evaluates `A || B && C` LEFT-TO-RIGHT as
// `(A || B) && C`, not standard JS's `A || (B && C)`. Writing parens in the
// TS source does NOT protect you -- Babel strips redundant parens on emit, so
// `A || (B && C)` still compiles to the broken bare form. The only safe fix
// is restructuring (separate statements / no mixed ||-then-&& expression).
//
// Detection is exact, not a grep: in a standard-JS AST the broken emit is
// precisely a LogicalExpression('||') whose RIGHT child is a
// LogicalExpression('&&'). (Parens don't exist in an AST, so this flags
// parenthesized source too -- which is correct, since the parens get
// stripped.) The safe shapes are structurally different:
//   - `(A || B) && C` -> '&&' with '||' LEFT child; parens are REQUIRED so
//     they survive emit: safe.
//   - `A && B || C`   -> '||' with '&&' LEFT child; left-to-right evaluation
//     gives the same result: safe.
//
// Usage:
//   node scripts/audit-jsx-precedence.cjs             # audit src/jsx + shared + built bundle
//   node scripts/audit-jsx-precedence.cjs <files...>  # audit specific files
// Exits 1 if any dangerous expression is found (CI-friendly).
// =============================================================================
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");

const repoRoot = path.resolve(__dirname, "..");

function defaultTargets() {
  const out = [];
  const dirs = [path.join(repoRoot, "src/jsx/aeft"), path.join(repoRoot, "src/jsx"), path.join(repoRoot, "src/shared")];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/\.tsx?$/.test(f)) out.push(path.join(dir, f));
    }
  }
  const bundle = path.join(repoRoot, "dist/cep/jsx/index.js");
  if (fs.existsSync(bundle)) out.push(bundle);
  return out;
}

function auditFile(file) {
  const src = fs.readFileSync(file, "utf8");
  const ast = parser.parse(src, {
    sourceType: "unambiguous",
    errorRecovery: true,
    plugins: /\.tsx?$/.test(file) ? ["typescript"] : [],
  });

  const hits = [];
  (function walk(node) {
    if (!node || typeof node.type !== "string") return;
    if (
      node.type === "LogicalExpression" &&
      node.operator === "||" &&
      node.right &&
      node.right.type === "LogicalExpression" &&
      node.right.operator === "&&"
    ) {
      hits.push(node);
    }
    for (const key of Object.keys(node)) {
      if (key === "loc") continue;
      const v = node[key];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === "string") walk(c);
      } else if (v && typeof v.type === "string") {
        walk(v);
      }
    }
  })(ast.program);

  for (const h of hits) {
    const snippet = src.slice(h.start, Math.min(h.end, h.start + 160)).replace(/\s+/g, " ");
    console.log(path.relative(repoRoot, file) + ":" + h.loc.start.line + "  " + snippet);
  }
  return hits.length;
}

const targets = process.argv.length > 2 ? process.argv.slice(2) : defaultTargets();
let total = 0;
for (const t of targets) total += auditFile(t);

if (total === 0) {
  console.log("CLEAN — no ExtendScript-unsafe `|| ... &&` expressions in " + targets.length + " file(s).");
} else {
  console.log(
    total +
      " dangerous expression(s) found. Restructure each into separate statements " +
      "(see mcIt()'s isSameType in src/jsx/aeft/tools.ts) — parentheses alone do NOT survive Babel."
  );
  process.exit(1);
}
