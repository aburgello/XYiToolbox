// scripts/make-messy-project.jsx
// -----------------------------------------------------------------------------
// Run this directly in After Effects: File > Scripts > Run Script File...
// (needs a version of AE with "Allow Scripts to Write Files and Access
// Network" enabled in Preferences > Scripting & Expressions, since it writes
// a couple of tiny temp image files to disk to import as real footage).
//
// Builds deliberately messy random project structure to stress-test
// "Organise Folders" (organiseFolders() in aeft.ts / tools.ts):
//   - Comps scattered at root with random labels (some =1 -> should end up
//     in Main, everything else -> PreComp).
//   - Solids scattered at root (-> Solids).
//   - Still images with randomized names, some deliberately named to LOOK
//     like a .png, some labelled 11 (both are independent "should end up in
//     PNG folder" triggers), the rest plain artwork stills (-> Artwork).
//   - A real non-still FileSource, via importing a 3-frame image sequence
//     (AE reports isStill=false for a sequence import) (-> MOVs).
//   - Pre-existing folders in the WRONG places, including a stray comp
//     already sitting inside a folder named "Composition" before the tool
//     ever runs, to confirm the tool re-sorts regardless of starting point.
//   - Deliberately empty, unrelated, nested decoy folders (3 levels deep)
//     to stress the deepest-first cascade deletion logic, plus one
//     decoy folder that's non-empty (has a random comp in it) to confirm
//     that one is correctly left alone.
// Every run is randomized (counts + labels) so re-running gives a
// different mess each time -- run it a few times before trusting a single
// pass of Organise Folders.
// -----------------------------------------------------------------------------

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
    return arr[randInt(0, arr.length - 1)];
}

// A valid, complete 1x1 transparent PNG (67 bytes) -- enough for AE to
// actually import as real footage, no external assets needed.
var PNG_BYTES = [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,10,73,68,65,84,120,156,99,0,1,0,0,5,0,1,13,10,45,180,0,0,0,0,73,69,78,68,174,66,96,130];

function writeTinyPng(filePath) {
    var f = new File(filePath);
    f.encoding = "BINARY";
    f.open("w");
    var str = "";
    for (var i = 0; i < PNG_BYTES.length; i++) str += String.fromCharCode(PNG_BYTES[i]);
    f.write(str);
    f.close();
    return f;
}

function importStill(tmpFolder, baseName) {
    var src = writeTinyPng(tmpFolder.fsName + "/" + baseName + "_src.png");
    var item = app.project.importFile(new ImportOptions(src));
    item.name = baseName; // display name only -- doesn't touch the real file on disk
    return item;
}

function importSequenceAsMov(tmpFolder, baseName) {
    // A numbered-frame sequence imports as ONE non-still FileSource item --
    // this is what makes it route to "MOVs" instead of "Artwork"/"PNG",
    // without needing a real video codec.
    for (var i = 1; i <= 3; i++) {
        var n = i < 10 ? "0" + i : String(i);
        writeTinyPng(tmpFolder.fsName + "/" + baseName + "_" + n + ".png");
    }
    var firstFrame = new File(tmpFolder.fsName + "/" + baseName + "_01.png");
    var opts = new ImportOptions(firstFrame);
    opts.sequence = true;
    var item = app.project.importFile(opts);
    item.name = baseName;
    return item;
}

