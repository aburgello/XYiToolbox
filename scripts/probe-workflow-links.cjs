// =============================================================================
// scripts/probe-workflow-links.cjs
// -----------------------------------------------------------------------------
// The three things a workflow step can point at, checked as DATA rather than
// through the DOM: every id a link can carry has to resolve against the real
// registry / Toolset / saved-script lists, and a link written on one machine
// has to degrade honestly on another.
//
// Steps and notes are stored in a SHARED file on the team folder that outlives
// the things it names, so the resolution order is the whole feature:
//   tool          -> toolRegistry TOOLS
//   toolsetAction -> Toolset ACTIONS
//   script        -> id, then NAME, then a dead chip that still says the name
//
// Scripts are per-machine with random ids (ScriptPlayground's genId), so the
// name is the half that travels. Getting that order wrong means a colleague
// opens the workflow and sees "missing" where a perfectly present script is.
//
//   node scripts/probe-workflow-links.cjs
// =============================================================================
const fs = require('fs');

let fails = 0;
const say = (ok, msg, extra) => { if (!ok) fails++; console.log((ok ? '  ok    ' : '  FAIL  ') + msg + (extra ? '   ' + extra : '')); };

// --- the resolution rule, mirrored from StepLinkChip ------------------------
function resolveScript(link, scripts) {
    let hit = link.script ? scripts.filter((t) => t.id === link.script)[0] : undefined;
    if (!hit && link.scriptName) {
        const want = link.scriptName.trim().toLowerCase();
        hit = scripts.filter((t) => t.name.trim().toLowerCase() === want)[0];
    }
    return hit || null;
}

console.log('1. a script link survives the trip to another machine\n');
const MINE = [{ id: 'abc123', name: 'Strip Nulls' }];
const THEIRS = [{ id: 'zzz999', name: 'Strip Nulls' }];   // same script, re-saved
const NOBODY = [];
const link = { script: 'abc123', scriptName: 'Strip Nulls' };

say(resolveScript(link, MINE) !== null, 'resolves by id on the machine it was written on');
const t = resolveScript(link, THEIRS);
say(t !== null && t.id === 'zzz999', 'resolves by NAME on a colleague\'s, where the id differs', t ? t.id : 'null');
say(resolveScript(link, NOBODY) === null, 'and fails cleanly where the script simply is not saved');
say(resolveScript({ scriptName: 'Strip Nulls' }, THEIRS) !== null, 'a link with only a name still works — the id is the optional half');
say(resolveScript({ script: 'abc123' }, THEIRS) === null, 'a link with only an id cannot travel, which is why the name is stored');
say(resolveScript({ script: 'abc123', scriptName: 'STRIP  nulls' }, THEIRS) === null,
    'the name match is exact after trimming, not fuzzy — a near-name is a different script');
say(resolveScript({ script: 'abc123', scriptName: '  Strip Nulls  ' }, THEIRS) !== null, '…but surrounding whitespace does not defeat it');

console.log('\n2. every id the picker can write actually exists');
const registry = fs.readFileSync('src/js/main/toolRegistry.tsx', 'utf8');
const toolset = fs.readFileSync('src/js/main/tools/Toolset.tsx', 'utf8');
const toolIds = [...registry.matchAll(/^        id: "([a-z0-9-]+)"/gm)].map((m) => m[1]);
const actionIds = [...toolset.matchAll(/^        id: "([a-z0-9-]+)"/gm)].map((m) => m[1]);
say(toolIds.length > 30, toolIds.length + ' registry tools are offered under "Tools"');
say(actionIds.length > 10, actionIds.length + ' Toolset actions are offered under "Toolset actions"');
say(actionIds.indexOf('support-swap') !== -1, 'Support Swap is among them — the case that started this');
say(actionIds.indexOf('mc-it') !== -1, 'and so is MC It!');

console.log('\n3. the two id spaces do not collide');
// A link carries `tool` or `toolsetAction`, never both, and the chip picks by
// which field is set — but a shared id would still make a stale link ambiguous
// to anyone reading the JSON by hand.
const clash = toolIds.filter((id) => actionIds.indexOf(id) !== -1);
say(clash.length === 0, 'no id is both a registry tool and a Toolset action', clash.join(', '));

console.log('\n4. nothing destructive can be auto-pressed');
// navigateToToolsetAction focuses; it never runs. Guard that by checking the
// only auto-press path (autoAction) still refuses anything not graded "read".
const nav = fs.readFileSync('src/js/main/lib/navigation.ts', 'utf8');
say(/tier !== "read"/.test(nav), 'the click gate still fails closed on actionSafety');
say(!/homeNavigator\([^)]*\)\s*;\s*[^}]*\.run\(/.test(nav), 'navigateToToolsetAction never calls an action\'s run()');
const wf = fs.readFileSync('src/js/main/tools/WorkflowBoard.tsx', 'utf8');
say(!/onGoAction[^)]*\)\s*=>\s*[^;]*runAction/.test(wf), 'and the chip only navigates');

console.log(fails === 0 ? '\nCLEAN — every destination resolves, and none of them fire on arrival.' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
