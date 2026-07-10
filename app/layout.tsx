import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Know Video Studio",
  description: "AI conversational video generation and scene-based editing studio."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
