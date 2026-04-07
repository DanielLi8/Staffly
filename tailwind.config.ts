import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/features/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        staffly: {
          bg: "#F8F9FB",
          purple: "#3B2461",
          "purple-deep": "#432C6A",
          muted: "#6B7280",
        },
        primary: {
          DEFAULT: "#3B2461",
          50: "#F4F1FA",
          100: "#E8E4F2",
          200: "#D1C8E5",
          300: "#B3A5D4",
          400: "#8F7AB8",
          500: "#6B5A9C",
          600: "#4A3A7A",
          700: "#3B2461",
          800: "#2E1C4D",
          900: "#22153A",
        },
        accent: {
          DEFAULT: "#C41230",
          50: "#FBE9EC",
          100: "#F5C5CD",
          200: "#EB8B9B",
          300: "#E05169",
          400: "#D61747",
          500: "#C41230",
          600: "#A00E27",
          700: "#7C0B1E",
          800: "#580715",
          900: "#34040C",
        },
        neutral: {
          50: "#F8FAFC",
          100: "#F1F5F9",
          200: "#E2E8F0",
          300: "#CBD5E1",
          400: "#94A3B8",
          500: "#64748B",
          600: "#475569",
          700: "#334155",
          800: "#1E293B",
          900: "#0F172A",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        display: ["var(--font-dm-serif)", "Georgia", "serif"],
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
      },
      boxShadow: {
        card: "0 1px 3px rgba(59, 36, 97, 0.06), 0 4px 12px rgba(59, 36, 97, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
