// =============================================================================
// scripts/ui-harness.mjs
// -----------------------------------------------------------------------------
// Drives the BROWSER build (dist/web) in a throwaway headless Chrome, with a
// FAKE CEP bridge standing in for After Effects. Nothing here touches AE, the
// installed panel, or the user's Chrome profile.
//
// The fake bridge is the point. With no `window.__adobe_cep__` the web build
// runs in demo mode and every data tool falls back to its own mock -- which is
// not the code path a real panel runs. Installing a stub `__adobe_cep__`
// makes `evalTS` go through `csi.evalScript` exactly as it does in AE; the
// stub reads the function name and JSON args out of the script and answers
// from the fixture table the test supplies.
// =============================================================================
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serve dist/web on a free port. */
function serve(root) {
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".woff2": "font/woff2" };
    const server = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split("?")[0]);
        if (p === "/") p = "/index.html";
        const f = path.join(root, p);
        if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
        fs.createReadStream(f).pipe(res);
    });
    return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, port: server.address().port })));
}

/** The stub bridge, as page source. `fixtures` is a JS object literal source
 *  mapping function name -> (args) => value; unknown names answer undefined,
 *  which every caller already treats as "no answer". Calls are logged on
 *  window.__calls so a test can assert what the page asked for. */
function bridgeSource(fixturesSrc) {
    return `
(() => {
  const F = ${fixturesSrc};
  window.__calls = [];
  const env = JSON.stringify({ appName: "AEFT", appVersion: "26.2", appLocale: "en_US", appUILocale: "en_US", appId: "AEFT", isAppOnline: true,
    appSkinInfo: { baseFontFamily: "sans-serif", baseFontSize: 12, appBarBackgroundColor: { color: { red: 35, green: 35, blue: 35, alpha: 255 } },
      panelBackgroundColor: { color: { red: 35, green: 35, blue: 35, alpha: 255 } }, appBarBackgroundColorSRGB: { color: { red: 35, green: 35, blue: 35, alpha: 255 } },
      panelBackgroundColorSRGB: { color: { red: 35, green: 35, blue: 35, alpha: 255 } }, systemHighlightColor: { red: 0, green: 120, blue: 215, alpha: 255 } } });
  const base = {
    evalScript(script, cb) {
      const m = /host\\["[^"]+"\\]\\.(\\w+)\\(([\\s\\S]*?)\\);\\s*JSON\\.stringify\\(res\\)/.exec(String(script));
      let out = "undefined";
      if (m) {
        let args = [];
        try { args = JSON.parse("[" + m[2] + "]"); } catch (e) {}
        window.__calls.push({ fn: m[1], args });
        if (Object.prototype.hasOwnProperty.call(F, m[1])) {
          try { const v = F[m[1]](...args); out = v === undefined ? "undefined" : JSON.stringify(v); } catch (e) { out = "undefined"; }
        }
      }
      // __bridgeDelay: a test can make AE slow to answer, to see what a page
      // shows while it waits.
      if (cb) setTimeout(() => cb(out), window.__bridgeDelay || 5);
    },
    getHostEnvironment: () => env,
    getCurrentApiVersion: () => JSON.stringify({ major: 11, minor: 0, micro: 0 }),
    getSystemPath: () => "/tmp",
    getExtensionId: () => "com.xyi.toolbox",
    getOSInformation: () => "Mac OS 14",
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    // Recorded, so a test can see which keys the panel claims from AE.
    registerKeyEventsInterest(k) { (window.__keyClaims = window.__keyClaims || []).push(String(k)); }, requestOpenExtension() {}, closeExtension() {},
    getScaleFactor: () => 1, getNetworkPreferences: () => "{}", invokeSync: () => "", invokeAsync() {},
  };
  window.__adobe_cep__ = new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => "") });
  // CEP's Node layer, shimmed. src/js/lib/cep/node.ts only require()s the real
  // modules when window.cep exists at load, and CSV Localiser gates its scan on
  // it -- so without this the panel builds paths with an empty object and every
  // path.join throws. A real POSIX path; an INERT fs that finds nothing on disk,
  // so no code under test can believe it read or wrote a file.
  const posix = {
    sep: "/", delimiter: ":",
    normalize: (p) => String(p).replace(/[/]+/g, "/"),
    join: (...parts) => parts.filter((x) => x !== "" && x != null).join("/").replace(/[/]+/g, "/"),
    basename: (p, ext) => { const b = String(p).replace(/[/]+$/, "").split("/").pop() || ""; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
    dirname: (p) => { const s = String(p).replace(/[/]+$/, ""); const i = s.lastIndexOf("/"); return i > 0 ? s.slice(0, i) : (i === 0 ? "/" : "."); },
    extname: (p) => { const b = String(p).split("/").pop() || ""; const i = b.lastIndexOf("."); return i > 0 ? b.slice(i) : ""; },
    resolve: (...parts) => posix.join(...parts), isAbsolute: (p) => String(p).startsWith("/"),
    relative: (a, b) => String(b).replace(String(a).replace(/[/]+$/, "") + "/", ""),
    parse: (p) => ({ root: "/", dir: posix.dirname(p), base: posix.basename(p), ext: posix.extname(p), name: posix.basename(p, posix.extname(p)) }),
  };
  posix.posix = posix;
  const EMPTY = { existsSync: false, readdirSync: [], readFileSync: "", constants: {} };
  // One exception, and only when a test asks: readdir answers from
  // window.__fsTree ({ "/dir": [{ name, dir }] }) so a tool that LISTS folders
  // (Size Finder) can be shown a tree. Still nothing real is read.
  const fakeReaddir = (dir, opts, cb) => {
    const tree = window.__fsTree;
    if (!tree) return undefined;
    const list = tree[String(dir).replace(/[/]+$/, "")];
    setTimeout(() => (list ? cb(null, list.map((e) => ({ name: e.name, isDirectory: () => !!e.dir }))) : cb(new Error("ENOENT"))), 0);
  };
  // And, under the same opt-in, a few FILE calls against window.__fsFiles
  // ({ path: text }) so a team-folder cache can be read and written. Folder
  // listings come from __fsTree; __fsDelay (ms) slows listings to watch a
  // background check happen.
  const fileCalls = {
    readFile: (p, enc, cb) => { if (!window.__fsTree) return undefined; const f = window.__fsFiles || {}; setTimeout(() => (p in f ? cb(null, f[p]) : cb(new Error("ENOENT"))), 0); },
    writeFile: (p, body, enc, cb) => { if (!window.__fsTree) return undefined; (window.__fsFiles = window.__fsFiles || {})[p] = String(body); setTimeout(() => cb(null), 0); },
    rename: (a, b, cb) => { if (!window.__fsTree) return undefined; const f = window.__fsFiles || {}; if (a in f) { f[b] = f[a]; delete f[a]; } setTimeout(() => cb(null), 0); },
    mkdir: (p, cb) => { if (!window.__fsTree) return undefined; setTimeout(() => cb(null), 0); },
  };
  const slowReaddir = (dir, opts, cb) => {
    if (!window.__fsTree) return undefined;
    const ms = window.__fsDelay || 0;
    return ms ? setTimeout(() => fakeReaddir(dir, opts, cb), ms) : fakeReaddir(dir, opts, cb);
  };
  const inert = new Proxy({}, { get: (t, k) => (k === "constants" ? {} : k === "readdir" ? slowReaddir : k in fileCalls ? fileCalls[k] : (k in EMPTY ? () => EMPTY[k] : () => undefined)) });
  // child_process: INERT too -- it runs nothing. execFile answers from
  // window.__fakeXattr[path] (hex FinderInfo) when a test sets it, and spawn
  // only records into window.__spawned.
  const cp = {
    execFile: (cmd, args, opts, cb) => {
      const path = args[args.length - 1];
      const hex = (window.__fakeXattr || {})[path];
      setTimeout(() => (hex && args[1] === "com.apple.FinderInfo" ? cb(null, hex) : cb(new Error("no attr"), "")), 0);
    },
    spawn: (cmd, args) => { (window.__spawned = window.__spawned || []).push([cmd].concat(args)); return { unref() {} }; },
  };
  const mods = { path: posix, fs: inert, child_process: cp };
  window.cep = window.cep || { fs: {}, process: {}, encoding: {}, util: {} };
  // Only the Node modules the panel's CEP layer asks for. Anything else must
  // fail like a missing module: bundled libraries probe for \`require\` and
  // answer differently when it resolves, which stripped every className.
  const NODE = ["assert", "buffer", "child_process", "cluster", "crypto", "dgram", "dns", "domain", "events", "http", "https", "net", "os", "punycode", "querystring", "readline", "stream", "string_decoder", "timers", "tls", "tty", "url", "util", "v8", "vm", "zlib"];
  window.require = window.require || ((name) => {
    if (mods[name]) return mods[name];
    if (NODE.indexOf(name) !== -1) return {};
    const e = new Error("Cannot find module '" + name + "'"); e.code = "MODULE_NOT_FOUND"; throw e;
  });
})();`;
}

