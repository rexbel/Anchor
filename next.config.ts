import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the GB10 Docker image.
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
