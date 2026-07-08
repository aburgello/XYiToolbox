// =============================================================================
// src/jsx/aeft/localise.ts -- backend for every Localise-category tool
// (Campaign Localiser, AEP Thief, Trotting Along/2.0, PDF to CSV, JPEG Loc,
// Localised Library, Name Generator, Edit Generator, Generate Cue Sheet,
// Check, CSV Localiser). Split out of aeft.ts, which is now a thin barrel --
// see its header comment for context.
// =============================================================================
import { CampaignLocaliserResult, TC_COUNTRIES, cheekyDTCheck, drqr, hasIsolatedOvToken, losOpenForEdit, scanMastersForBestMatch } from "./tools";
import { makeParentLayerOfAllUnparented, scaleAllCameraZooms } from "./deliver";
import { Result, SETTINGS_SECTION, decode, findBestComponentFile } from "./shared";
import { loadCampaignsRaw } from "./review";



// =============================================================================
// AEP Thief -- ported from toolset/XYi_Copy_AEP.jsx, part of the Campaign
// Localiser tab. Pure filesystem copy (recursive, skips existing, logs to
// two CSVs) -- no AE project touched, no master ever opened.
// =============================================================================
export const copyAep = (): CampaignLocaliserResult => {
  try {
    const sourceFolder = Folder.selectDialog("Select the source folder");
    if (!sourceFolder) return { success: false, error: "No source folder selected." };
    const destinationFolder = Folder.selectDialog("Select the destination folder");
    if (!destinationFolder) return { success: false, error: "No destination folder selected." };

    const copiedFiles: string[] = [];
    const skippedFiles: string[] = [];

    const copyAepFiles = (src: Folder, dest: Folder) => {
      const files = src.getFiles();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file instanceof File && file.name.toLowerCase().indexOf(".aep") !== -1) {
          const newFile = new File(dest.fsName + "/" + file.name);
          if (!newFile.exists) {
            file.copy(newFile.fsName);
            if (newFile.exists) copiedFiles.push(file.name);
            else skippedFiles.push(file.name);
          } else {
            skippedFiles.push(file.name);
          }
        } else if (file instanceof Folder) {
          if (!/auto-save|_archive|_old/i.test(file.name)) {
            copyAepFiles(file, dest);
          }
        }
      }
    };

    copyAepFiles(sourceFolder, destinationFolder);

    const exportToFile = (fileName: string, data: string[]) => {
      const csvFile = new File(fileName);
      if (csvFile.open("w")) {
        csvFile.write(data.join("\r\n"));
        csvFile.close();
      }
    };
    exportToFile(destinationFolder.fsName + "/Copied_Files.csv", copiedFiles);
    exportToFile(destinationFolder.fsName + "/Skipped_Files.csv", skippedFiles);

    return { success: true, message: `Copied ${copiedFiles.length} file(s), skipped ${skippedFiles.length}.` };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Trotting Along / Trotting Along 2.0 / PDF to CSV -- ported from Campaign
// Localiser's "Trotting Along" section (XYi_Campaign_Trotter.jsx,
// XYi_Campaign_Trotting2.jsx) and the CSV-export sibling
// (XYi_PDF_to_CSV.jsx). All three walk a folder of client-supplied PDFs
// sitting in a "PDFs" folder somewhere under a territory root, matching
// each PDF to the best master by filename, and mirror the PDFs folder's
// relative path into a sibling "AE" folder for output -- e.g.
// ".../France/PDFs/Teasers/foo.pdf" -> ".../France/AE/Teasers/foo_V01.aep".
//
// Trotting Along and Trotting Along 2.0 both directly `app.open()` the
// matched master (no copy-first) -- this is the SAME confirmed, deliberate
// exception Campaign Localiser's "Generate Files" already has: the result
// is always saved to a brand-new `_V01.aep` file under the derived AE
// folder, never back to the master's own path, and the project is closed
// with DO_NOT_SAVE_CHANGES immediately after. Same safety reasoning
// applies here -- see Campaign Localiser's own comment for the fuller
// explanation. PDF to CSV never opens any project at all (just scans
// filenames and writes a CSV), so it carries no master-file risk.
// =============================================================================

// Shared by all three -- identical in every one of the three original
// files (not a meaningful behavioral fork), so ported once.
function trotFindTerrFolder(folder: Folder): string {
  if (folder.name === "PDFs") return folder.parent ? folder.parent.name : "Master OV";
  if (folder.parent !== null) return trotFindTerrFolder(folder.parent);
  return "Master OV";
}

function trotFindPDFsFolder(startFolder: Folder): string {
  let currentFolder: Folder | null = startFolder;
  let aeFolderPath = "";
  let relativePath = "";
  while (currentFolder !== null) {
    if (currentFolder.name === "PDFs") {
      const parentFolder = currentFolder.parent;
      aeFolderPath = (parentFolder ? parentFolder.fsName : "") + "/AE" + relativePath;
      break;
    }
    relativePath = "/" + currentFolder.name + relativePath;
    currentFolder = currentFolder.parent;
  }
  return aeFolderPath;
}

// PDF to CSV's OWN findPDFsFolder -- NOT identical to trotFindPDFsFolder
// above despite looking it at a glance. XYi_PDF_to_CSV.jsx's copy has an
// extra fallback (save alongside the PDFs folder itself if no "PDFs"
// ancestor is found) that neither XYi_Campaign_Trotter.jsx nor
// XYi_Campaign_Trotting2.jsx has. Caught by diffing the three original
// files directly rather than assuming three near-identical-looking
// functions were the same -- kept as its own function rather than folded
// into trotFindPDFsFolder to preserve that real behavioral difference.
function pdfCsvFindPDFsFolder(startFolder: Folder): string {
  const aeFolderPath = trotFindPDFsFolder(startFolder);
  return aeFolderPath === "" ? startFolder.fsName : aeFolderPath;
}

function trotCreateFolderStructure(folderPath: string): void {
  const folder = new Folder(folderPath);
  if (!folder.exists) {
    const parentFolder = folder.parent;
    if (parentFolder && !parentFolder.exists) trotCreateFolderStructure(parentFolder.fsName);
    folder.create();
  }
}

// Ported 1:1 from XYi_Campaign_Trotter.jsx's gimme() -- a simpler,
// non-Jaccard filename tokenizer specific to Trotting Along (v1). Distinct
// from Trotting Along 2.0's Jaccard-based gimme(), which is its own
// separate function below -- the two tools genuinely use different
// matching strategies in the original, not the same logic twice.
function trotGimmeV1(filename: string): [string, string] {
  const resolutionRegex = /\d+x\d+px?/i;
  let secondOne = "";
  if (filename.indexOf("DOOH") !== -1) secondOne = "DOOH";
  else if (filename.indexOf("DINTH") !== -1) secondOne = "DINTH";
  else if (filename.indexOf("DFOH") !== -1) secondOne = "DFOH";

  const parts = filename.split("_");
  const tokens = parts.filter((p) => p.length > 0);

  const validTokens: string[] = [];
  for (let j = 0; j < tokens.length; j++) {
    if (resolutionRegex.test(tokens[j])) break;
    validTokens.push(tokens[j]);
  }
  if (validTokens.length > 0) validTokens.shift();

  const finalTokens = validTokens.filter((t) => t !== secondOne);
  if (finalTokens.length > 1 && /^[A-Z]{2,4}$/.test(finalTokens[0])) finalTokens.shift();
  if (finalTokens.length > 1 && /^[A-Z]{2}$/.test(finalTokens[finalTokens.length - 1])) finalTokens.pop();

  const firstOne = finalTokens.join("_").toUpperCase();
  return [firstOne, secondOne];
}

// Shared nameGen() logic across Trotting Along / Trotting Along 2.0 --
// duplicate the matched master comp, rescale via the same null-parent
// technique as DRQR/Scale Composition/CSV Localiser, propagate into every
// V## comp under "Main", auto-run Cheeky DT Check + DRQR, then save to the
// derived AE folder path and close. The only difference between v1 and
// v2's own nameGen() in the originals is v1 removes the ORIGINAL comp by
// matching its name after the fact, v2 removes `myComp` directly if it
// still exists -- both ported exactly as their own file has it.
function trotNameGen(myComp: CompItem, width: number, height: number, newCompName: string, plm: "PORTRAIT" | "LANDSCAPE", pdfFile: File, removeByName: boolean): void {
  const scanRegV = /V\d\d/;
  const myName = myComp.name;
  const oldWidth = myComp.width;
  const oldHeight = myComp.height;
  const newComp = myComp.duplicate();
  newComp.name = newCompName;

  const newRatio = width / height;
  const oldRatio = oldWidth / oldHeight;
  const scaleFactor = newRatio > oldRatio ? width / oldWidth : height / oldHeight;

  const null3DLayer = newComp.layers.addNull();
  null3DLayer.threeDLayer = true;
  null3DLayer.position.setValue([0, 0, 0]);
  makeParentLayerOfAllUnparented(newComp, null3DLayer);

  newComp.width = Math.floor(width);
  newComp.height = Math.floor(height);
  scaleAllCameraZooms(newComp, scaleFactor);

  const superParentScale = null3DLayer.scale.value as number[];
  const superParentPosition = null3DLayer.position.value as number[];
  superParentScale[0] *= scaleFactor;
  superParentScale[1] *= scaleFactor;
  superParentScale[2] *= scaleFactor;
  null3DLayer.scale.setValue(superParentScale);

  if (newRatio > oldRatio) {
    const posHeight = (width / oldWidth) * oldHeight;
    superParentPosition[1] = -0.5 * (posHeight - height);
  } else {
    const posWidth = (height / oldHeight) * oldWidth;
    superParentPosition[0] = -0.5 * (posWidth - width);
  }
  null3DLayer.position.setValue(superParentPosition);
  null3DLayer.remove();

  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof CompItem && item.parentFolder && item.parentFolder.name === "Main" && scanRegV.test(item.name)) {
      item.width = width;
      item.height = height;
      for (let j = 1; j <= item.numLayers; j++) {
        const layer = item.layer(j) as AVLayer;
        if (layer.name === myComp.name) {
          layer.replaceSource(newComp, false);
        } else if (plm === "PORTRAIT") {
          layer.scale.setValue([(100 / 1920) * height, (100 / 1920) * height]);
        } else if (plm === "LANDSCAPE") {
          layer.scale.setValue([(100 / 1080) * height, (100 / 1080) * height]);
        }
        layer.position.setValue([width / 2, height / 2]);
      }
    }
  }

  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof CompItem && item.parentFolder && item.parentFolder.name === "Main" && scanRegV.test(item.name)) {
      item.name = String(newComp.name) + "_V01";
    }
  }

  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof CompItem && item.parentFolder && item.parentFolder.name === "Main" && scanRegV.test(item.name + "_V01")) {
      item.openInViewer();
      cheekyDTCheck(false, true, true, false, false, true, true);
      if (item.name === newCompName + "_V01") {
        app.project.showWindow(true);
        drqr();
      }
    }
  }

  if (removeByName) {
    for (let i = 1; i <= app.project.numItems; i++) {
      const item = app.project.item(i);
      if (item instanceof CompItem && item.parentFolder && item.parentFolder.name === "Main" && item.name === myName) {
        item.remove();
      }
    }
  } else if (myComp) {
    myComp.remove();
  }

  const aeFolderPath = trotFindPDFsFolder(pdfFile.parent);
  trotCreateFolderStructure(aeFolderPath);
  const myNewFile = new File(aeFolderPath + "/" + newCompName + "_V01.aep");
  app.project.save(myNewFile);
  app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  app.newProject();
}

