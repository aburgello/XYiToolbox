/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/js/**/*.{ts,tsx,html}"],
  theme: {
    extend: {},
  },
  // Preflight resets margins/borders/button-defaults etc. across the whole
  // page -- this project's tools already have their own hand-written SCSS
  // that assumes normal element defaults, so Preflight is left off to avoid
  // regressions. Only utility classes (mx-auto, text-center, etc.) are used
  // here, not a full design-system takeover.
  corePlugins: {
    preflight: false,
  },
  plugins: [],
};
