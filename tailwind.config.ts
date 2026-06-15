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
        brand: {
          DEFAULT: "#144A66",
          fg: "#FFFFFF",
          50: "#eef4f8",
          100: "#d4e3ec",
          600: "#144A66",
          700: "#103b52",
          900: "#0a2738",
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
