import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Palette pilotée par les variables CSS posées sur <html> depuis la
        // marque active (voir lib/brands/theme.ts). Une couleur littérale
        // serait compilée une fois pour toutes et donc partagée par toutes
        // les marques. Les valeurs de repli vivent dans app/globals.css.
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          fg: "var(--brand-fg)",
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          600: "rgb(var(--brand) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        lg: "0.75rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
