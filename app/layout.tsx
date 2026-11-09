import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WeGood?",
  description: "See how your roommates are doing in one tap.",
  // iPhone Safari doesn't use the manifest's icons, so it needs these hints.
  appleWebApp: { capable: true, title: "WeGood?", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the app use the full iPhone screen; pages pad around the notch.
  viewportFit: "cover",
  themeColor: "#fef3c7",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-amber-100 text-stone-900 antialiased">
        {children}
      </body>
    </html>
  );
}
