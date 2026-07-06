import type { CEP_Config } from "vite-cep-plugin";
import { version } from "./package.json";

const config: CEP_Config = {
  version,
  id: "com.xyi.ovlibrary", // kept as-is so the existing registered extension just updates in place
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
  copyAssets: [],
  copyZipAssets: [],
};
export default config;
