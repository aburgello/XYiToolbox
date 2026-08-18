// =============================================================================
// scripts/agent-headless.cjs
// -----------------------------------------------------------------------------
// Loads the Ask agent's REAL system prompt and tool definitions into Node.
//
// Bundled from source rather than re-derived by scraping string literals. The
// scraped version was wrong by a third: systemPrompt() appends
// buildCapabilityList() and buildRunnableActionList() at runtime, ~14k chars of
// generated panel inventory that no amount of reading the array literal will
// show you. A cost report built on the literal quietly understated every figure
// it printed.
//
// The stubs below are the browser surface the CEP bridge touches on the way in.
// None of it is called -- the prompt builder only reads the registry.
// =============================================================================
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");

let cached = null;

function loadAgent() {
    if (cached) return cached;

    const out = path.join(os.tmpdir(), "xyi-agent-headless.cjs");
    const entry = path.join(os.tmpdir(), "xyi-agent-headless-entry.ts");
    fs.writeFileSync(entry,
        'export { systemPrompt } from "' + path.join(ROOT, "src/js/main/lib/agent/loop") + '";\n' +
        'export { TOOLS } from "' + path.join(ROOT, "src/js/main/lib/agent/tools") + '";\n');

    execFileSync("npx", ["esbuild", entry, "--bundle", "--format=cjs", "--platform=node",
        "--outfile=" + out,
        // pdfjs reaches for node-canvas on this path and never uses it here.
        "--external:canvas",
        "--loader:.scss=empty", "--loader:.css=empty", "--loader:.gif=text", "--loader:.png=text",
        "--loader:.svg=text", "--loader:.jpg=text", "--loader:.mp4=text", "--loader:.webm=text",
        "--loader:.mp3=text", "--loader:.wav=text", "--log-level=error"], { cwd: ROOT });

    // defineProperty, not assignment: modern Node exposes `navigator` as a
    // getter-only global and a plain assign throws before anything loads.
    Object.defineProperty(global, "navigator", {
        value: { appVersion: "node", userAgent: "node", platform: "node" },
        configurable: true, writable: true,
    });
    global.window = {
        localStorage: { getItem: () => null, setItem: () => {} },
        addEventListener: () => {}, removeEventListener: () => {},
        location: { href: "file:///" },
    };
    global.document = {
        addEventListener: () => {}, removeEventListener: () => {},
        createElement: () => ({ style: {}, setAttribute: () => {} }),
        body: { appendChild: () => {} },
    };

    cached = require(out);
    return cached;
}

module.exports = { loadAgent, ROOT };
