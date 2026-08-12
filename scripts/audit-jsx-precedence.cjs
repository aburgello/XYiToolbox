// =============================================================================
// scripts/audit-jsx-precedence.cjs
// -----------------------------------------------------------------------------
// Guards two ExtendScript parser/engine bugs, both of which survive
// parenthesised source because the emitter strips redundant parens:
//
//   1. logical precedence (below) -- broke MC It! in July 2026
//   2. a ternary nested in another ternary's CONSEQUENT -- broke the whole
//      panel on 2026-08-10 ("SyntaxError: Expected: :"); see rule 2 in
//      auditFile().
//
// Rule 1 -- the logical-precedence engine bug. ExtendScript evaluates
// `A || B && C` LEFT-TO-RIGHT as
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
  // NOTE: the built bundle (dist/cep/jsx/index.js) is deliberately NOT in the
  // default set. This runs as a PRE-build gate, and at that moment dist holds
  // the PREVIOUS build's output -- which `rimraf dist/*` deletes moments later.
  // Auditing it there is doubly wrong: it fails the build over code you already
  // fixed (a stale bad bundle), and it would pass a stale CLEAN bundle while
  // the new source is dangerous. The source scan above is authoritative on its
  // own -- the AST check flags the dangerous shape in source including
  // parenthesized forms (see header) -- so gating on source blocks a bad build
  // BEFORE anything is written. The fresh bundle is verified separately after
  // the build via `yarn audit:jsx:bundle` (belt-and-braces).
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
      hits.push({ node, rule: "|| ... &&" });
    }
    // Rule 2: a ternary nested in another ternary's CONSEQUENT.
    //
    // Emits as `a ? b ? c : d : e`, which the ExtendScript parser cannot
    // resolve -- it fails the WHOLE bundle with "SyntaxError: Expected: :",
    // so every tool in the panel dies at load. Shipped on 2026-08-10 from one
    // line in shared.ts's accent folder and broke the studio build.
    //
    // Same trap as rule 1: writing `a ? (b ? c : d) : e` does not help,
    // because esbuild strips the redundant parens on emit. Restructure into
    // if/else statements instead.
    //
    // A ternary CHAIN (`a ? x : b ? y : z`, nested in the ALTERNATE) is a
    // different AST shape, parses fine in ExtendScript, and is used widely in
    // this codebase -- so it is deliberately NOT flagged.
    if (
      node.type === "ConditionalExpression" &&
      node.consequent &&
      node.consequent.type === "ConditionalExpression"
    ) {
      hits.push({ node, rule: "nested ternary" });
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
    const n = h.node;
    const snippet = src.slice(n.start, Math.min(n.end, n.start + 160)).replace(/\s+/g, " ");
    console.log(path.relative(repoRoot, file) + ":" + n.loc.start.line + "  [" + h.rule + "]  " + snippet);
  }
  return hits.length;
}

const targets = process.argv.length > 2 ? process.argv.slice(2) : defaultTargets();
let total = 0;
for (const t of targets) total += auditFile(t);

if (total === 0) {
  console.log("CLEAN — no ExtendScript-unsafe `|| ... &&` or nested-ternary expressions in " + targets.length + " file(s).");
} else {
  console.log(
    total +
      " dangerous expression(s) found. Restructure each into separate statements or " +
      "if/else (see mcIt()'s isSameType and shared.ts's foldNameAccents) — parentheses " +
      "alone do NOT survive emit, for either rule."
  );
  process.exit(1);
}