// `routes`: { "<url substring>": <JSON body> | (url) => <JSON body> } -- requests matching one are
// ANSWERED with that body instead of blocked, so a test can stand in for the
// jobs feed (or any HTTP source) without reaching the real one.
export async function launch({ root, fixturesSrc, width = 760, height = 1100, routes = {} }) {
    const { server, port } = await serve(root);
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), "xyi-ui-"));
    const dbg = 9300 + Math.floor(Math.random() * 500);
    const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${dbg}`, `--user-data-dir=${prof}`, `--window-size=${width},${height}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
    let tabs;
    for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); break; } catch { await sleep(200); } }
    const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pend = {};
    const errors = [];
    const blocked = [];
    const origin = `http://127.0.0.1:${port}/`;
    ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
        if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
        if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
        // HERMETIC: only the local build is reachable. The panel has a default
        // jobs-feed URL baked in, and a test must neither depend on live studio
        // data nor send traffic anywhere -- an unreachable feed falls back to
        // the panel's own sample jobs, which is the state tested here.
        if (d.method === "Fetch.requestPaused") {
            const url = d.params.request.url;
            const hit = Object.keys(routes).find((k) => url.indexOf(k) !== -1);
            if (hit) {
                const headers = [
                    { name: "Content-Type", value: "application/json" },
                    { name: "Access-Control-Allow-Origin", value: "*" },
                    { name: "Access-Control-Allow-Headers", value: "*" },
                ];
                // A route may be a FUNCTION of the URL, so a test can answer a
                // live read (refresh=1) differently from the snapshot.
                const answer = typeof routes[hit] === "function" ? routes[hit](url) : routes[hit];
                const body = Buffer.from(d.params.request.method === "OPTIONS" ? "" : JSON.stringify(answer)).toString("base64");
                send("Fetch.fulfillRequest", { requestId: d.params.requestId, responseCode: 200, responseHeaders: headers, body });
                return;
            }
            const local = url.startsWith(origin);
            if (!local) blocked.push(d.params.request.url);
            send(local ? "Fetch.continueRequest" : "Fetch.failRequest",
                local ? { requestId: d.params.requestId } : { requestId: d.params.requestId, errorReason: "BlockedByClient" });
        }
    };
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: bridgeSource(fixturesSrc) });

    const page = {
        errors,
        blocked,
        async eval(expr) {
            const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
            if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
            return r.result?.result?.value;
        },
        async goto(url) { await send("Page.navigate", { url: url || `http://127.0.0.1:${port}/` }); await sleep(1500); },
        async waitFor(expr, ms = 6000) {
            const t0 = Date.now();
            while (Date.now() - t0 < ms) { try { if (await page.eval(`!!(${expr})`)) return true; } catch {} await sleep(100); }
            return false;
        },
        /** Click the first element matching `selector` whose text contains `text`. */
        async click(selector, text = "") {
            return page.eval(`(() => {
                const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
                    .filter((e) => (e.textContent || "").replace(/\\s+/g, " ").includes(${JSON.stringify(text)}));
                if (!els.length) return false;
                els[0].scrollIntoView({ block: "center" });
                // A real press: mousedown and mouseup around the click, since
                // the panel reads the pressed element (e.g. a dialog's tint).
                els[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
                els[0].dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
                els[0].click();
                return true;
            })()`);
        },
        async resize(w, h) { await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(300); },
        async shot(file) { const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(file, Buffer.from(s.result.data, "base64")); },
        async close() { try { ws.close(); } catch {} chrome.kill(); server.close(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} },
    };
    return page;
}
