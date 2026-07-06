#!/usr/bin/env node
// =============================================================================
// scripts/make-test-masters.js
// -----------------------------------------------------------------------------
// Creates a throwaway local folder matching the OV Library naming convention,
// so you can point "New Campaign" at real local files instead of the studio's
// actual Masters folder. Files are empty placeholders:
//   - Reveal and scanning/matching will work correctly against them.
//   - Import will predictably FAIL on the .aep files (they're not valid AE
//     project binaries) -- that's expected, and exercises the error-handling
//     path rather than indicating a bug.
//
// Usage:
//   node scripts/make-test-masters.js [outputDir]
// Default outputDir: ./test-masters
// =============================================================================

const fs = require("fs");
const path = require("path");

const root = process.argv[2] || path.join(process.cwd(), "test-masters");
const PREFIX = "TEST_INTL_DGTL_DOOH";

// [creative]: [ [size, duration], ... ]
const creatives = {
    HORSE: [
        ["1920x858", "10sec"],   // landscape, gets a matching render
        ["1080x1920", "10sec"],  // portrait, no render (tests "no matching render found")
        ["1920x1920", "20sec"],  // square, gets a matching render
    ],
    HELMET: [
        ["3840x586", "10sec"],   // landscape, no render
    ],
    GUTTERS: [], // empty creative -- tests the "no masters found" state
};

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function touch(p) {
    fs.writeFileSync(p, "");
}

let aepCount = 0;
let renderCount = 0;

for (const [creative, sizes] of Object.entries(creatives)) {
    const aeDir = path.join(root, "AE", creative);
    const renderDir = path.join(root, "Renders", creative);
    ensureDir(aeDir);
    ensureDir(renderDir);

    sizes.forEach(([size, duration], i) => {
        const stem = `${PREFIX}_${creative}_LOS_${size}_${duration}_OV`;
        touch(path.join(aeDir, `${stem}.aep`));
        aepCount++;

        // Only give every other size a matching render, so the "no
        // matching render found" path gets exercised too, not just the
        // happy path.
        if (i % 2 === 0) {
            touch(path.join(renderDir, `${stem}.mov`));
            renderCount++;
        }
    });
}

console.log(`Test Masters folder created at: ${root}`);
console.log(`  ${aepCount} master file(s) across ${Object.keys(creatives).length} creative(s)`);
console.log(`  ${renderCount} matching render(s)`);
console.log(`\nPoint "New Campaign" at this folder to test with fake data.`);
console.log(`Reminder: Import will fail on these -- they're empty placeholders, not real .aep files.`);
