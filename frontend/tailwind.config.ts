import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        green: "var(--green)",
        red: "var(--red)",
        blue: "var(--blue)",
        yellow: "var(--yellow)",
        dim: "var(--dim)",
        border: "var(--border)",
        surface: "var(--surface)",
        surface2: "var(--surface2)",
      },
      fontFamily: {
        mono: ["'IBM Plex Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
