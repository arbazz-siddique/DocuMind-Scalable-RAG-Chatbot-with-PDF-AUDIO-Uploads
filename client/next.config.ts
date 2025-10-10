import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
   output: 'standalone', // or 'export' if you want static export
  trailingSlash: true,
  images: {
    unoptimized: true // if you're having image issues
  },
  env: {
    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  }
};

export default nextConfig;
