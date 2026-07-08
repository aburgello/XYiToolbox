// =============================================================================
// src/jsx/aeft/aeft.ts
// -----------------------------------------------------------------------------
// ExtendScript backend for the XYi Toolbox CEP panel. One section per ported
// tool, each ported 1:1 from its original standalone XYi_*.jsx in toolset/.
// Every function here is called from a tool's React view via
// evalTS("functionName", ...args).
//
// READ-ONLY / IMPORT-ONLY BY DESIGN where a tool touches a master .aep --
// see CLAUDE.md's "Non-negotiable safety constraint":
//   - Scanning only ever lists folder contents (Folder.getFiles()). Nothing
//     is opened or written during a scan.
//   - Masters are brought in via app.project.importFile(), which only reads
//     the source file -- there is no app.open() anywhere for a master, and
//     deliberately no "open" action is exported for one.
//   - Renders can be played via the OS's default video player (read-only)
//     or imported as footage the same read-only way.
//
// Every function that can fail across the CEP bridge returns a defensive
// {success, error} shape rather than throwing, per CLAUDE.md's ExtendScript
// style convention.
//
// -----------------------------------------------------------------------------
// This file is a THIN BARREL ONLY -- the functions themselves live in the
// per-category sibling files below, split out for maintainability. Nothing
// here should ever contain real logic -- add new functions to the relevant
// category file (shared/shell/localise/review/deliver/tools), not here.
// index.ts's `import * as aeft from "./aeft/aeft"` keeps working unchanged
// since re-exporting via `export *` still populates the same namespace.
// =============================================================================
export * from "./shared";
export * from "./shell";
export * from "./localise";
export * from "./review";
export * from "./deliver";
export * from "./tools";
export * from "./motionTools";
