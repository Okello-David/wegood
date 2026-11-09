import type { MetadataRoute } from "next";

// The web app manifest is what makes the site installable to a home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WeGood?",
    short_name: "WeGood?",
    description: "See how your roommates are doing in one tap.",
    start_url: "/",
    display: "standalone",
    background_color: "#fef3c7",
    theme_color: "#fef3c7",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
