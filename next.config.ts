import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // hide the floating dev-tools "N" badge that overlaps the UI during `next dev`
  devIndicators: false,
};

export default nextConfig;
