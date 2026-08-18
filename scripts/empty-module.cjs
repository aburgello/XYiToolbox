// A stand-in for node-canvas and path2d-polyfill.
//
// pdfjs reaches for both to render PDF pages to a bitmap. Nothing in these
// scripts renders anything -- they only read text out of the tables -- so both
// are aliased here rather than installed, which keeps three scary-looking
// warnings off stderr without pretending the dependencies exist.
//
// polyfillPath2D is named because pdfjs destructures and CALLS it; an empty
// object got as far as "polyfillPath2D is not a function".
module.exports = {};
module.exports.polyfillPath2D = function () { /* nothing to polyfill, nothing rendered */ };
