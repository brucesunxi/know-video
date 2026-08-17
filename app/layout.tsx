import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Know Video Studio",
  description: "Create scripts, storyboards, scene visuals, narration, motion, and editable videos from one brief."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
