/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable x-powered-by header
  poweredByHeader: false,
  // Allow cross-origin images from our API
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
