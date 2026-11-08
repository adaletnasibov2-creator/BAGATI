import type { Config } from "tailwindcss";
const config: Config = { content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"], theme: { extend: { colors: { ink: "#173A3A", paper: "#F6F7F4", champagne: "#C79A52", emerald: "#2F6F68", line: "#E5E9E5", muted: "#697875" }, boxShadow: { card: "0 14px 32px rgba(23,58,58,.08)" }, fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] } } }, plugins: [] };
export default config;
