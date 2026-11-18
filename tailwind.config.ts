import type { Config } from "tailwindcss";

/**
 * Design tokens (design T1). Every value is a CSS variable from app/globals.css, so the public site can override
 * some of them in its own scope (fonts, the two smallest text sizes, muted text colour) while admin and the seller
 * panel keep today's values. The older names (`bagati-*`, `ink`, `paper`, `line`, `muted`, …) stay as aliases.
 *
 * New names avoid Tailwind's default palette (`green`, `emerald`, `red`, …), so no existing class changes colour.
 */
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
        line: { DEFAULT: "var(--bagati-border)", strong: "var(--bagati-border-strong)" },
        muted: "var(--bagati-muted-green)",

        // Primary green #174746: hover is the lighter #23635d (as the site already does), active the darker ink.
        primary: {
          DEFAULT: "var(--bagati-primary)",
          hover: "var(--bagati-hover)",
          active: "var(--bagati-deep-teal)",
          tint: "var(--bagati-brand-100)",
          subtle: "var(--bagati-brand-50)",
        },
        brand: {
          50: "var(--bagati-brand-50)",
          100: "var(--bagati-brand-100)",
          200: "var(--bagati-brand-200)",
          300: "var(--bagati-brand-300)",
          500: "var(--bagati-brand-500)",
          600: "var(--bagati-brand-600)",
          700: "var(--bagati-brand-700)",
          800: "var(--bagati-brand-800)",
          900: "var(--bagati-brand-900)",
        },
        // gold-400 (#c79a52) is for lines, badges and icons only; text in gold uses gold-700.
        gold: {
          100: "var(--bagati-gold-100)",
          200: "var(--bagati-gold-200)",
          400: "var(--bagati-gold-400)",
          600: "var(--bagati-gold-600)",
          700: "var(--bagati-gold-700)",
        },
        fg: {
          DEFAULT: "var(--bagati-deep-teal)",
          body: "var(--bagati-text)",
          secondary: "var(--bagati-text-secondary)",
          muted: "var(--bagati-muted-green)",
        },
        surface: {
          page: "var(--bagati-page)",
          raised: "var(--bagati-white)",
          sunken: "var(--bagati-section)",
          inverse: "var(--bagati-deep-teal)",
        },
        danger: {
          DEFAULT: "var(--bagati-danger)",
          hover: "var(--bagati-danger-hover)",
          subtle: "var(--bagati-danger-subtle)",
        },
        focus: "var(--bagati-focus-ring)",
      },
      // Exactly three standard radii, plus Tailwind's `rounded-full` for pills.
      borderRadius: {
        control: "var(--bagati-radius-control)",
        card: "var(--bagati-radius-card)",
        feature: "var(--bagati-radius-feature)",
      },
      boxShadow: {
        subtle: "var(--bagati-shadow-subtle)",
        card: "var(--bagati-shadow-card)",
        overlay: "var(--bagati-shadow-overlay)",
      },
      fontFamily: {
        sans: ["var(--bagati-font-sans)"],
        serif: ["var(--bagati-font-serif)"],
        display: ["var(--bagati-font-serif)"],
      },
      fontSize: {
        // The two most used sizes follow the scope: 12/14 px in admin and the seller panel, 13/15 px on the public site.
        xs: ["var(--bagati-text-xs)", { lineHeight: "var(--bagati-text-xs-lh)" }],
        sm: ["var(--bagati-text-sm)", { lineHeight: "var(--bagati-text-sm-lh)" }],
        // Semantic type scale for new code and the components/ui primitives.
        display: ["clamp(2.5rem, 1.85rem + 2.2vw, 3.5rem)", { lineHeight: "1.08", letterSpacing: "-0.02em", fontWeight: "600" }],
        h1: ["clamp(1.875rem, 1.65rem + 0.8vw, 2.25rem)", { lineHeight: "1.18", letterSpacing: "-0.015em", fontWeight: "600" }],
        h2: ["clamp(1.375rem, 1.25rem + 0.5vw, 1.625rem)", { lineHeight: "1.25", letterSpacing: "-0.01em", fontWeight: "600" }],
        h3: ["1.125rem", { lineHeight: "1.625rem", fontWeight: "600" }],
        "body-lg": ["1rem", { lineHeight: "1.625rem" }],
        body: ["0.9375rem", { lineHeight: "1.5rem" }],
        caption: ["0.8125rem", { lineHeight: "1.125rem" }],
        kicker: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.16em", fontWeight: "600" }],
      },
    },
  },
  plugins: [],
};

export default config;
