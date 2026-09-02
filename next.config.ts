import type { NextConfig } from 'next'

const config: NextConfig = {
  // Spotify serves artist images from a rotating set of i.scdn.co hosts.
  images: { remotePatterns: [{ protocol: 'https', hostname: '*.scdn.co' }] },
}

export default config
