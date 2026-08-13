/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Geist", "IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        ink: { 950: "#0c0d10", 900: "#14161c", 800: "#1c1f28", 700: "#2a2f3a" },
        sand: { 50: "#f6f1e8", 100: "#ece3d3", 400: "#d4b483" },
        ember: { 400: "#e8a04c", 500: "#d4892a" },
      },
    },
  },
  plugins: [],
};