// Ported 1:1 from XYi_Campaign_Trotter.jsx's campLoc(). **`sartre` from
// the original's 7-arg signature is dropped here -- confirmed dead in the
// original body (never referenced anywhere inside campLoc()), and there's
// no corresponding UI control for it either (TroAlo() just hardcodes
// `sartre = true` before calling in), so there's nothing for a param to
// carry.** TroDur/TroArt/TroArtOn/TroCamp/TroCampOn are all real and used.
// Matches the original exactly: TroAlo() prompts for the Master/loc folder
// FIRST, then calls campLoc(), which prompts a SECOND time for the PDF
// folder -- both dialogs happen inside this one function/button click,
// not a masters-path param collected ahead of time in React.
export const campaignLocaliserTrott = (troDur: string, troArt: string, troArtOn: boolean, troCamp: string, troCampOn: boolean): Result => {
  const mastersPathFolder = Folder.selectDialog("Please select the Master / loc folder to scan");
  if (!mastersPathFolder) return { success: true };
  const mastersPath = mastersPathFolder.fsName;

  const folder = Folder.selectDialog("Select a folder containing PDF files");
  if (folder === null) {
    alert("No folder selected");
    return { success: true };
  }

  const pdfFiles = (folder.getFiles("*.pdf") as File[]) || [];
  let count = 0;
  const scanTerritory = getTerritoryCountryCode(trotFindTerrFolder(folder)) || "XX";
  const regex = /\d*[x]\d*/;

  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    if (!(pdfFile instanceof File) || !pdfFile.name.match(/\.pdf$/i)) continue;
    count++;

    try {
      const fileName = pdfFile.name;
      let artworkType = troArt;
      if (troArtOn) artworkType = trotGimmeV1(fileName)[1];

      let funcCampaign = troCamp;
      if (troCampOn) funcCampaign = trotGimmeV1(fileName)[0];

      const sizeParts = String(fileName.match(regex)).split("x");
      const width = Math.floor(Number(sizeParts[0]));
      const height = Math.floor(Number(sizeParts[1]));
      const size = String(width) + "x" + String(height);
      const funcDuration = troDur;

      const pl: "PORTRAIT" | "LANDSCAPE" = width < height ? "PORTRAIT" : "LANDSCAPE";
      const duration = funcDuration + "sec";

      const bestMatch = scanMastersForBestMatch(mastersPath, funcCampaign, size, duration);
      if (!bestMatch) continue;
      const textMaster = bestMatch.fsName;

      const linesMaster = textMaster.split("/");
      let masterName = linesMaster[linesMaster.length - 1];
      const ratioPattern = /^_(\d+\.\d+)_/;
      if (ratioPattern.test(masterName)) masterName = masterName.split(ratioPattern)[2];

      const masterSizeMatch = String(masterName.match(regex));
      const masterSizeParts = masterSizeMatch.split("x");
      const masterWidth = Math.floor(Number(masterSizeParts[0]));
      const masterHeight = Math.floor(Number(masterSizeParts[1]));
      const plm: "PORTRAIT" | "LANDSCAPE" = masterWidth < masterHeight ? "PORTRAIT" : "LANDSCAPE";

      const scanFilmTitle = masterName.split("_")[0];
      const scanIndo = masterName.split("_")[1];

      const newCompName = scanFilmTitle + "_" + scanIndo + "_DGTL_" + artworkType + "_" + funcCampaign + "_" + width + "x" + height + "_" + duration + "_" + scanTerritory;

      const aeFolder = trotFindPDFsFolder(pdfFile.parent);
      const outputFile = new File(aeFolder + "/" + newCompName + "_V01.aep");
      if (outputFile.exists) {
        alert(newCompName + ".aep already exists. Skipping.");
        continue;
      }

      const fileToOpen = new File(textMaster);
      if (!fileToOpen.exists) {
        alert("Master file not found: " + textMaster);
        continue;
      }

      const proj = app.open(fileToOpen);
      let myComp: CompItem | null = null;
      const masterStem = masterName.split(".")[0].replace(/_V\d+$/, "");
      for (let j = 1; j <= proj.numItems; j++) {
        const item = proj.item(j);
        if (item instanceof CompItem && item.name === masterStem) myComp = item;
      }
      if (!myComp) continue;

      trotNameGen(myComp, width, height, newCompName, plm, pdfFile, true);
    } catch (err) {
      alert("Row failed: " + err.toString());
    }
  }

  alert("Total PDF files processed: " + count);
  return { success: true };
};

// Ported from XYi_Campaign_Trotting2.jsx's campLoc()/gimme()/Detective().
// **TroDur/TroArt/TroArtOn/TroCamp/TroCampOn are accepted but never used**
// -- confirmed dead in the original body; Trotting Along 2.0 auto-detects
// campaign/artwork/duration entirely from hybrid-matching the PDF's own
// filename against every master .aep under the masters path (via
// nameGeneratorParse(), reusing the same parser Name Generator/PDF to CSV
// use, rather than duplicating TC_nameBox() a third/fourth time), instead
// of trusting the override fields at all. Kept as real no-op parameters
// for the same reason as Build From CSV's page/art/tt -- the toolbox tab
// shares one set of Duration/Art/TT fields across both Trott!/Trott 2.0
// buttons, so the signature needs to match even though this version
// ignores them. Matching itself is the shared findBestComponentFile()
// hybrid matcher (see trotGimmeV2() below), not a local Jaccard-only
// scorer -- there used to be one here (trotJaccardHybrid()), removed once
// nothing called it anymore.

function trotRemoveStopwords(inputString: string): string {
  const stopwords = ["6SHEET", "30SHEET", "48SHEET", "96SHEET", "HORIZONTAL", "SQUARE", "EXTREME", "TALL", "PORTRAIT", "QUAD"];
  return inputString
    .split("_")
    .filter((p) => stopwords.indexOf(p) === -1)
    .join("_");
}

function trotFindAllAeps(rootPath: string): File[] {
  const aepFiles: File[] = [];
  const startFolder = new Folder(rootPath);
  function scanFolder(folder: Folder) {
    const items = folder.getFiles();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item instanceof Folder) {
        if (item.name !== "_old" && item.name !== "_archive" && item.name.indexOf("Auto-Save") === -1) scanFolder(item);
      } else if (item instanceof File) {
        if (item.name.slice(-4).toLowerCase() === ".aep") aepFiles.push(item);
      }
    }
  }
  if (startFolder.exists) scanFolder(startFolder);
  return aepFiles;
}

interface TrotMasterInfo {
  name: string; // campaign tokens string (the original's "tokens", reused as the campaign name)
  originalName: string;
  tokens: string;
  orientation: "PORTRAIT" | "LANDSCAPE";
}

function trotPreprocessMasters(rootPath: string): TrotMasterInfo[] {
  const allAepFiles = trotFindAllAeps(rootPath);
  const processed: TrotMasterInfo[] = [];
  const regexForSize = /\d*[x]\d*/;
  for (let idx = 0; idx < allAepFiles.length; idx++) {
    const originalFileName = allAepFiles[idx].name;
    const info = nameGeneratorParse(originalFileName);
    if (!info.success || !info.campaign) continue;

    let orientation: "PORTRAIT" | "LANDSCAPE" = "LANDSCAPE";
    const sizeMatch = originalFileName.match(regexForSize);
    if (sizeMatch) {
      const sizeParts = String(sizeMatch).split("x");
      if (sizeParts.length === 2) {
        const w = parseInt(sizeParts[0], 10);
        const h = parseInt(sizeParts[1], 10);
        if (!isNaN(w) && !isNaN(h) && w < h) orientation = "PORTRAIT";
      }
    }
    processed.push({ name: info.campaign, originalName: originalFileName, tokens: info.campaign, orientation });
  }
  return processed;
}

// Re-ported to use the shared findBestComponentFile() hybrid matcher
// (Jaccard+Levenshtein+Jaro-Winkler+numeric+substring) instead of the
// plain Jaccard-only trotJaccardHybrid() scan below -- matches the
// studio's current XYi_Campaign_Trotting2.jsx, whose gimme() calls the
// same shared Detective() every other name-matching tool here now uses.
// Also matches its exact "No match found" fallback string rather than an
// empty campaign name when nothing scores at all.
function trotGimmeV2(filename: string, masterAeFiles: TrotMasterInfo[]): [string, string, string] {
  const fileInfo = nameGeneratorParse(filename);
  if (!fileInfo.success) return ["Parsing Error", "Parsing Error", "Parsing Error"];

  const fileTokens = fileInfo.campaign || "";
  const secondOne = fileInfo.artworkType || "";
  const thirdOne = fileInfo.duration || " ";

  const bestMatch = findBestComponentFile(fileTokens, masterAeFiles);
  const campName = bestMatch ? bestMatch.tokens : "No match found";
  return [campName, secondOne, thirdOne];
};

// Same two-sequential-dialogs shape as campaignLocaliserTrott() above --
// TroAloTwo() prompts for the Master/loc folder first, then campLoc()
// prompts for the PDF folder.
export const campaignLocaliserTrott2 = (_troDur: string, _troArt: string, _troArtOn: boolean, _troCamp: string, _troCampOn: boolean): Result => {
  const mastersPathFolder = Folder.selectDialog("Please select the Master / loc folder to scan");
  if (!mastersPathFolder) return { success: true };
  const mastersPath = mastersPathFolder.fsName;

  const folder = Folder.selectDialog("Select a folder containing PDF files");
  if (folder === null) {
    alert("No folder selected");
    return { success: true };
  }

  const pdfFiles = (folder.getFiles("*.pdf") as File[]) || [];
  let count = 0;
  const scanTerritory = getTerritoryCountryCode(trotFindTerrFolder(folder)) || "XX";
  const regex = /\d*[x]\d*/;

  const processedMasterFiles = trotPreprocessMasters(mastersPath);

  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    if (!(pdfFile instanceof File) || !pdfFile.name.match(/\.pdf$/i)) continue;
    count++;

    try {
      const fileName = pdfFile.name;
      const sizeParts = String(fileName.match(regex)).split("x");
      const width = Math.floor(Number(sizeParts[0]));
      const height = Math.floor(Number(sizeParts[1]));
      const size = String(width) + "x" + String(height);
      const pl: "PORTRAIT" | "LANDSCAPE" = width < height ? "PORTRAIT" : "LANDSCAPE";

      const filteredMasterFiles = processedMasterFiles.filter((m) => m.orientation === pl);
      const matchInfo = trotGimmeV2(fileName, filteredMasterFiles);
      const funcCampaign = trotRemoveStopwords(matchInfo[0]);
      const artworkType = matchInfo[1];
      const duration = matchInfo[2];

      const bestMatch = scanMastersForBestMatch(mastersPath, funcCampaign, size, duration);
      if (!bestMatch) continue;
      const textMaster = bestMatch.fsName;

      const linesMaster = textMaster.split("/");
      let masterName = linesMaster[linesMaster.length - 1];
      const ratioPattern = /^_(\d+\.\d+)_/;
      if (ratioPattern.test(masterName)) masterName = masterName.split(ratioPattern)[2];

      const masterSizeMatch = String(masterName.match(regex));
      const masterSizeParts = masterSizeMatch.split("x");
      const masterWidth = Math.floor(Number(masterSizeParts[0]));
      const masterHeight = Math.floor(Number(masterSizeParts[1]));
      const plm: "PORTRAIT" | "LANDSCAPE" = masterWidth < masterHeight ? "PORTRAIT" : "LANDSCAPE";

      const scanFilmTitle = masterName.split("_")[0];
      const scanIndo = masterName.split("_")[1];

      const newCompName = scanFilmTitle + "_" + scanIndo + "_DGTL_" + artworkType + "_" + funcCampaign + "_" + width + "x" + height + "_" + duration + "_" + scanTerritory;

      const aeFolder = trotFindPDFsFolder(pdfFile.parent);
      const outputFile = new File(aeFolder + "/" + newCompName + "_V01.aep");
      if (outputFile.exists) {
        alert(newCompName + ".aep already exists. Skipping.");
        continue;
      }

      const fileToOpen = new File(textMaster);
      if (!fileToOpen.exists) {
        alert("Master file not found: " + textMaster);
        continue;
      }

      const proj = app.open(fileToOpen);
      let myComp: CompItem | null = null;
      const masterStem = masterName.split(".")[0].replace(/_V\d+$/, "");
      for (let j = 1; j <= proj.numItems; j++) {
        const item = proj.item(j);
        if (item instanceof CompItem && item.name === masterStem) myComp = item;
      }
      if (!myComp) continue;

      trotNameGen(myComp, width, height, newCompName, plm, pdfFile, false);
    } catch (err) {
      alert("Row failed: " + err.toString());
    }
  }

  alert("Total PDF files processed: " + count);
  return { success: true };
};

// Ported 1:1 from XYi_PDF_to_CSV.jsx's generateCSV() -- no project is ever
// opened, just scans filenames and writes a CSV, so this carries none of
// the master-file risk the two Trotting Along tools above do. Reuses the
// same hybrid matching / master pre-processing as Trotting Along 2.0
// (trotGimmeV2()/trotPreprocessMasters()/trotFindAllAeps()) since it's the
// same "match PDFs to masters by filename" logic the original's own
// Trotting Along 2.0-derived comment block says it's "Based on Campaign
// Localiser Logic" -- not duplicated a third time. Upgrading trotGimmeV2()
// to the shared findBestComponentFile() matcher (see its own comment)
// upgrades this tool's matching too, automatically, since it calls the
// exact same function.
interface PdfToCsvResult extends Result {
  filePath?: string;
  matched?: number;
}

export const pdfToCsvGenerate = (): PdfToCsvResult => {
  const mastersFolder = Folder.selectDialog("Select the MASTERS folder (containing .aep files)");
  if (!mastersFolder) {
    alert("No Masters folder selected. Script cancelled.");
    return { success: false, error: "No Masters folder selected." };
  }
  const pdfFolder = Folder.selectDialog("Select the PDF folder (containing input PDFs)");
  if (!pdfFolder) {
    alert("No PDF folder selected. Script cancelled.");
    return { success: false, error: "No PDF folder selected." };
  }

  const processedMasterFiles = trotPreprocessMasters(mastersFolder.fsName);
  const regexForSize = /\d*[x]\d*/;
  const pdfFiles = (pdfFolder.getFiles("*.pdf") as File[]) || [];
  let csvOutputString = "Artwork:,Campaign:,Size:,Duration:\n";
  let count = 0;

  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    if (!(pdfFile instanceof File) || !pdfFile.name.match(/\.pdf$/i)) continue;
    count++;

    const fileName = pdfFile.name;
    const sizeMatch = String(fileName.match(regexForSize));
    const sizeParts = sizeMatch.split("x");

    let width = 1920;
    let height = 1080;
    let size = "1920x1080";
    if (sizeParts.length === 2) {
      width = Math.floor(Number(sizeParts[0]));
      height = Math.floor(Number(sizeParts[1]));
      size = String(width) + "x" + String(height);
    }
    const pl: "PORTRAIT" | "LANDSCAPE" = width < height ? "PORTRAIT" : "LANDSCAPE";

    const filteredMasterFiles = processedMasterFiles.filter((m) => m.orientation === pl);
    const matchInfo = trotGimmeV2(fileName, filteredMasterFiles);
    const funcCampaign = trotRemoveStopwords(String(matchInfo[0]));
    const artworkType = matchInfo[1];
    const duration = matchInfo[2];

    csvOutputString += artworkType + "," + funcCampaign + "," + size + "," + duration + "\n";
  }

  if (count === 0) {
    alert("No PDF files found in the selected folder.");
    return { success: false, error: "No PDF files found in the selected folder." };
  }

  const aeFolderPath = pdfCsvFindPDFsFolder(pdfFolder);
  trotCreateFolderStructure(aeFolderPath);
  const csvFile = new File(aeFolderPath + "/Campaign_Data.csv");
  csvFile.encoding = "UTF-8";
  csvFile.open("w");
  csvFile.write(csvOutputString);
  csvFile.close();

  alert("Process Complete.\nMatched " + count + " files.\nCSV saved to:\n" + csvFile.fsName);
  return { success: true, filePath: csvFile.fsName, matched: count };
};

