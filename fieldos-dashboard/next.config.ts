import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    "preview-chat-6fb15574-a317-4da3-adae-a3c1cea720a5.space-z.ai",
    "*.space-z.ai",
  ],
};

export default nextConfig;
