import type { MetadataRoute } from "next";

const publicPaths = ["/business", "/checkout", "/terms", "/privacy", "/refund-policy", "/contact"];

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://know-video.vercel.app";
  return publicPaths.map((path) => ({
    url: `${baseUrl}${path}`,
    changeFrequency: "monthly",
    priority: path === "/business" ? 1 : 0.7
  }));
}