// =============================================================================
// JPEG Loc -- ported from toolset/XYi_jpgLoc.jsx, the Campaign Localiser
// tab's "JPEG Loc" button (pngLocBut -> jpgLoc). The JPG sibling of MC It!
// (PNG replacement): batch-replaces .jpg footage inside a folder of .aep
// projects with the best-matching JPG (by resolution + trailing number)
// from a second folder.
//
// **This was MISSED in the initial Campaign Localiser port** (found by a
// reverse audit of every .onClick handler in XYi_Toolbox.jsx against the
// port) -- same class of miss as Trotting Along: a sub-button of the
// Campaign Localiser tab, not a top-level listbox tab, so it slipped past
// the tab-level "all wired" check. Lesson recorded in CLAUDE.md: audit
// per-button, not per-tab.
//
// **Already copy-first in the source** (safety-patched earlier this
// session, same `ov_safeOpenMasterCopy()` LOS Tools uses -- reused here
// via `losSafeOpenMasterCopy()`), so no new safety work, only wiring.
// Unlike MC It!/pingLoc (which the studio confirmed always runs on
// working copies, so was reverted to in-place save), jpgLoc was KEPT
// copy-first -- do not "align" the two; they're deliberately different.
// Ported with the original's alert()s intact, same fidelity rule as LOS
// Tools/CSV Localiser.
// =============================================================================
interface JpegLocParsed {
  firstOne: string;
  secondOne: string;
  thirdOne: string;
  pngNumber: string;
}

// Ported 1:1 from XYi_jpgLoc.jsx's gimme() -- returns resolution
// (`thirdOne`) and the trailing number (`pngNumber`), the two tokens the
// match compares on. NOT the same as trotGimmeV1() (which returns only
// [firstOne, secondOne] and skips resolution/number), so ported fresh
// rather than reused.
function jpegLocGimme(filename: string): JpegLocParsed {
  const resolutionRegex = /\d+x\d+px?/i;
  let secondOne = "";
  if (filename.indexOf("DOOH") !== -1) secondOne = "DOOH";
  else if (filename.indexOf("DINTH") !== -1) secondOne = "DINTH";
  else if (filename.indexOf("DFOH") !== -1) secondOne = "DFOH";

  const parts = filename.split("_");
  const tokens = parts.filter((p) => p.length > 0);

  const validTokens: string[] = [];
  for (let j = 0; j < tokens.length; j++) {
    if (resolutionRegex.test(tokens[j])) break;
    validTokens.push(tokens[j]);
  }
  if (validTokens.length > 0) validTokens.shift();

  const finalTokens = validTokens.filter((t) => t !== secondOne);
  if (finalTokens.length > 1 && /^[A-Z]{2,4}$/.test(finalTokens[0])) finalTokens.shift();
  if (finalTokens.length > 1 && /^[A-Z]{2}$/.test(finalTokens[finalTokens.length - 1])) finalTokens.pop();
  const firstOne = finalTokens.join("_").toUpperCase();

  const resMatch = filename.match(/\d+x\d+/i);
  const thirdOne = resMatch ? resMatch[0] : "";
  const pngNumberMatch = filename.match(/\d+\./);
  const pngNumber = pngNumberMatch ? pngNumberMatch[0].replace(".", "") : "";

  return { firstOne, secondOne, thirdOne, pngNumber };
}

function jpegLocGetAllJpgFiles(folder: Folder): File[] {
  let fileList: File[] = [];
  const items = folder.getFiles();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item instanceof Folder) fileList = fileList.concat(jpegLocGetAllJpgFiles(item));
    else if (item instanceof File && item.name.match(/\.jpg$/i)) fileList.push(item);
  }
  return fileList;
}

function jpegLocGetAllAepFiles(folder: Folder): File[] {
  const aepFiles: File[] = [];
  const items = folder.getFiles();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item instanceof File && item.name.match(/\.aep$/i)) aepFiles.push(item);
  }
  return aepFiles;
}

function jpegLocFindProjectFolderByName(name: string): FolderItem | null {
  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof FolderItem && item.name === name) return item;
  }
  return null;
}

export const jpegLoc = (): Result => {
  const projectFolder = Folder.selectDialog("Select a folder containing After Effects Project files");
  if (!projectFolder) {
    alert("No project folder selected. Exiting.");
    return { success: true };
  }
  const aepFiles = jpegLocGetAllAepFiles(projectFolder);
  if (aepFiles.length === 0) {
    alert("No AEP files found in the selected folder. Exiting.");
    return { success: true };
  }

  const jpgRootFolder = Folder.selectDialog("Select a folder containing PNG files (search includes subfolders)");
  if (!jpgRootFolder) {
    alert("No PNG folder selected. Exiting.");
    return { success: true };
  }
  const jpgFiles = jpegLocGetAllJpgFiles(jpgRootFolder);
  if (jpgFiles.length === 0) {
    alert("No PNG files found in the selected folder. Exiting.");
    return { success: true };
  }

  let copiedCount = 0;
  let replacedInPlaceCount = 0;

  for (let p = 0; p < aepFiles.length; p++) {
    const masterFile = aepFiles[p];

    // Copy-first only if this file's name still carries the OV master
    // suffix (see hasIsolatedOvToken/losOpenForEdit above) -- an
    // already-localised working copy (e.g. "..._FR_...", no "_OV" left)
    // is opened and saved directly.
    const openedProj = losOpenForEdit(masterFile);
    if (hasIsolatedOvToken(masterFile.name)) copiedCount++;
    else replacedInPlaceCount++;
    if (!openedProj) {
      alert("Could not open project: " + masterFile.name);
      continue;
    }

    const parsedAEP = jpegLocGimme(masterFile.name);

    const footageFolder = jpegLocFindProjectFolderByName("Footage");
    if (!footageFolder) {
      alert("Footage folder not found in project: " + masterFile.name);
      continue;
    }

    let pngFolderInProject: FolderItem | null = null;
    for (let i = 1; i <= footageFolder.numItems; i++) {
      const item = footageFolder.item(i);
      if (item instanceof FolderItem && item.name === "PNG") {
        pngFolderInProject = item;
        break;
      }
    }
    if (!pngFolderInProject) {
      alert("PNG folder not found inside Footage in project: " + masterFile.name);
      continue;
    }

    for (let j = 1; j <= pngFolderInProject.numItems; j++) {
      const footageItem = pngFolderInProject.item(j) as FootageItem;
      if (footageItem.file && footageItem.file.name.match(/\.jpg$/i)) {
        const parsedOriginal = jpegLocGimme(footageItem.file.name);

        for (let k = 0; k < jpgFiles.length; k++) {
          const candidate = jpgFiles[k];
          const parsedCandidate = jpegLocGimme(candidate.name);
          if (parsedAEP.thirdOne === parsedCandidate.thirdOne && parsedOriginal.pngNumber === parsedCandidate.pngNumber) {
            footageItem.replace(candidate);
            $.sleep(500);
            break;
          }
        }
      }
    }

    app.project.save();
    $.sleep(1500);
  }

  let summary = "PNG replacement process complete!";
  if (replacedInPlaceCount > 0) summary += " " + replacedInPlaceCount + " file(s) replaced in place.";
  if (copiedCount > 0) summary += " " + copiedCount + " master(s) (still carrying an \"_OV\" filename) were left untouched -- written to a new \"_V0N.aep\" copy instead.";
  alert(summary);
  return { success: true };
};

// =============================================================================
// Localised Library -- ported 1:1 from XYi_Localised_Library.jsx (a
// standalone ScriptUI palette, launched next to the search bar in the
// original toolbox, not part of the vertical listbox -- see CLAUDE.md).
// A campaign -> territory -> component library, manually curated (or
// auto-populated from a "Support_Motion"/"Motion_Components"/"JPG_PNG"
// folder).
// Territories are auto-detected by scanning the campaign's Markets root.
// Read-only: importFile()/revealFile() (shared with OV Library, reused
// directly below) are the only file actions -- nothing here ever opens a
// file for editing.
// =============================================================================
interface LocLibCampaign {
  name: string;
  marketsRoot: string;
}

interface LocLibComponent {
  campaign: string;
  territory: string;
  label: string;
  path: string;
  // Explicit folder assignment (LocalisedLibrary.tsx's "mini directories"
  // split, e.g. PNG/AEP/AI) -- "" or absent means the frontend auto-buckets
  // it by file extension instead. Never derived here; the actual files on
  // disk aren't necessarily organised this way, this is a library-only
  // grouping, same spirit as everything else in this file being a virtual
  // catalogue over real files rather than a mirror of their real layout.
  folder?: string;
}

interface LocLibFolder {
  campaign: string;
  territory: string;
  name: string;
}

const LL_CAMPAIGNS_KEY = "LocLibCampaigns";
const LL_COMPONENTS_KEY = "LocLibComponents";
const LL_FOLDERS_KEY = "LocLibFolders";

function loadLocLibCampaignsRaw(): LocLibCampaign[] {
  const out: LocLibCampaign[] = [];
  if (app.settings.haveSetting(SETTINGS_SECTION, LL_CAMPAIGNS_KEY)) {
    const raw = app.settings.getSetting(SETTINGS_SECTION, LL_CAMPAIGNS_KEY);
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "") continue;
      const parts = lines[i].split("\t");
      if (parts.length >= 2) out.push({ name: parts[0], marketsRoot: parts[1] });
    }
  }
  return out;
}

function saveLocLibCampaignsRaw(arr: LocLibCampaign[]): void {
  const lines: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const nm = String(arr[i].name).replace(/[\t\n\r]/g, " ");
    const rt = String(arr[i].marketsRoot).replace(/[\t\n\r]/g, " ");
    lines.push(nm + "\t" + rt);
  }
  app.settings.saveSetting(SETTINGS_SECTION, LL_CAMPAIGNS_KEY, lines.join("\n"));
}

function loadLocLibComponentsRaw(): LocLibComponent[] {
  const out: LocLibComponent[] = [];
  if (app.settings.haveSetting(SETTINGS_SECTION, LL_COMPONENTS_KEY)) {
    const raw = app.settings.getSetting(SETTINGS_SECTION, LL_COMPONENTS_KEY);
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "") continue;
      const parts = lines[i].split("\t");
      // parts.length >= 4 (not 5) on purpose -- a component saved before
      // the folder field existed still loads fine, just with folder
      // undefined (auto-bucket by extension on the frontend).
      if (parts.length >= 4) {
        const entry: LocLibComponent = { campaign: parts[0], territory: decode(parts[1]), label: parts[2], path: parts[3] };
        if (parts.length >= 5 && parts[4]) entry.folder = decode(parts[4]);
        out.push(entry);
      }
    }
  }
  return out;
}

function saveLocLibComponentsRaw(arr: LocLibComponent[]): void {
  const lines: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const c = String(arr[i].campaign).replace(/[\t\n\r]/g, " ");
    const t = String(arr[i].territory).replace(/[\t\n\r]/g, " ");
    const l = String(arr[i].label).replace(/[\t\n\r]/g, " ");
    const p = String(arr[i].path).replace(/[\t\n\r]/g, " ");
    const f = String(arr[i].folder || "").replace(/[\t\n\r]/g, " ");
    lines.push(c + "\t" + t + "\t" + l + "\t" + p + "\t" + f);
  }
  app.settings.saveSetting(SETTINGS_SECTION, LL_COMPONENTS_KEY, lines.join("\n"));
}

// Custom folders (LocalisedLibrary.tsx's "New Folder…") -- scoped per
// campaign+territory, separate from the auto extension-derived buckets
// (PNG/AEP/AI/etc.), which aren't persisted at all since they're purely
// computed from each component's path on the frontend. A folder record
// here exists so a just-created, still-empty folder has somewhere to be
// remembered -- once it has a component in it, that component's own
// `folder` field is really what makes it show up either way.
function loadLocLibFoldersRaw(): LocLibFolder[] {
  const out: LocLibFolder[] = [];
  if (app.settings.haveSetting(SETTINGS_SECTION, LL_FOLDERS_KEY)) {
    const raw = app.settings.getSetting(SETTINGS_SECTION, LL_FOLDERS_KEY);
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "") continue;
      const parts = lines[i].split("\t");
      if (parts.length >= 3) out.push({ campaign: parts[0], territory: decode(parts[1]), name: decode(parts[2]) });
    }
  }
  return out;
}

