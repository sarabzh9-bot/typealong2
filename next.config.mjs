/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Load this package with Node's own resolver instead of bundling it,
  // which avoids ESM/CJS bundling problems with youtube-transcript.
  serverExternalPackages: ['youtube-transcript'],
};

export default nextConfig;
