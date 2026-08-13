/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#0a0b0e", 900: "#111318", 800: "#181b22", 700: "#232833" },
        sand: { 50: "#f6f1e8", 200: "#d8cbb6" },
        ember: { 300: "#f0c27a", 400: "#e8a04c", 500: "#c9842f" },
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "ui-sans-serif", "system-ui"],
        serif: ["Fraunces", "ui-serif", "Georgia"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 80px -20px rgba(232, 160, 76, 0.45)",
      },
    },
  },
  plugins: [],
};
