/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ioredis is server-only; keep it external from the client bundle.
  experimental: { serverComponentsExternalPackages: ["ioredis"] },
};
export default nextConfig;
