import type { NextConfig } from "next";

// Cache Components is left off on purpose: almost every WeGood? page shows
// per-user, live data, so we keep Next's simpler default rendering model.
const nextConfig: NextConfig = {
  // Lets a phone on the same Wi-Fi use the dev server. Update it if your
  // computer's local IP changes.
  allowedDevOrigins: ["192.168.1.168"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
