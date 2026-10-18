import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        surface2: "rgb(var(--surface2) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        felt: "rgb(var(--felt) / <alpha-value>)",
        feltDark: "rgb(var(--felt-dark) / <alpha-value>)",
        roulRed: "rgb(var(--red) / <alpha-value>)",
        roulBlack: "rgb(var(--black) / <alpha-value>)",
        gain: "rgb(var(--gain) / <alpha-value>)",
        loss: "rgb(var(--loss) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
export default config;
