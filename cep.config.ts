import type { CEP_Config } from "vite-cep-plugin";
import { version } from "./package.json";

const config: CEP_Config = {
  version,
  // Renamed from "com.xyi.ovlibrary" -- OV Library is one tool inside the
  // toolbox, not the product. A changed id registers as a *new* extension, so
  // the old com.xyi.ovlibrary folder must be removed or AE lists two identical
  // "XYi Toolbox" entries under Window > Extensions.
  id: "com.xyi.toolbox",
  displayName: "XYi Toolbox",
  symlink: "local",
  port: 3000,
  servePort: 5000,
  startingDebugPort: 8860,
  extensionManifestVersion: 6.0,
  requiredRuntimeVersion: 9.0,
  hosts: [
    { name: "AEFT", version: "[0.0,99.9]" }, 
  ],

  type: "Panel",
  iconDarkNormal: "./src/assets/light-icon.png",
  iconNormal: "./src/assets/dark-icon.png",
  iconDarkNormalRollOver: "./src/assets/light-icon.png",
  iconNormalRollOver: "./src/assets/dark-icon.png",
  parameters: ["--v=0", "--enable-nodejs", "--mixed-context"],
  width: 700,
  height: 700,

  panels: [
    {
      mainPath: "./main/index.html",
      name: "main",
      panelDisplayName: "XYi Toolbox",
      autoVisible: true,
      width: 700,
      height: 700,
    },
  ],
  build: {
    jsxBin: "off",
    sourceMap: true,
  },
  zxp: {
    country: "GB",
    province: "London",
    // No space -- vite-cep-plugin's zxp.js builds the ZXPSignCmd invocation
    // as a raw shell string (`${data.org}` unquoted), so "XYi Design" gets
    // split into two separate positional args by the shell, which shifts
    // every argument after it and makes ZXPSignCmd reject the whole command
    // with a usage error. This is metadata on the self-signed cert only --
    // it's never shown to users during install, so dropping the space here
    // doesn't change how the extension appears anywhere (displayName/
    // panelDisplayName above are still "XYi Toolbox").
    org: "XYiDesign",
    password: "password",
    tsa: [
      "http://timestamp.digicert.com/", // Windows Only
      "http://timestamp.apple.com/ts01", // MacOS Only
    ],
    allowSkipTSA: false,
    sourceMap: false,
    jsxBin: "off",
  },
  installModules: [],
  // The arcade's pixel typeface is embedded as base64 inside the bundled CSS
  // (src/js/main/arcade/arcadeFont.scss), so nothing here is needed at RUNTIME
  // -- this ships the licence, which is a requirement, not housekeeping. The
  // face is a subset of Press Start 2P under the SIL Open Font License 1.1,
  // and the OFL requires its text to accompany every distribution of the font,
  // including inside a signed ZXP. Removing this line makes the ZXP
  // non-compliant even though the panel still works.
  // Paths are relative to `src/` (the plugin joins them onto it), NOT to the
  // repo root -- a root-relative path here silently copies nothing.
  copyAssets: ["js/main/arcade/font"],
  copyZipAssets: [],
};
export default config;
