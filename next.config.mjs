// In your next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [],
  },
  api: {
    responseLimit: '10mb',
    bodyParser: {
      sizeLimit: '10mb',
    },
    // If using Vercel, this might help
    externalResolver: true,
  },
}

module.exports = nextConfig
