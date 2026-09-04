import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pacotes internos "just-in-time" (exportam o fonte TypeScript): o Next os transpila junto com o app.
  transpilePackages: ['@komune/schema'],
  // Sem o cabeçalho X-Powered-By (menos superfície de fingerprint).
  poweredByHeader: false,
  images: {
    // Avatares do Google (foto do usuário logado).
    remotePatterns: [{ protocol: 'https', hostname: '*.googleusercontent.com' }],
  },
};

export default nextConfig;