function main() {
    if (!app.project) app.newProject();
    var tmpFolder = new Folder(Folder.temp.fsName + "/xyi_messy_test_" + Date.now());
    tmpFolder.create();

    app.beginUndoGroup("Make Messy Test Project");

    var report = [];

    // --- Random comps, scattered at root, random labels ---------------------
    var compCount = randInt(6, 12);
    var mainCount = 0;
    for (var c = 0; c < compCount; c++) {
        var comp = app.project.items.addComp("Comp_" + c + "_" + randInt(100, 999), 640, 360, 1, 5, 24);
        comp.label = randInt(0, 16);
        if (comp.label === 1) mainCount++;
    }
    report.push(compCount + " comps (" + mainCount + " labelled red/1 -> should land in Main, rest -> PreComp)");

    // --- Random solids, scattered at root ------------------------------------
    // There is no standalone ItemCollection.addSolid() -- solids can only be
    // created as a LAYER inside a comp (comp.layers.addSolid), whose
    // underlying .source FootageItem (mainSource instanceof SolidSource) is
    // what actually lands in the Project panel. Build a disposable comp
    // just to create that layer, grab its source, then remove the
    // throwaway comp -- the solid FootageItem persists in the project
    // independently, same as removing a comp never deletes footage it used.
    var solidCount = randInt(3, 6);
    for (var s = 0; s < solidCount; s++) {
        var tempHolder = app.project.items.addComp("__temp_solid_holder__", 320, 240, 1, 1, 24);
        var solidLayer = tempHolder.layers.addSolid([Math.random(), Math.random(), Math.random()], "Solid_" + s, 320, 240, 1, 1);
        var solidItem = solidLayer.source;
        tempHolder.remove();
    }
    report.push(solidCount + " solids -> should land in Solids");

    // --- Random artwork stills, some faked as PNG (by name OR by label 11) --
    var artworkCount = randInt(4, 8);
    var pngByNameCount = 0;
    var pngByLabelCount = 0;
    for (var a = 0; a < artworkCount; a++) {
        var looksLikePng = Math.random() < 0.35;
        var isLabel11 = !looksLikePng && Math.random() < 0.35;
        var name = looksLikePng
            ? "Frame_" + a + ".png"
            : "Artwork_" + a + "." + pick(["jpg", "jpeg", "tif", "psd"]);
        var item = importStill(tmpFolder, name);
        if (isLabel11) item.label = 11;
        if (looksLikePng) pngByNameCount++;
        if (isLabel11) pngByLabelCount++;
    }
    report.push(artworkCount + " stills (" + pngByNameCount + " named like .png, " + pngByLabelCount + " labelled 11) -- both groups should land in PNG, the rest in Artwork");

    // --- One real non-still (image-sequence) footage item -------------------
    importSequenceAsMov(tmpFolder, "FakeMov_" + randInt(1, 999));
    report.push("1 image-sequence footage item (non-still) -> should land in MOVs");

    // --- Pre-existing folders in the WRONG places ----------------------------
    // A "Composition" folder that already exists, with a stray comp already
    // sitting inside it (in the wrong sub-place) before the tool ever runs.
    var earlyComposition = app.project.items.addFolder("Composition");
    var strandedComp = app.project.items.addComp("Stranded_In_Composition", 640, 360, 1, 5, 24);
    strandedComp.label = 1;
    strandedComp.parentFolder = earlyComposition; // wrong spot -- should be re-sorted into Main
    report.push("1 comp pre-placed directly inside an existing 'Composition' folder -- should get re-sorted into Main");

    // --- Deliberately empty, nested, UNRELATED decoy folders -----------------
    // 3 levels deep, fully empty -- exercises the deepest-first cascade.
    var decoyRoot = app.project.items.addFolder("DecoyRoot_" + randInt(1, 999));
    var decoyMid = app.project.items.addFolder("DecoyMid");
    decoyMid.parentFolder = decoyRoot;
    var decoyLeaf = app.project.items.addFolder("DecoyLeaf");
    decoyLeaf.parentFolder = decoyMid;
    report.push("1 fully-empty 3-level-deep decoy folder chain (DecoyRoot > DecoyMid > DecoyLeaf) -- all 3 should be removed");

    // A sibling decoy folder that's NOT empty (has a real comp in it) --
    // confirms non-empty folders are correctly left alone.
    var keepFolder = app.project.items.addFolder("KeepMe_" + randInt(1, 999));
    var keptComp = app.project.items.addComp("Comp_In_KeepMe", 640, 360, 1, 5, 24);
    keptComp.parentFolder = keepFolder;
    report.push("1 non-empty decoy folder (KeepMe, holding a comp) -- should be LEFT ALONE, not removed");

    // A plain empty decoy at root, single level.
    app.project.items.addFolder("EmptyDecoy_" + randInt(1, 999));
    report.push("1 flat empty decoy folder at root -- should be removed");

    app.endUndoGroup();

    alert(
        "Messy test project built:\n\n" + report.join("\n") + "\n\n" +
        "Now run 'Organise Folders' and confirm:\n" +
        " - every comp/solid/still/sequence item lands where noted above\n" +
        " - KeepMe survives with its comp still inside\n" +
        " - DecoyRoot/DecoyMid/DecoyLeaf and EmptyDecoy are all gone\n" +
        " - nothing that still holds real content gets deleted"
    );
}

main();
