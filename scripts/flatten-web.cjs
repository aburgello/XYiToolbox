// Flattens the web demo build so index.html sits at dist/web/ root (ready to
// drop onto any static host), rewriting the "../assets/" references it picked
// up from living under /main/ to plain "assets/". .cjs because package.json is
// "type":"module".
const fs = require("fs");
const path = require("path");

const webDir = path.resolve(__dirname, "..", "dist", "web");
const nested = path.join(webDir, "main", "index.html");
const target = path.join(webDir, "index.html");

if (!fs.existsSync(nested)) {
  console.error("flatten-web: no build found at", nested, "— run the web build first.");
  process.exit(1);
}

let html = fs.readFileSync(nested, "utf8");
html = html.replace(/\.\.\/assets\//g, "assets/");
fs.writeFileSync(target, html);
fs.rmSync(path.join(webDir, "main"), { recursive: true, force: true });
console.log("flatten-web: index.html written to dist/web/ root.");
