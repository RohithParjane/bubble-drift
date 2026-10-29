import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build also works from a GitHub Pages project path
// (https://<user>.github.io/<repo>/) and from a custom domain.
export default defineConfig({ base: "./", plugins: [react()] });
