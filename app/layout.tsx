import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Know Video Studio",
  description: "从一句需求生成脚本、分镜、画面、配音和可对话修改的视频。"
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
