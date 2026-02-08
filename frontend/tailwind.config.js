/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      colors: {
        noir: {
          50: "#ffffff",
          200: "#f5f5f5",
          300: "#e5e5e5",
          400: "#a3a3a3",
          500: "#737373",
          600: "#525252",
          700: "#3f3f3f",
          800: "#262626",
          900: "#0a0a0a",
          950: "#050505",
          cta: "#e11d48",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "'IBM Plex Sans'", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 25px rgba(225, 29, 72, 0.35)",
      },
      keyframes: {
        floatIn: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseBorder: {
          "0%, 100%": { borderColor: "#262626" },
          "50%": { borderColor: "#525252" },
        },
      },
      animation: {
        floatIn: "floatIn 0.35s ease-out",
        pulseBorder: "pulseBorder 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
