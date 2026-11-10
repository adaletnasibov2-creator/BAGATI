import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bagati: {
          deep: "var(--bagati-deep-teal)",
          primary: "var(--bagati-primary)",
          hover: "var(--bagati-hover)",
          accent: "var(--bagati-accent)",
          muted: "var(--bagati-muted-green)",
          text: "var(--bagati-text)",
          secondary: "var(--bagati-text-secondary)",
          page: "var(--bagati-page)",
          section: "var(--bagati-section)",
          border: "var(--bagati-border)",
          cream: "var(--bagati-cream)",
          gold: "var(--bagati-gold)",
          "gold-dark": "var(--bagati-gold-dark)",
          "cream-dark": "var(--bagati-cream-dark)",
        },
        ink: "var(--bagati-deep-teal)",
        paper: "var(--bagati-page)",
        champagne: "var(--bagati-gold)",
        emerald: "var(--bagati-accent)",
        line: "var(--bagati-border)",
        muted: "var(--bagati-muted-green)",
      },
      boxShadow: { card: "0 14px 32px rgba(23,58,58,.08)" },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};

export default config;
