// =============================================================================
// scripts/audit-unbound-globals.cjs
// -----------------------------------------------------------------------------
// FINDS IDENTIFIERS THE SHIPPED EXTENDSCRIPT READS BUT NEVER BINDS.
//
// This is a real, repeated failure mode with nothing watching it. CLAUDE.md
// section 6: "Neither config catches undefined ExtendScript globals either — a
// bare BATTLE_DIR typo once shipped into a build." It happened again with
// `compFor`, which bespokeFinishAndFile read out of its two CALLERS' scopes:
// every Bespoke build died at the frontcard step with "compFor is undefined",
// and the line it died on was the masters guard.
//
// Scope-aware, so a name declared in some OTHER function does not excuse a
// reference here — that is exactly the case that shipped. Run after a build:
//   node scripts/audit-unbound-globals.cjs
// =============================================================================
"use strict";
const fs = require("path") && require("fs");
const path = require("path");
const acorn = require("acorn");

const FILE = process.argv[2] || path.join(__dirname, "..", "dist", "cep", "jsx", "index.js");

// Everything the ExtendScript host provides. A name here is not a bug.
const HOST = new Set(`app File Folder Socket ExternalObject BridgeTalk XML XMLList $ system
CompItem FolderItem FootageItem Item ItemCollection Layer AVLayer ShapeLayer TextLayer
CameraLayer LightLayer LayerCollection Property PropertyBase PropertyGroup MaskPropertyGroup
Shape TextDocument MarkerValue KeyframeEase OMCollection RQItemCollection RenderQueue
Project Settings Preferences Viewer OutputModule RenderQueueItem MaskParade
PropertyType PropertyValueType KeyframeInterpolationType MaskMode MaskFeatherInterpolationType
BlendingMode TrackMatteType LayerQuality FrameBlendingType AlphaMode FieldSeparationType
PulldownPhase PurgeTarget ImportAsType ImportOptions CloseOptions SaveOptions Language
LogType RQItemStatus GetSettingsFormat TimeDisplayType FramesCountType FeetFramesFilmType
GpuAccelType ParagraphJustification AutoOrientType TimecodeDisplayType LayerSamplingQuality
ViewerType FastPreviewType PREFType TextType
FileSource SolidSource PlaceholderSource AVLayerItem ShapeLayerItem TextLayerItem
AMEFrontendEvent timeToCurrentFormat currentFormatToTime
JSON Math Number String Array Object Boolean Date RegExp Error TypeError SyntaxError RangeError
Function isNaN isFinite parseInt parseFloat encodeURI decodeURI encodeURIComponent
decodeURIComponent escape unescape undefined NaN Infinity eval alert confirm prompt
arguments this window globalThis Symbol require module exports __proto__`.split(/\s+/).filter(Boolean));

const src = fs.readFileSync(FILE, "utf8");
const ast = acorn.parse(src, { ecmaVersion: 5, allowReturnOutsideFunction: true, locations: true });

// --- scope chain -----------------------------------------------------------
function makeScope(parent) { return { parent, names: new Set() }; }

function declarePattern(node, scope) {
  if (!node) return;
  if (node.type === "Identifier") scope.names.add(node.name);
}

// Hoist var + function declarations into the function scope they belong to.
function hoist(body, scope) {
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === "FunctionDeclaration") { if (n.id) scope.names.add(n.id.name); return; }
    if (n.type === "FunctionExpression") return;              // its own scope
    if (n.type === "VariableDeclaration") n.declarations.forEach((d) => declarePattern(d.id, scope));
    for (const k in n) if (k !== "type" && k !== "loc") walk(n[k]);
  })(body);
}

const problems = [];

function visit(node, scope) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => visit(n, scope));
  if (!node.type) return;

  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
    const inner = makeScope(scope);
    if (node.id) inner.names.add(node.id.name);
    node.params.forEach((p) => declarePattern(p, inner));
    inner.names.add("arguments");
    hoist(node.body, inner);
    return visit(node.body, inner);
  }

  // A property name is not a variable: skip `.push`, `{ key: 1 }`.
  if (node.type === "MemberExpression") {
    visit(node.object, scope);
    if (node.computed) visit(node.property, scope);
    return;
  }
  if (node.type === "Property") {
    if (node.computed) visit(node.key, scope);
    return visit(node.value, scope);
  }
  // `catch (e)` binds e for the block. Missing this reported every catch
  // variable in the codebase as unbound -- 650 of them.
  if (node.type === "TryStatement") {
    visit(node.block, scope);
    if (node.handler) {
      const inner = makeScope(scope);
      declarePattern(node.handler.param, inner);
      visit(node.handler.body, inner);
    }
    if (node.finalizer) visit(node.finalizer, scope);
    return;
  }
  if (node.type === "LabeledStatement") return visit(node.body, scope);
  if (node.type === "BreakStatement" || node.type === "ContinueStatement") return;

  if (node.type === "Identifier") {
    for (let s = scope; s; s = s.parent) if (s.names.has(node.name)) return;
    if (HOST.has(node.name)) return;
    problems.push({ name: node.name, line: node.loc.start.line });
    return;
  }

  for (const k in node) if (k !== "type" && k !== "loc") visit(node[k], scope);
}

const top = makeScope(null);
hoist(ast, top);
visit(ast, top);

// One row per name, with how many times and where it first appears.
const byName = new Map();
for (const p of problems) {
  if (!byName.has(p.name)) byName.set(p.name, { count: 0, line: p.line });
  byName.get(p.name).count++;
}
if (!byName.size) {
  console.log("CLEAN — every identifier the ExtendScript reads is bound.");
  process.exit(0);
}
console.log(`UNBOUND IDENTIFIERS in ${path.relative(process.cwd(), FILE)}:\n`);
for (const [name, info] of [...byName].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${name}  —  ${info.count}x, first at line ${info.line}`);
}
console.log("\nEach of these throws a ReferenceError the moment that line runs.");
process.exit(1);