function saveLocLibFoldersRaw(arr: LocLibFolder[]): void {
  const lines: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const c = String(arr[i].campaign).replace(/[\t\n\r]/g, " ");
    const t = String(arr[i].territory).replace(/[\t\n\r]/g, " ");
    const n = String(arr[i].name).replace(/[\t\n\r]/g, " ");
    lines.push(c + "\t" + t + "\t" + n);
  }
  app.settings.saveSetting(SETTINGS_SECTION, LL_FOLDERS_KEY, lines.join("\n"));
}

export const loadLocLibFolders = (): LocLibFolder[] => loadLocLibFoldersRaw();

export const createLocLibFolder = (campaign: string, territory: string, name: string): Result => {
  try {
    const trimmed = name.replace(/^\s+|\s+$/g, "");
    if (!trimmed) return { success: false, error: "Folder name can't be empty." };
    const folders = loadLocLibFoldersRaw();
    for (let i = 0; i < folders.length; i++) {
      if (folders[i].campaign === campaign && folders[i].territory === territory && folders[i].name.toLowerCase() === trimmed.toLowerCase()) {
        return { success: false, error: 'A folder named "' + trimmed + '" already exists here.' };
      }
    }
    folders.push({ campaign, territory, name: trimmed });
    saveLocLibFoldersRaw(folders);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Deletes the folder record and clears its assignment off every component
// currently filed under it -- those components aren't deleted, they just
// fall back to auto-bucketing by extension, same as any component that
// never had an explicit folder to begin with.
export const removeLocLibFolder = (campaign: string, territory: string, name: string): Result => {
  try {
    const folders = loadLocLibFoldersRaw().filter((f) => !(f.campaign === campaign && f.territory === territory && f.name === name));
    saveLocLibFoldersRaw(folders);

    const components = loadLocLibComponentsRaw();
    for (let i = 0; i < components.length; i++) {
      const c = components[i];
      if (c.campaign === campaign && c.territory === territory && c.folder === name) {
        delete c.folder;
      }
    }
    saveLocLibComponentsRaw(components);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Reassigns one component's folder -- folder === "" clears the explicit
// assignment (reverts to auto-bucketing by extension). Matches the same
// (campaign, territory, label, path) identity removeLocLibComponent uses.
export const setLocLibComponentFolder = (campaign: string, territory: string, label: string, path: string, folder: string): Result => {
  try {
    const all = loadLocLibComponentsRaw();
    for (let i = 0; i < all.length; i++) {
      if (all[i].campaign === campaign && all[i].territory === territory && all[i].label === label && all[i].path === path) {
        if (folder) all[i].folder = folder;
        else delete all[i].folder;
        break;
      }
    }
    saveLocLibComponentsRaw(all);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const loadLocLibCampaigns = (): LocLibCampaign[] => loadLocLibCampaignsRaw();

export const saveLocLibCampaign = (name: string, marketsRoot: string): Result => {
  try {
    const camps = loadLocLibCampaignsRaw();
    for (let i = 0; i < camps.length; i++) {
      if (camps[i].name === name) {
        return { success: false, error: 'A campaign named "' + name + '" already exists.' };
      }
    }
    camps.push({ name: name, marketsRoot: marketsRoot });
    saveLocLibCampaignsRaw(camps);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const removeLocLibCampaign = (name: string): Result => {
  try {
    const camps = loadLocLibCampaignsRaw();
    for (let i = 0; i < camps.length; i++) {
      if (camps[i].name === name) {
        camps.splice(i, 1);
        break;
      }
    }
    saveLocLibCampaignsRaw(camps);

    const remaining = loadLocLibComponentsRaw().filter((c) => c.campaign !== name);
    saveLocLibComponentsRaw(remaining);

    const remainingFolders = loadLocLibFoldersRaw().filter((f) => f.campaign !== name);
    saveLocLibFoldersRaw(remainingFolders);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const selectMarketsFolder = (): string | null => {
  const folder = Folder.selectDialog('Select the campaign\'s "Markets" (territories) root folder:');
  return folder ? folder.fsName : null;
};

export const scanTerritories = (marketsRoot: string): string[] => {
  const out: string[] = [];
  const folder = new Folder(marketsRoot);
  if (!folder.exists) return out;
  const items = folder.getFiles();
  for (let i = 0; i < items.length; i++) {
    if (items[i] instanceof Folder && items[i].name.charAt(0) !== "_") {
      out.push(decode(items[i].name));
    }
  }
  out.sort();
  return out;
};

// "You may be in..." suggestion (LocalisedLibrary.tsx) -- detects which of
// the CURRENT campaign's own scanned territories the open project's saved
// file path is sitting inside, by walking up the folder tree from the
// file and matching each ancestor folder's name (case-insensitive)
// against the passed-in territory list. Same "walk up from the saved
// file, match a folder name" technique Timesheet Tracker's own
// tsExtractInfoFromPath() (tools.ts) already uses for job/territory
// detection -- but matched against THIS campaign's real, scanned
// territory folder names (from scanTerritories above) rather than a
// fixed global vocabulary, since Loc Lib's territory list is already
// derived live from disk per campaign and is more accurate than a
// hardcoded list for this purpose. Deliberately scoped to the currently
// selected campaign's territories only -- doesn't try to also detect
// *which campaign* the project belongs to; if the wrong campaign is
// selected, this just returns null (no suggestion), which is a safe,
// unsurprising fallback, not a bug.
export const detectCurrentTerritory = (territories: string[]): string | null => {
  const projFile = app.project.file;
  if (!projFile) return null;

  let currentFolder: Folder | null = projFile.parent;
  while (currentFolder !== null) {
    const folderName = decode(currentFolder.name).toLowerCase();
    for (let t = 0; t < territories.length; t++) {
      if (territories[t].toLowerCase() === folderName) return territories[t];
    }
    if (currentFolder.parent && currentFolder.parent.absoluteURI !== currentFolder.absoluteURI) {
      currentFolder = currentFolder.parent;
    } else {
      break;
    }
  }
  return null;
};

export const loadLocLibComponents = (): LocLibComponent[] => loadLocLibComponentsRaw();

export const addLocLibComponent = (campaign: string, territory: string, label: string, path: string, folder?: string): Result => {
  try {
    const all = loadLocLibComponentsRaw();
    const entry: LocLibComponent = { campaign, territory, label, path };
    if (folder) entry.folder = folder;
    all.push(entry);
    saveLocLibComponentsRaw(all);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const removeLocLibComponent = (campaign: string, territory: string, label: string, path: string): Result => {
  try {
    const all = loadLocLibComponentsRaw();
    for (let k = 0; k < all.length; k++) {
      if (all[k].campaign === campaign && all[k].territory === territory && all[k].label === label && all[k].path === path) {
        all.splice(k, 1);
        break;
      }
    }
    saveLocLibComponentsRaw(all);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

export const selectComponentFile = (territoryName: string): string | null => {
  const f = File.openDialog("Select the file for this component (" + territoryName + "):");
  return f ? f.fsName : null;
};

// --- Auto-populate: find every file under a "Support_Motion" or
// "Motion_Components" folder (underscore or space, case-insensitive)
// anywhere within a territory's tree. Read-only -- only ever lists folder
// contents.
//
// **JPG_PNG deliberately EXCLUDED from this eager scan** (previously
// included alongside the two motion containers) -- a real JPG_PNG folder
// turned out to contain many delivery-batch subfolders (Batch_1,
// Batch_1_Post, Batch_2, ... Bespoke, Bespoke_Post), each full of images,
// so recursing into it here made Auto-Populate "way too heavy" (hundreds
// of flat components dumped into the library from one territory). JPG_PNG
// now has its own dedicated, LAZY flow instead -- see
// scanJpgPngBatches()/scanJpgPngBatchFiles() below, wired to
// LocalisedLibrary.tsx's collapsible "JPG_PNG" section (only scans when
// clicked, and only one batch folder at a time, never the whole tree at
// once).
function llIsComponentsContainerName(name: string): boolean {
  const norm = String(name).toLowerCase().replace(/[_\s]+/g, "");
  return norm === "supportmotion" || norm === "motioncomponents";
}

function llCollectAllFiles(folder: Folder, results: File[]) {
  const items = folder.getFiles();
  for (let i = 0; i < items.length; i++) {
    if (items[i] instanceof Folder) {
      llCollectAllFiles(items[i] as Folder, results);
    } else if (items[i] instanceof File) {
      results.push(items[i] as File);
    }
  }
}

function llFindComponentFiles(territoryFolder: Folder, maxSearchDepth: number): File[] {
  const results: File[] = [];
  const search = (folder: Folder, depth: number) => {
    if (depth > maxSearchDepth) return;
    const items = folder.getFiles();
    for (let i = 0; i < items.length; i++) {
      if (items[i] instanceof Folder) {
        if (llIsComponentsContainerName(items[i].name)) {
          llCollectAllFiles(items[i] as Folder, results);
        } else {
          search(items[i] as Folder, depth + 1);
        }
      }
    }
  };
  if (territoryFolder.exists) search(territoryFolder, 0);
  return results;
}

interface AutoPopulateResult {
  success: boolean;
  error?: string;
  added?: number;
  skippedExisting?: number;
  territoriesWithNoMatch?: string[];
}

export const autoPopulateLocLib = (campaignName: string, marketsRoot: string, onlyTerritory?: string): AutoPopulateResult => {
  try {
    const territories = onlyTerritory ? [onlyTerritory] : scanTerritories(marketsRoot);
    const existing = loadLocLibComponentsRaw();
    let added = 0;
    let skippedExisting = 0;
    const territoriesWithNoMatch: string[] = [];

    for (let i = 0; i < territories.length; i++) {
      const terrName = territories[i];
      const terrFolder = new Folder(marketsRoot + "/" + terrName);
      const files = llFindComponentFiles(terrFolder, 4);

      if (files.length === 0) {
        territoriesWithNoMatch.push(terrName);
        continue;
      }

      for (let j = 0; j < files.length; j++) {
        const fPath = files[j].fsName;
        let alreadyThere = false;
        for (let k = 0; k < existing.length; k++) {
          if (existing[k].campaign === campaignName && existing[k].territory === terrName && existing[k].path === fPath) {
            alreadyThere = true;
            break;
          }
        }
        if (alreadyThere) {
          skippedExisting++;
          continue;
        }

        const label = decode(files[j].name).replace(/\.[^.]+$/, "");
        existing.push({ campaign: campaignName, territory: terrName, label: label, path: fPath });
        added++;
      }
    }

    saveLocLibComponentsRaw(existing);
    return { success: true, added, skippedExisting, territoriesWithNoMatch };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// JPG_PNG lazy browse -- click-to-fetch replacement for pulling JPG_PNG
// into the eager Auto-Populate scan (see the removal note above
// llIsComponentsContainerName). Nothing here writes to the persisted
// component library -- this is a live, read-only filesystem browse each
// time, not library data, since a delivery batch's own JPG/PNG contents
// can change day to day and don't belong "saved" the way a deliberately-
// curated component does.
//
// **ONE-LEVEL-AT-A-TIME, not recursive -- this is the second real fix in
// this section, found on a second real-AE test.** The first version's
// scanJpgPngBatchFiles recursively collected every image anywhere inside
// a batch, which caused two real, visible problems against a real batch
// folder: (1) it silently descended into "_old" (an underscore-prefixed
// archive folder that every OTHER scan in this toolset already excludes
// -- this one just forgot to), pulling in stale/duplicate-looking
// versions of the same creative; (2) flattening every nested creative
// subfolder into one list meant two files that happen to share a name
// (one live, one archived, or just two different creatives that reused a
// filename) rendered as visually indistinguishable "duplicates" with no
// way to tell them apart short of hovering for the full path. Replaced
// with scanJpgPngLevel(folderPath), a plain single-level directory
// listing (folders -- "_"-prefixed excluded, same convention as every
// other scan here -- and JPG/JPEG/PNG files, both at that one level
// only). The React side (LocalisedLibrary.tsx) calls this once per click
// as the user drills batch -> subfolder -> subfolder..., keeping files
// grouped in their REAL folders exactly as they sit on disk, instead of
// this file trying to flatten/dedupe them after the fact.
// =============================================================================
function llIsJpgPngContainerName(name: string): boolean {
  const norm = String(name).toLowerCase().replace(/[_\s]+/g, "");
  return norm === "jpgpng" || norm === "pngjpg";
}

// Generic depth-limited "find the shallowest folder whose name matches"
// search. **BREADTH-first, not depth-first -- this is a deliberate fix,
// not the original shape.** A depth-first version (checking each
// non-matching folder's ENTIRE subtree before moving on to its next
// sibling) shipped first and had a real bug found against a real studio
// tree: a territory's own top-level JPG_PNG (a direct sibling of AE/
// Masters/Mechs/PDFs/PSD/Renders) sits right next to an "AE" folder --
// and AE project structures commonly have their OWN nested "JPG_PNG"
// footage-source folder buried inside a creative's asset tree. Depth-
// first search recursed fully into AE (which happened to be enumerated
// before JPG_PNG) and latched onto that unrelated NESTED decoy the
// moment it matched the same name pattern, stopping immediately --
// so the real, intended top-level JPG_PNG (with all its real delivery
// batches) was never even reached, and the batch list came back empty
// even though `jpgPngPath` looked like a "successful" find. Breadth-
// first checks every folder AT the current depth before descending into
// ANY of them, which guarantees the shallowest match (the real,
// intended top-level JPG_PNG) wins over a coincidentally-named folder
// buried deeper inside an unrelated subtree. If a similar "found A
// folder, but the wrong one" bug ever turns up for the Support_Motion/
// Motion_Components lookup too, this is the class of fix to reach for.
function llFindContainerFolder(territoryFolder: Folder, matcher: (name: string) => boolean, maxSearchDepth: number): Folder | null {
  if (!territoryFolder.exists) return null;
  let currentLevel: Folder[] = [territoryFolder];
  for (let depth = 0; depth <= maxSearchDepth && currentLevel.length > 0; depth++) {
    const nextLevel: Folder[] = [];
    for (let f = 0; f < currentLevel.length; f++) {
      const items = currentLevel[f].getFiles();
      for (let i = 0; i < items.length; i++) {
        if (items[i] instanceof Folder) {
          if (matcher(items[i].name)) return items[i] as Folder;
          nextLevel.push(items[i] as Folder);
        }
      }
    }
    currentLevel = nextLevel;
  }
  return null;
}

const JPG_PNG_EXTENSIONS = ["jpg", "jpeg", "png"];

interface JpgPngLevelResult extends Result {
  folders?: string[]; // immediate, non-"_"-prefixed subfolders
  files?: { name: string; path: string }[]; // immediate JPG/JPEG/PNG files
}

// The one real listing primitive for the whole JPG_PNG browse -- called
// fresh for every level the user drills into (the JPG_PNG root itself,
// a batch, or any subfolder inside a batch), never recursive. A folder's
// contents can change day to day, so there's no caching beyond what the
// React side already does per level.
function llScanJpgPngLevel(folder: Folder): { folders: string[]; files: { name: string; path: string }[] } {
  const items = folder.getFiles();
  const folders: string[] = [];
  const files: { name: string; path: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item instanceof Folder) {
      // Same "_-prefixed folders are excluded from every scan" convention
      // as scanTerritories/scanJpgPngBatches -- this is what keeps a
      // "_old" archive folder out of the listing at EVERY level, not just
      // the top one (the bug the previous recursive version had).
      if (item.name.charAt(0) !== "_") folders.push(decode(item.name));
    } else if (item instanceof File) {
      const m = item.name.match(/\.([A-Za-z0-9]+)$/);
      const ext = m ? m[1].toLowerCase() : "";
      if (JPG_PNG_EXTENSIONS.indexOf(ext) !== -1) files.push({ name: decode(item.name), path: item.fsName });
    }
  }
  folders.sort();
  files.sort(function (a, b) {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return { folders, files };
}

export const scanJpgPngLevel = (folderPath: string): JpgPngLevelResult => {
  try {
    const folder = new Folder(folderPath);
    if (!folder.exists) return { success: false, error: "That folder no longer exists." };
    const { folders, files } = llScanJpgPngLevel(folder);
    return { success: true, folders, files };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface JpgPngBatchesResult extends Result {
  jpgPngPath?: string | null; // null (with success:true) means genuinely not found, not an error
  batches?: string[];
  files?: { name: string; path: string }[]; // stray images sitting directly in JPG_PNG, outside any batch
}

export const scanJpgPngBatches = (territoryPath: string): JpgPngBatchesResult => {
  try {
    const terrFolder = new Folder(territoryPath);
    const jpgPngFolder = llFindContainerFolder(terrFolder, llIsJpgPngContainerName, 4);
    if (!jpgPngFolder) return { success: true, jpgPngPath: null, batches: [] };

    const { folders, files } = llScanJpgPngLevel(jpgPngFolder);
    return { success: true, jpgPngPath: jpgPngFolder.fsName, batches: folders, files };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// "Current file" quick-access suggestion -- given the names visible at
// whatever JPG_PNG level is currently being browsed (folders + files,
// React passes both in one flat list), guesses which one corresponds to
// the AE project that's actually open right now, matching this file's
// established "You may be in..." reasoning (detectCurrentTerritory
// above) but for a creative's JPG/PNG assets instead of a territory.
//
// **Deliberately NOT reusing shared.ts's findBestComponentFile.** That
// scorer always returns ITS best guess among the candidates given, even
// when none of them are genuinely related (its own accept-threshold
// check returns the same `best` either way -- effectively dead code) --
// fine for its existing callers (MC It!/LOS Tools), which are matching
// against a curated candidate list where SOME match is always expected,
// but wrong for a purely decorative, easy-to-get-wrong suggestion like
// this one, where "no real match" needs to genuinely mean no suggestion.
// This uses a plain, conservative check instead: a normalized substring
// match either direction, or a majority of meaningful (3+ character)
// tokens shared -- either one is a strong, simple, deliberately narrow
// signal real studio filenames actually produce (the AE project and its
// JPG_PNG counterpart usually share the exact creative name/phrase), not
// a fuzzy "closest of a bad lot" guess.
function llNormalizeForMatch(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s+|\s+$/g, "");
}

export const suggestJpgPngMatch = (candidateNames: string[]): string | null => {
  const projFile = app.project.file;
  if (!projFile) return null;
  const stem = llNormalizeForMatch(decode(projFile.name));
  if (!stem) return null;
  const stemTokens = stem.split(" ");

  let best: string | null = null;
  let bestScore = 0;
  for (let i = 0; i < candidateNames.length; i++) {
    const norm = llNormalizeForMatch(candidateNames[i]);
    if (!norm) continue;

    if (norm.indexOf(stem) !== -1 || stem.indexOf(norm) !== -1) {
      const score = Math.min(norm.length, stem.length) + 1000; // always beats a token-overlap match
      if (score > bestScore) {
        bestScore = score;
        best = candidateNames[i];
      }
      continue;
    }

    const normTokens = norm.split(" ");
    let shared = 0;
    for (let t = 0; t < stemTokens.length; t++) {
      if (stemTokens[t].length < 3) continue; // skip tiny tokens ("sp"/"br"/etc.) that match almost anything
      if (normTokens.indexOf(stemTokens[t]) !== -1) shared++;
    }
    const ratio = stemTokens.length > 0 ? shared / stemTokens.length : 0;
    if (ratio >= 0.5 && shared > bestScore) {
      bestScore = shared;
      best = candidateNames[i];
    }
  }
  return best;
};

// =============================================================================
// Batch import -- two related actions for the Localised Library.
//
// Feature 1 (importLocLibComponentsBatch) imports the checked components
// into the CURRENT project, read-only, same as every other import in this
// app -- no exception to the masters rule needed here.
//
// Feature 2 (importComponentsIntoBatchFolder) is a deliberate, narrow
// EXCEPTION to this file's usual "import only, never open, never save"
// rule -- see the big comment above it for why that's safe here and what
// guards it.
// =============================================================================
interface BatchImportResult extends Result {
  imported?: number;
  failed?: string[]; // "filename (reason)" entries for the summary toast
}

// Shared by both actions below. Reports per-file failures instead of
// aborting the whole batch on the first bad file -- a batch of 8 where 1
// file went missing should still bring in the other 7, matching how
// autoPopulateLocLib() above already treats a batch operation as
// "do as much as you can, tell me what didn't work" rather than all-or-
// nothing.
function importFilesRaw(paths: string[]): BatchImportResult {
  let imported = 0;
  const failed: string[] = [];
  for (let i = 0; i < paths.length; i++) {
    const f = new File(paths[i]);
    if (!f.exists) {
      failed.push(f.displayName + " (missing)");
      continue;
    }
    try {
      app.project.importFile(new ImportOptions(f));
      imported++;
    } catch (e) {
      failed.push(f.displayName + " (" + e.toString() + ")");
    }
  }
  return { success: true, imported: imported, failed: failed };
}

// Feature 1: batch-import whichever components the user checked in the
// current territory. Just a thin wrapper over importFilesRaw -- exported
// separately (rather than making callers always go through the batch-
// folder variant below with an empty folder) since "import just what I
// selected" is the more common, simpler case.
export const importLocLibComponentsBatch = (paths: string[]): BatchImportResult => {
  return importFilesRaw(paths);
};

// Recursively finds every .aep file under a folder -- same "_"-prefix
// exclusion convention as every other scan in this toolset (CLAUDE.md:
// "Folders starting with _ ... are excluded from every scan across this
// whole toolset, not just this panel"), same maxSearchDepth=4 convention
// as llFindComponentFiles() above for consistency within this file.
function findAepFilesRecursive(folder: Folder, depth: number, maxDepth: number, results: File[]) {
  if (depth > maxDepth) return;
  const items = folder.getFiles();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item instanceof Folder) {
      if (item.name.charAt(0) === "_") continue;
      findAepFilesRecursive(item, depth + 1, maxDepth, results);
    } else if (item instanceof File && /\.aep$/i.test(item.name)) {
      results.push(item);
    }
  }
}

// Feature 2: user explicitly picks the batch folder via a native dialog
// -- deliberately NOT derived from the component's own path by guessing
// at a naming/folder convention. This project has been burned before by
// baking in an unverified real-world folder convention (see the OV
// Library render-pairing and QUAD-detection caveats elsewhere in
// CLAUDE.md); a folder picker sidesteps that risk entirely and works
// regardless of how a given studio's batch folders are actually named
// or nested relative to the components.
export const selectBatchFolder = (): string | null => {
  const folder = Folder.selectDialog("Select the batch folder to open, inject the selected components into, and save:");
  if (!folder) return null;
  return folder.fsName;
};

// Normalises a path for prefix comparison: backslashes -> forward slashes,
// lowercased (Windows paths are case-insensitive; matching loosely on Mac
// too is harmless -- worst case it's slightly over-cautious, never under-),
// single trailing slash so "…/Masters" can't accidentally prefix-match
// "…/MastersOverflow".
function normPathForCompare(p: string): string {
  let out = p.replace(/\\/g, "/").toLowerCase();
  if (out.charAt(out.length - 1) !== "/") out += "/";
  return out;
}

// Guards importComponentsIntoBatchFolder against ever being pointed at a
// Masters tree. Masters and localised batch folders are two genuinely
// different things in this studio's workflow (confirmed with the user,
// not assumed): Masters are the OV/English versions approved by HO and
// meant to stay untouched read-only source-of-truth (OV Library's whole
// existence enforces that); a "batch folder" is a localised delivery
// batch (e.g. "Batch_01" for France) that's expected to be opened, have
// components dropped in, and saved as a normal part of the job. Localised
// Library has no direct knowledge of which folders are Masters roots, but
// OV Library's own saved campaigns do -- reusing that list here catches
// the realistic mistake (picking the wrong folder in the dialog) even
// though the two tools are otherwise independent.
function findMastersRootCollision(batchFolderPath: string): string | null {
  const target = normPathForCompare(batchFolderPath);
  const masters = loadCampaignsRaw();
  for (let i = 0; i < masters.length; i++) {
    const root = normPathForCompare(masters[i].mastersRoot);
    if (target.indexOf(root) === 0 || root.indexOf(target) === 0) {
      return masters[i].mastersRoot;
    }
  }
  return null;
}

export interface BatchFolderPreview {
  success: boolean;
  error?: string;
  blocked?: boolean;
  blockedReason?: string;
  count?: number;
}

// Dry run -- scans and safety-checks the picked folder WITHOUT opening or
// saving anything, so the React side can show the user an accurate count
// and get their confirmation before importComponentsIntoBatchFolder does
// anything irreversible.
export const previewBatchFolderAep = (batchFolderPath: string): BatchFolderPreview => {
  try {
    const folder = new Folder(batchFolderPath);
    if (!folder.exists) return { success: false, error: "That folder no longer exists." };
    const collision = findMastersRootCollision(batchFolderPath);
    if (collision) {
      return {
        success: true,
        blocked: true,
        blockedReason:
          'That folder is inside (or contains) a Masters root ("' +
          collision +
          '") saved in OV Library. Masters must never be opened or saved over -- pick a localised batch delivery folder instead.',
      };
    }
    const aepFiles: File[] = [];
    findAepFilesRecursive(folder, 0, 4, aepFiles);
    return { success: true, blocked: false, count: aepFiles.length };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// Feature 2, for real: opens every .aep found in the batch folder, imports
// the selected components into it, and saves it in place -- so the
// components are already sitting in the project the next time someone
// opens that file normally. This is a deliberate, narrow exception to
// this file's usual "import only, never open, never save" rule, safe only
// because batch-folder files are confirmed-with-the-user localised
// delivery copies, never the Masters (see findMastersRootCollision above,
// re-checked here rather than trusting the caller already ran the preview
// -- defence in depth, since this function is the one that actually
// writes to disk).
//
// AE is single-document: opening file 2 silently replaces file 1 as the
// active project. Whatever project the user had open when this started is
// restored at the end (best-effort) -- but any UNSAVED changes in that
// original project are discarded the moment the first batch file opens,
// since ExtendScript has no reliable "unsaved changes" flag to check
// first. The confirmation dialog on the React side warns about this
// before calling here; this function does not re-warn, it just proceeds.
export const importComponentsIntoBatchFolder = (componentPaths: string[], batchFolderPath: string): BatchImportResult => {
  const collision = findMastersRootCollision(batchFolderPath);
  if (collision) {
    return {
      success: false,
      error: 'That folder is inside (or contains) a Masters root ("' + collision + '"). Refusing to open/save into it.',
    };
  }

  const folder = new Folder(batchFolderPath);
  if (!folder.exists) return { success: false, error: "That folder no longer exists." };

  const aepFiles: File[] = [];
  findAepFilesRecursive(folder, 0, 4, aepFiles);

  const originalProjectFile = app.project && app.project.file ? app.project.file : null;

  let imported = 0;
  const failed: string[] = [];
  for (let i = 0; i < aepFiles.length; i++) {
    const target = aepFiles[i];
    try {
      const opened = app.open(target);
      if (!opened) {
        failed.push(target.displayName + " (failed to open)");
        continue;
      }
    } catch (e) {
      failed.push(target.displayName + " (" + e.toString() + ")");
      continue;
    }

    let importFailure: string | null = null;
    for (let c = 0; c < componentPaths.length; c++) {
      const compFile = new File(componentPaths[c]);
      if (!compFile.exists) {
        importFailure = compFile.displayName + " missing";
        continue;
      }
      try {
        app.project.importFile(new ImportOptions(compFile));
      } catch (e) {
        importFailure = compFile.displayName + " (" + e.toString() + ")";
      }
    }

    try {
      app.project.save();
      if (importFailure) {
        failed.push(target.displayName + " (saved, but " + importFailure + ")");
      } else {
        imported++;
      }
    } catch (e) {
      failed.push(target.displayName + " (save failed: " + e.toString() + ")");
    }
  }

  if (originalProjectFile) {
    try {
      app.open(originalProjectFile);
    } catch (e) {
      failed.push("(could not reopen your original project -- reopen it manually: " + originalProjectFile.fsName + ")");
    }
  }

  return { success: true, imported: imported, failed: failed };
};

// Cosmetic-only territory -> country-code badge (reuses the same
// TC_COUNTRIES table Cheeky T Check's territoryCheck() already has,
// just the reverse lookup direction -- name to code instead of code to
// name). Ported from XYi_Cheeky_InvT_Check.jsx's getCountryCode().
//
// Re-ported to use the shared findBestComponentFile() hybrid matcher
// instead of a plain substring scan -- matches the studio's current
// XYi_Cheeky_InvT_Check.jsx, which calls the same shared Detective()
// matcher every other filename/name-matching tool in this codebase now
// uses. The old plain-indexOf version required territoryName to be an
// exact substring of a TC_COUNTRIES entry, so a real folder name with a
// typo, abbreviation, or extra descriptive text and no clean substring
// match returned null outright; the hybrid matcher tolerates that.
// Still no .match(dynamicString) anywhere in this path (findBestComponentFile
// only ever uses fixed hardcoded regexes internally, never the caller's own
// string as a pattern), so the earlier regex-injection fix this function
// needed (a real folder name like "APAC (ex. China)" used to throw a
// SyntaxError against .match()) stays intact.
export const getTerritoryCountryCode = (territoryName: string): string | null => {
  const userInput = territoryName.toLowerCase().replace("_", " ");
  const bestMatch = findBestComponentFile(userInput, TC_COUNTRIES);
  return bestMatch ? bestMatch.code : null;
};

// =============================================================================
// Name Generator -- ported from XYi_Toolbox.jsx's nameGen()/nameBox()/
// TC_nameBox() (the latter from XYi_Cheeky_N_Check.jsx). Builds a standard
// comp/filename from form fields, or reverse-parses one of those names back
// into the fields ("Detect Name"). Pure metadata: renames the selected
// project item(s), never touches a master file on disk.
// =============================================================================
interface NameGeneratorResult extends Result {
  newName?: string;
}

export const nameGeneratorGenerate = (
  filmTitle: string,
  isInternational: boolean,
  artworkType: string,
  campaign: string,
  territory: string
): NameGeneratorResult => {
  try {
    const sel = app.project.selection;
    if (sel.length === 0) return { success: false, error: "Please select one or more compositions first." };

    app.beginUndoGroup("XYi Name Generator");
    let lastName = "";
    for (let i = 0; i < sel.length; i++) {
      const item = sel[i];
      const indo = isInternational ? "INTL" : "DOM";
      const newName = filmTitle + "_" + indo + "_DGTL_" + artworkType + "_" + campaign + "_" + item.width + "x" + item.height + "_" + Math.round(item.duration) + "sec_" + territory;
      item.name = newName;
      lastName = newName;
    }
    app.endUndoGroup();
    return { success: true, newName: lastName };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

interface NameDetectResult extends Result {
  filmTitle?: string;
  artworkType?: string;
  campaign?: string;
  territory?: string;
  isInternational?: boolean;
  duration?: string;
  version?: string;
}

// Ported from TC_nameBox() in XYi_Cheeky_N_Check.jsx -- reverse-parses a
// standard name back into its component fields. Pure string parsing, reads
// nothing from disk. Re-ported to a more robust upstream revision of
// TC_nameBox() (the studio's file had since moved on from the version this
// was first ported against), fixing three real gaps the old port had:
//  1. Never stripped the file extension first, so a territory landing as
//     the very last real token (e.g. "..._10sec_BR.aep") failed its own
//     "underscore-or-end-of-string" match, since ".aep" followed it
//     instead of either.
//  2. Assumed the DGTL-prefixed convention unconditionally (no fallback
//     for a "...[Campaign]_[Artwork]_..." ordering without "_DGTL_").
//  3. Duration/territory regexes scanned the WHOLE name unscoped, risking
//     a false match against a coincidental digit/letter run earlier in
//     the campaign name itself -- now scoped to only the tokens after the
//     size match, same as the studio's own current source.
// Also adds `version` (TC_Version in the original), which the old port
// never exposed at all. `duration` was added earlier when Trotting Along
// 2.0/PDF to CSV were ported -- both need it and both call this same
// parser (as `FilNameChe()`/`gimme()` did in the original) rather than
// duplicating TC_nameBox() a third time. Existing callers that don't
// care about `version` simply don't read it, so this stays additive.
function nameGeneratorParse(name: string): NameDetectResult {
  const artworkTypes = ["DOOH", "DFOH", "DINTH", "FOH"];

  let cleanName = name;
  const extIndex = cleanName.lastIndexOf(".");
  if (extIndex > 0) cleanName = cleanName.substring(0, extIndex);

  const parts = cleanName.split("_");

  // 1. Region (INTL/DOM) and film title -- everything before it.
  let regionIndex = -1;
  let indom = "";
  for (let i = 0; i < parts.length; i++) {
    const currentPart = parts[i].toUpperCase();
    if (currentPart === "INTL" || currentPart === "DOM") {
      indom = currentPart;
      regionIndex = i;
      break;
    }
  }
  const filmTitle = regionIndex > 0 ? parts.slice(0, regionIndex).join("_") : "";

  // 2. Size token, scoped to AFTER the region so a digit run in the film
  // title itself can't be mistaken for it.
  let sizeIndex = -1;
  const regSize = /^(\d+x\d+)(?:px)?$/i;
  for (let j = regionIndex + 1; j < parts.length; j++) {
    if (regSize.test(parts[j])) {
      sizeIndex = j;
      break;
    }
  }

  // 3. Campaign & artwork type from the tokens between region and size --
  // handles both "..._DGTL_[Artwork]_[Campaign]_..." (the documented
  // studio convention) AND a non-DGTL "..._[Campaign]_[Artwork]_..."
  // ordering, rather than assuming DGTL is always present.
  let artworkType = "";
  let campaign = "";
  if (regionIndex !== -1 && sizeIndex !== -1) {
    const middleParts = parts.slice(regionIndex + 1, sizeIndex);
    let dgtlIndex = -1;
    let awIndex = -1;
    for (let k = 0; k < middleParts.length; k++) {
      const partUpper = middleParts[k].toUpperCase();
      if (partUpper === "DGTL") {
        dgtlIndex = k;
      } else if (awIndex === -1) {
        for (let n = 0; n < artworkTypes.length; n++) {
          if (partUpper === artworkTypes[n]) {
            awIndex = k;
            artworkType = partUpper;
            break;
          }
        }
      }
    }
    if (dgtlIndex !== -1) {
      const startIndex = awIndex !== -1 && awIndex > dgtlIndex ? awIndex + 1 : dgtlIndex + 1;
      campaign = middleParts.slice(startIndex).join("_");
    } else if (awIndex !== -1) {
      campaign = middleParts.slice(0, awIndex).join("_");
    } else {
      campaign = middleParts.join("_");
    }
  }

  // 4. Duration/territory/version, scoped to AFTER the size token (or
  // after region if no size was found) -- same false-match protection as
  // the size scoping above.
  let duration = "";
  let territory = "";
  let version = "";
  const regDur = /^(\d+)s(?:ec)?$/i;
  const regTer = /^[A-Z]{2}$/i;
  const regVer = /^[Vv](\d+)$/;
  const startIndexForSpecs = sizeIndex !== -1 ? sizeIndex + 1 : regionIndex + 1;
  for (let p = startIndexForSpecs; p < parts.length; p++) {
    const part = parts[p];
    const dMatch = part.match(regDur);
    if (dMatch && !duration) {
      duration = dMatch[1] + "sec";
      continue;
    }
    const tMatch = part.match(regTer);
    if (tMatch && !territory) {
      territory = tMatch[0].toUpperCase();
      continue;
    }
    const vMatch = part.match(regVer);
    if (vMatch && !version) {
      const vNum = parseInt(vMatch[1], 10);
      version = "V" + (vNum < 10 ? "0" + vNum : String(vNum));
      continue;
    }
  }

  return { success: true, filmTitle, artworkType, campaign, territory, isInternational: indom === "INTL", duration, version };
}

export const nameGeneratorDetect = (): NameDetectResult => {
  const sel = app.project.selection;
  if (sel.length === 0) return { success: false, error: "Please select a composition first." };
  return nameGeneratorParse(sel[0].name);
};

// =============================================================================
// Edit Generator -- ported from XYi_Toolbox.jsx's "Edit Generator" tab
// (EdGen()/gate(), backed by XYi_EdGen.jsx's EditGen()/EditGenNoFirst()).
// Auto-arranges the currently SELECTED layers into a cutdown of a given
// duration, with optional opacity fade and scale growth.
//
// **Bug fix vs. the original**: `XYi_EdGen.jsx` set `var excl =
// checkbox3.text` (the checkbox's STRING LABEL, not the checkbox object)
// and then checked `excl.value` -- always `undefined` on a string, so the
// "Exclude First Image / Sequence" checkbox never actually did anything;
// `gate()` always ran the plain `EditGen()` path. Fixed here to take
// `excludeFirst` as its own real boolean parameter, same class of fix as
// Rename Main Comp's regex mismatch earlier this session.
// =============================================================================
export const editGeneratorArrange = (duration: number, useFade: boolean, fadeDuration: number, useScale: boolean, scalePercent: number, excludeFirst: boolean): Result => {
  try {
    const comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
    const selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return { success: false, error: "Please select layers first." };

    app.beginUndoGroup("XYi Edit Generator");
    const frameRate = comp.frameRate;
    const percentageCalc = Math.floor(scalePercent) / 100;

    for (let i = 0; i < selectedLayers.length; i++) selectedLayers[i].startTime = 0;

    if (!excludeFirst) {
      for (let i = 0; i < selectedLayers.length; i++) {
        const layer = selectedLayers[i];
        const selectScale = layer.property("Scale") as Property;
        const startPoint = layer.inPoint;
        const spec = (duration / selectedLayers.length) * i;
        const specB = (duration / selectedLayers.length) * (i + 1);
        const scaleA = (selectScale.value as number[])[0];

        if (useFade) {
          (layer.property("Opacity") as Property).setValueAtTime(startPoint, 0);
          (layer.property("Opacity") as Property).setValueAtTime(startPoint + Math.ceil(fadeDuration), 100);
        }
        layer.startTime = Math.floor((spec - startPoint) * frameRate) / frameRate;
        layer.outPoint = Math.floor((startPoint + (specB - startPoint)) * frameRate) / frameRate;
        if (useFade) layer.outPoint = specB + Math.ceil(fadeDuration);
        if (useScale) {
          selectScale.setValueAtTime(layer.inPoint, [scaleA, scaleA, scaleA]);
          selectScale.setValueAtTime(layer.outPoint, [scaleA + scaleA * percentageCalc, scaleA + scaleA * percentageCalc, scaleA + scaleA * percentageCalc]);
        }
      }
    } else {
      const fade = 1 * fadeDuration;
      const newLength = (duration - fade * (selectedLayers.length - 1)) / selectedLayers.length;
      for (let i = 0; i < selectedLayers.length; i++) {
        const layer = selectedLayers[i];
        const selectScale = layer.property("Scale") as Property;
        const startPoint = layer.inPoint;
        const spec = (newLength + fade) * i - fade;
        const specB = (newLength + fade) * (i + 1) - fade;
        const scaleA = (selectScale.value as number[])[0];

        if (useFade && i > 0) {
          (layer.property("Opacity") as Property).setValueAtTime(Math.floor(startPoint * frameRate) / frameRate, 0);
          (layer.property("Opacity") as Property).setValueAtTime(Math.floor((startPoint + fade) * frameRate) / frameRate, 100);
        }
        layer.startTime = Math.floor((spec - startPoint) * frameRate) / frameRate;
        if (layer.startTime < 0) layer.startTime = 0;
        layer.outPoint = Math.floor((startPoint + (specB - startPoint)) * frameRate) / frameRate;
        if (useFade) layer.outPoint = specB + fade;
        if (useScale) {
          selectScale.setValueAtTime(layer.inPoint, [scaleA, scaleA, scaleA]);
          selectScale.setValueAtTime(layer.outPoint, [scaleA + scaleA * percentageCalc, scaleA + scaleA * percentageCalc, scaleA + scaleA * percentageCalc]);
        }
      }
    }
    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Generate Cue Sheet -- ported from XYi_Toolbox.jsx's "Generate Cue Sheet"
// tab (CueSheeter()/CueSheetGen(), backed by XYi_Cue.jsx). Writes a
// comma-separated cue sheet (layer name + optional duration/footage-in-out/
// comp-in-out columns) to a .txt file on the Desktop, named after the
// active comp. **Also removes duplicate layers from the active comp as a
// side effect** -- this is the original's actual behavior (it identifies
// "duplicate" layers by an identical name+in/out-point signature and
// deletes all but the first), not something added in porting; the tool
// page should make this destructive side effect visible to the user.
// =============================================================================
interface CueSheetResult extends Result {
  filePath?: string;
}

export const generateCueSheet = (includeDuration: boolean, includeFootageInOut: boolean, includeCompInOut: boolean): CueSheetResult => {
  try {
    const activeItem = app.project.activeItem;
    if (!activeItem || !(activeItem instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };

    app.beginUndoGroup("XYi Generate Cue Sheet");
    const fpsComp = activeItem.frameRate;

    // Remove duplicate layers (identical name + footage-in/comp-out/comp-in signature).
    for (let x = 1; x <= activeItem.numLayers; x++) {
      const rIn = activeItem.layer(x).inPoint;
      const rOut = activeItem.layer(x).outPoint;
      const timeStart = timeToCurrentFormat(rIn, fpsComp);
      const timeEnd = timeToCurrentFormat(rOut, fpsComp);
      const footStart = timeToCurrentFormat(rIn - activeItem.layer(x).startTime, fpsComp);
      const xSig = activeItem.layer(x).name + "_" + footStart + "_" + timeEnd + "_" + timeStart;

      for (let i = 1; i <= activeItem.numLayers; i++) {
        const iIn = activeItem.layer(i).inPoint;
        const iOut = activeItem.layer(i).outPoint;
        const iTimeStart = timeToCurrentFormat(iIn, fpsComp);
        const iTimeEnd = timeToCurrentFormat(iOut, fpsComp);
        const iFootStart = timeToCurrentFormat(iIn - activeItem.layer(i).startTime, fpsComp);
        const iSig = activeItem.layer(i).name + "_" + iFootStart + "_" + iTimeEnd + "_" + iTimeStart;
        if (xSig === iSig && i !== x) activeItem.layer(i).remove();
      }
    }

    const myFileName = "Cue_Sheet_" + activeItem.name + ".txt";
    const myFilePath = "~/desktop/" + escape(myFileName);
    const myFile = new File(myFilePath);
    myFile.open("w");
    myFile.writeln("Cue Sheet for " + activeItem.name);
    myFile.writeln("");

    myFile.write("Track Name");
    if (includeDuration) myFile.write(", Duration");
    if (includeFootageInOut) myFile.write(", Footage In , Footage Out");
    if (includeCompInOut) myFile.write(", Comp In , Comp Out ");
    myFile.writeln("");

    for (let x = 1; x <= activeItem.numLayers; x++) {
      const layer = activeItem.layer(x);
      const rIn = layer.inPoint;
      const rOut = layer.outPoint;
      const timeStart = timeToCurrentFormat(rIn, fpsComp);
      const timeEnd = timeToCurrentFormat(rOut, fpsComp);
      const footStart = timeToCurrentFormat(rIn - layer.startTime, fpsComp);
      const footEnd = timeToCurrentFormat(rOut - layer.startTime, fpsComp);
      const durInOut = timeToCurrentFormat(rOut - rIn, fpsComp);

      myFile.write((layer as AVLayer).source ? (layer as AVLayer).source.name : layer.name);
      if (includeDuration) myFile.write(" , " + durInOut);
      if (includeFootageInOut) myFile.write(" , " + footStart + " , " + footEnd);
      if (includeCompInOut) myFile.write(" , " + timeStart + " , " + timeEnd);
      myFile.writeln("");
    }
    myFile.close();
    app.endUndoGroup();
    return { success: true, filePath: myFile.fsName };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// Check -- ported from XYi_Toolbox.jsx's "Check" tab, a QC grab-bag.
// Aspect Ratio Rename, Effects Used, Comp / Footage Details, File Name
// Check, and Marker Comment Guide are all real. Render Check
// (RenderChecker(), XYi_Render_Check.jsx) is real too -- imports MOVs and
// matching images from two chosen folders into new comps, never touches
// an existing project file.
// =============================================================================
interface CheckMessageResult extends Result {
  message?: string;
}

// Ported from XYi_EffCheck.jsx -- read-only report, no undo group needed.
export const checkEffectsUsed = (): CheckMessageResult => {
  const comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) return { success: false, error: "Please select or open a composition first." };
  const selectedLayers = comp.selectedLayers;
  if (selectedLayers.length === 0) return { success: false, error: "Please select one or more layers." };

  let message = "";
  for (let i = 0; i < selectedLayers.length; i++) {
    message += selectedLayers[i].index + ". " + selectedLayers[i].name + "\n";
    const effects = selectedLayers[i].property("Effects") as Property;
    for (let j = 0; j < effects.numProperties; j++) {
      message += (effects.property(j + 1) as Property).name + "\n";
    }
    message += "\n";
  }
  return { success: true, message: message.trim() };
};

// Ported from XYi_Aspect_Rename.jsx -- adds or strips a "_<ratio>_" prefix
// on every file in a chosen folder whose name contains a WIDTHxHEIGHT
// token. Renames files on disk (not project items) -- prompts its own
// folder picker rather than taking a path param, matching the original's
// single-button flow.
interface AspectRenameResult extends Result {
  added?: boolean;
  removed?: boolean;
}

export const checkAspectRatioRename = (): AspectRenameResult => {
  const folder = Folder.selectDialog("Select a folder to scan");
  if (!folder) return { success: false, error: "No folder selected." };

  const files = folder.getFiles();
  const pattern = /(\d+)x(\d+)/;
  const ratioPattern = /^_(\d+\.\d+)_/;
  let added = false;
  let removed = false;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!(file instanceof File)) continue;
    const fileName = file.name;
    const ratioMatch = fileName.match(ratioPattern);
    const resolutionMatch = fileName.match(pattern);

    if (ratioMatch && resolutionMatch) {
      file.rename(fileName.replace(ratioPattern, ""));
      removed = true;
    } else if (resolutionMatch) {
      const width = parseInt(resolutionMatch[1], 10);
      const height = parseInt(resolutionMatch[2], 10);
      const ratio = width / height;
      file.rename("_" + ratio.toFixed(2) + "_" + fileName);
      added = true;
    }
  }
  return { success: true, added, removed };
};

// Ported from XYi_CompCheck.jsx -- read-only report on every selected
// project item, no undo group needed.
export const checkCompFootageDetails = (): CheckMessageResult => {
  const sel = app.project.selection;
  if (sel.length === 0) return { success: false, error: "Please select compositions first." };

  let message = "";
  for (let i = 0; i < sel.length; i++) {
    const item = sel[i] as CompItem;
    const format = item.width > item.height ? "Landscape" : item.width < item.height ? "Portrait" : "Square";
    message +=
      "Comp name: " + item.name + "\n" +
      "Width: " + item.width + "  Height: " + item.height + "\n" +
      "Duration: " + item.duration + "  FPS: " + item.frameRate + "\n" +
      "Format: " + format + "\n\n";
  }
  return { success: true, message: message.trim() };
};

// Ported from XYi_Cheeky_N_Check.jsx's usage in FilNameChe() -- reuses the
// SAME nameGeneratorParse() helper Name Generator's "Detect Name" uses,
// just against a browsed file's name instead of a selected project item's.
export const checkFileNameCheck = (): CheckMessageResult => {
  const file = File.openDialog("Select a file", "*.*", false);
  if (!file) return { success: false, error: "No file selected." };
  const parsed = nameGeneratorParse(file.name);
  return {
    success: true,
    message: "Film Title: " + parsed.filmTitle + "\nArtwork: " + parsed.artworkType + "\nCampaign: " + parsed.campaign + "\nTerritory: " + parsed.territory + "\nInternational: " + parsed.isInternational,
  };
};

// Ported from XYi_Markers.jsx -- read-only report, writes every comp/layer
// marker's comment across the whole project to a .txt file on the Desktop.
export const checkMarkerGuide = (): CheckMessageResult => {
  const markerComments: string[] = [];
  for (let i = 1; i <= app.project.items.length; i++) {
    const item = app.project.items[i];
    if (!(item instanceof CompItem)) continue;
    for (let j = 1; j <= item.numLayers; j++) {
      const layer = item.layer(j);
      const markerProp = layer.property("Marker") as Property;
      if (markerProp && markerProp.numKeys > 0) {
        for (let k = 1; k <= markerProp.numKeys; k++) {
          const marker = markerProp.keyValue(k) as MarkerValue;
          markerComments.push("Comp: " + item.name + "\nLayer " + j + " Marker " + k + ":\n" + marker.comment + "\n\n");
        }
      }
    }
    if (item.markerProperty.numKeys > 0) {
      for (let m = 1; m <= item.markerProperty.numKeys; m++) {
        const compMarker = item.markerProperty.keyValue(m) as MarkerValue;
        markerComments.push("Comp: " + item.name + " | Composition Marker " + m + ":\n" + compMarker.comment + "\n\n");
      }
    }
  }
  const file = new File("~/Desktop/marker_comments.txt");
  file.open("w");
  file.write(markerComments.join("\n"));
  file.close();
  return { success: true, message: "Marker comments written to " + file.fsName };
};

// Ported from XYi_Render_Check.jsx's RenderChecker(). Imports every .mov in
// a chosen folder, wraps each in its own comp, adds three named markers at
// the given timecodes, then (if a second folder is chosen) imports
// matching PDF/JPEG/PNG files from it and layers them into comps whose
// name shares a WIDTHxHEIGHT token with the image. Only ever imports into
// the CURRENT project -- no existing project file is opened.
export const checkRenderCheck = (marker7: string, marker8: string, marker9: string): Result => {
  try {
    const movFolder = Folder.selectDialog("Select a folder with MOV files");
    if (!movFolder) return { success: false, error: "No folder selected." };

    app.beginUndoGroup("XYi Render Check");
    const movFiles = movFolder.getFiles("*.mov") as File[];
    const importedMOVs: AVItem[] = [];
    for (let i = 0; i < movFiles.length; i++) {
      const importOptions = new ImportOptions(movFiles[i]);
      if (importOptions.canImportAs(ImportAsType.FOOTAGE)) {
        importedMOVs.push(app.project.importFile(importOptions) as AVItem);
      }
    }

    const comps: CompItem[] = [];
    let compFrameRate = 30;
    for (let j = 0; j < importedMOVs.length; j++) {
      const mov = importedMOVs[j];
      compFrameRate = mov.frameRate;
      const comp = app.project.items.addComp(mov.name, mov.width, mov.height, 1, mov.duration, mov.frameRate);
      comp.layers.add(mov);
      comps.push(comp);
    }

    if (comps.length > 0) {
      const t1 = marker7.split(":");
      const t2 = marker8.split(":");
      const t3 = marker9.split(":");
      const marker7Time = parseInt(t1[2], 10) + parseInt(t1[3], 10) / compFrameRate;
      const marker8Time = parseInt(t2[2], 10) + parseInt(t2[3], 10) / compFrameRate;
      const marker9Time = parseInt(t3[2], 10) + parseInt(t3[3], 10) / compFrameRate;
      const markers = [
        { name: "7", time: marker7Time },
        { name: "8", time: marker8Time },
        { name: "9", time: marker9Time },
      ];
      for (let k = 0; k < comps.length; k++) {
        for (let m = 0; m < markers.length; m++) {
          comps[k].markerProperty.setValueAtTime(markers[m].time, new MarkerValue(markers[m].name));
        }
      }
    }

    const imageFolder = Folder.selectDialog("Select a folder with PDF, JPEG, and PNG files");
    if (imageFolder) {
      function getAllFiles(folder: Folder): File[] {
        let fileArray: File[] = [];
        const files = folder.getFiles();
        for (let i = 0; i < files.length; i++) {
          if (files[i] instanceof Folder) fileArray = fileArray.concat(getAllFiles(files[i] as Folder));
          else if (files[i] instanceof File && /\.(pdf|jpe?g|png)$/i.test(files[i].name)) fileArray.push(files[i] as File);
        }
        return fileArray;
      }
      const imageFiles = getAllFiles(imageFolder);
      const importedImages: AVItem[] = [];
      for (let l = 0; l < imageFiles.length; l++) {
        const importOptions = new ImportOptions(imageFiles[l]);
        if (importOptions.canImportAs(ImportAsType.FOOTAGE)) {
          importedImages.push(app.project.importFile(importOptions) as AVItem);
        }
      }

      const regex = /(\d+)x(\d+)/;
      function extractDimensions(name: string): string | null {
        const match = name.match(regex);
        return match ? match[0] : null;
      }

      for (let n = 0; n < comps.length; n++) {
        const comp = comps[n];
        const movDimensions = extractDimensions(comp.name);
        if (!movDimensions) continue;
        for (let p = 0; p < importedImages.length; p++) {
          if (movDimensions === extractDimensions(importedImages[p].name)) {
            const imageLayer = comp.layers.add(importedImages[p]);
            imageLayer.startTime = 0;
          }
        }
      }
    }

    app.endUndoGroup();
    return { success: true };
  } catch (e) {
    app.endUndoGroup();
    return { success: false, error: e.toString() };
  }
};

// =============================================================================
// CSV Localiser -- ported from toolset/XYi_Campaign_CSV.jsx's campLocCSV(),
// wired to the "CSV Localiser" tab's "Run CSV Localiser" button. Takes
// pasted CSV text (a [METADATA]/[/METADATA] block with Territory:/Batch:/
// Source Folder: lines, then Artwork/Campaign/Size/Duration rows), scans an
// AEP source path for the best-matching master per row via the SAME
// scanMastersForBestMatch() Campaign Localiser uses, then generates a
// localised comp per row.
//
// **This one was ALREADY copy-first in the original** -- unlike Campaign
// Localiser (a confirmed, deliberate exception that opens the matched
// master directly), XYi_Campaign_CSV.jsx copies the master to the
// destination filename FIRST and only ever opens that copy
// (`masterFile.copy(workingCopy.fsName)` then `app.open(workingCopy)`).
// No safety patch was needed here; this is actually the reference
// copy-first pattern this whole project's core safety constraint is
// modeled on. Ported with the same alert()-per-row-failure /
// alert()-on-final-count behavior as LOS Tools, for the same reason: the
// user asked for exact fidelity on tools like this, not the rest of this
// port's usual {success,error}-return convention.
// =============================================================================
const CSV_LOC_SETTINGS_SECTION = "XYiToolbox";
const CSV_LOC_LAST_PATH_KEY = "CSVLocLastPath";

export const csvLocaliserLoadLastPath = (): string | null => {
  if (app.settings.haveSetting(CSV_LOC_SETTINGS_SECTION, CSV_LOC_LAST_PATH_KEY)) {
    return app.settings.getSetting(CSV_LOC_SETTINGS_SECTION, CSV_LOC_LAST_PATH_KEY);
  }
  return null;
};

// Exact prompt text from the tab's own Browse button (CSVLocBrowseBut) --
// deliberately not reusing selectMastersFolder()'s differently-worded
// prompt from OV Library.
export const selectCsvLocaliserAepFolder = (): string | null => {
  const folder = Folder.selectDialog("Select the AEP source folder:");
  return folder ? folder.fsName : null;
};

function csvLocSaveLastPath(path: string): void {
  if (path !== "") app.settings.saveSetting(CSV_LOC_SETTINGS_SECTION, CSV_LOC_LAST_PATH_KEY, path);
}

function csvLocTrim(str: string): string {
  return String(str).replace(/^\s+|\s+$/g, "");
}

// Ported 1:1 from campLocCSV()'s nameGen() -- duplicates the matched master
// comp, rescales it via the same null-parent technique as DRQR/Scale
// Composition, propagates the new size into every V## comp under "Main",
// runs Cheeky DT Check + DRQR automatically on the new comp, removes the
// original pre-localise master comp, then saves the (already-a-copy)
// project in place and closes it.
function csvLocNameGen(myComp: CompItem, width: number, height: number, newCompName: string, plm: "PORTRAIT" | "LANDSCAPE"): void {
  const scanRegV = /V\d\d/;
  const myName = myComp.name;
  const oldWidth = myComp.width;
  const oldHeight = myComp.height;
  const newComp = myComp.duplicate();
  newComp.name = newCompName;

  const newRatio = width / height;
  const oldRatio = oldWidth / oldHeight;
  const scaleFactor = newRatio > oldRatio ? width / oldWidth : height / oldHeight;

  const null3DLayer = newComp.layers.addNull();
  null3DLayer.threeDLayer = true;
  null3DLayer.position.setValue([0, 0, 0]);
  makeParentLayerOfAllUnparented(newComp, null3DLayer);

  newComp.width = Math.floor(width);
  newComp.height = Math.floor(height);
  scaleAllCameraZooms(newComp, scaleFactor);

  const superParentScale = null3DLayer.scale.value as number[];
  const superParentPosition = null3DLayer.position.value as number[];
  superParentScale[0] *= scaleFactor;
  superParentScale[1] *= scaleFactor;
  superParentScale[2] *= scaleFactor;
  null3DLayer.scale.setValue(superParentScale);

  if (newRatio > oldRatio) {
    const posHeight = (width / oldWidth) * oldHeight;
    superParentPosition[1] = -0.5 * (posHeight - height);
  } else {
    const posWidth = (height / oldHeight) * oldWidth;
    superParentPosition[0] = -0.5 * (posWidth - width);
  }
  null3DLayer.position.setValue(superParentPosition);
  null3DLayer.remove();

  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof CompItem && item.parentFolder && item.parentFolder.name === "Main" && scanRegV.test(item.name)) {
      item.width = width;
      item.height = height;
      for (let j = 1; j <= item.numLayers; j++) {
        const layer = item.layer(j) as AVLayer;
        if (layer.name === myComp.name) {
          layer.replaceSource(newComp, false);
        } else if (plm === "PORTRAIT") {
          layer.scale.setValue([(100 / 1920) * height, (100 / 1920) * height]);
        } else if (plm === "LANDSCAPE") {
          layer.scale.setValue([(100 / 1080) * height, (100 / 1080) * height]);
        }
        layer.position.setValue([width / 2, height / 2]);
      }
    }
  }

  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof CompItem && item.parentFolder && item.parentFolder.name === "Main" && scanRegV.test(item.name)) {
      item.name = String(newComp.name) + "_V01";
    }
  }

  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof CompItem && item.parentFolder && item.parentFolder.name === "Main" && scanRegV.test(item.name + "_V01")) {
      item.openInViewer();
      cheekyDTCheck(false, true, true, false, false, true, true);
      if (item.name === newCompName + "_V01") {
        app.project.showWindow(true);
        drqr();
      }
    }
  }

  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof CompItem && item.parentFolder && item.parentFolder.name === "Main" && item.name === myName) {
      item.remove();
    }
  }

  // The project was opened from a working copy already sitting at the
  // correct destination filename (copied from the master before opening),
  // so just save in place -- matches original exactly.
  app.project.save();
  app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  app.newProject();
}

export const csvLocaliserRun = (mastersPath: string, rawCsvText: string, skipExisting: boolean): Result => {
  csvLocSaveLastPath(mastersPath);

  if (rawCsvText === "") {
    alert("Please paste the CSV data first.");
    return { success: false, error: "No CSV data pasted." };
  }

  let territory = "";
  let batchName = "";
  let sourceFolder = "";
  const lines = rawCsvText.split(/\r\n|\n|\r/);

  for (let m = 0; m < lines.length; m++) {
    const metaLine = csvLocTrim(lines[m]);
    const tLineMatch = metaLine.match(/^Territory:\s*(.*)$/i);
    if (tLineMatch) {
      territory = csvLocTrim(tLineMatch[1]);
      continue;
    }
    const bLineMatch = metaLine.match(/^Batch:\s*(.*)$/i);
    if (bLineMatch) {
      batchName = csvLocTrim(bLineMatch[1]);
      continue;
    }
    const fLineMatch = metaLine.match(/^Source Folder:\s*(.*)$/i);
    if (fLineMatch) {
      sourceFolder = csvLocTrim(fLineMatch[1]);
      continue;
    }
  }

  // Resolve the output folder automatically: <Source Folder>/AE/<Batch Name>,
  // creating either level if it doesn't exist yet. Only falls back to a
  // manual picker if that folder is missing or wasn't in the CSV metadata.
  let outputFolder: Folder;
  if (sourceFolder !== "") {
    const sourceFolderObj = new Folder(sourceFolder);
    if (!sourceFolderObj.exists) {
      alert("The Source Folder from the CSV couldn't be found on disk:\n" + sourceFolder + "\n\nPlease select the output folder manually.");
      const picked = Folder.selectDialog("Please select a folder to save the Output Files:");
      if (!picked) return { success: false, error: "No output folder selected." };
      outputFolder = picked;
    } else {
      const aeFolder = new Folder(sourceFolderObj.fsName + "/AE");
      if (!aeFolder.exists) aeFolder.create();
      if (batchName !== "") {
        outputFolder = new Folder(aeFolder.fsName + "/" + batchName);
        if (!outputFolder.exists) outputFolder.create();
      } else {
        outputFolder = aeFolder;
      }
    }
  } else {
    alert("No Source Folder was found in the CSV metadata. Please select the output folder manually.");
    const picked = Folder.selectDialog("Please select a folder to save the Output Files:");
    if (!picked) return { success: false, error: "No output folder selected." };
    outputFolder = picked;
  }

  // Convert the territory name into its country code prefix (e.g. "Spain"
  // -> "ES") -- reuses the already-ported getTerritoryCountryCode() rather
  // than duplicating XYi_Cheeky_InvT_Check.jsx's getCountryCode() a second
  // time (same table, same lookup direction).
  let territoryCode = "XX";
  if (territory !== "") {
    territoryCode = getTerritoryCountryCode(territory) || "XX";
  }

  let rowsAttempted = 0;
  let isMetadata = false;
  const regex = /\d*[x]\d*/;

  for (let l = 0; l < lines.length; l++) {
    const currentLine = csvLocTrim(lines[l]);
    if (currentLine === "") continue;
    if (currentLine.indexOf("[METADATA]") !== -1) {
      isMetadata = true;
      continue;
    }
    if (currentLine.indexOf("[/METADATA]") !== -1) {
      isMetadata = false;
      continue;
    }
    if (isMetadata) continue;
    if (currentLine.match(/^"?Artwork/i)) continue;

    rowsAttempted++;

    try {
      const cleanLine = currentLine.replace(/"/g, "");
      const texLoc = cleanLine.split(",");
      if (texLoc.length < 4) continue;

      const sizeArr = csvLocTrim(texLoc[2]).split("x");
      const campaign = csvLocTrim(texLoc[1]).toUpperCase();
      const width = Math.floor(Number(sizeArr[0]));
      const height = Math.floor(Number(sizeArr[1]));
      const size = String(width) + "x" + String(height);
      const duration = csvLocTrim(texLoc[3]) + "sec";

      const bestMatch = scanMastersForBestMatch(mastersPath, campaign, size, duration);
      if (!bestMatch) continue;
      const textMaster = bestMatch.fsName;

      const linesMaster = textMaster.split("/");
      let masterName = linesMaster[linesMaster.length - 1];
      const ratioPattern = /^_(\d+\.\d+)_/;
      if (ratioPattern.test(masterName)) {
        masterName = masterName.split(ratioPattern)[2];
      }

      const masterSizeMatch = String(masterName.match(regex));
      const masterSizeParts = masterSizeMatch.split("x");
      const masterWidth = Math.floor(Number(masterSizeParts[0]));
      const masterHeight = Math.floor(Number(masterSizeParts[1]));
      const plm: "PORTRAIT" | "LANDSCAPE" = masterWidth < masterHeight ? "PORTRAIT" : "LANDSCAPE";

      const scanFilmTitle = masterName.split("_")[0];
      const scanIndo = masterName.split("_")[1];
      const scanArtworkType = csvLocTrim(texLoc[0]);
      const batchStr = batchName !== "" ? "_" + batchName : "";

      const newCompName = scanFilmTitle + "_" + scanIndo + "_DGTL_" + scanArtworkType + "_" + campaign + "_" + width + "x" + height + "_" + duration + batchStr + "_" + territoryCode;

      const outputFile = new File(outputFolder.toString() + "/" + newCompName + "_V01.aep");
      if (skipExisting && outputFile.exists) {
        alert(newCompName + ".aep already exists. Skipping.");
        continue;
      }

      // Copy the master .aep to the destination first, then open the COPY.
      // The original master file is never opened, so it stays untouched.
      const masterFile = new File(textMaster);
      const workingCopy = new File(outputFolder.toString() + "/" + newCompName + "_V01.aep");
      if (!masterFile.copy(workingCopy.fsName)) {
        throw new Error("Could not copy master file to destination: " + workingCopy.fsName);
      }

      const proj = app.open(workingCopy);

      let myComp: CompItem = proj.activeItem as CompItem;
      const masterStem = String(masterName.split(".")[0]).replace(/_V\d+$/, "");
      for (let i = 1; i <= proj.numItems; i++) {
        const item = proj.item(i);
        if (item instanceof CompItem && item.name === masterStem) {
          myComp = item;
        }
      }

      csvLocNameGen(myComp, width, height, newCompName, plm);
    } catch (err) {
      alert("Row " + rowsAttempted + " failed: " + err.toString());
    }
  }

  alert("CSV Import Complete! Rows attempted: " + rowsAttempted);
  return { success: true };
};