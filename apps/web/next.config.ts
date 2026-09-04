import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pacotes internos "just-in-time" (exportam o fonte TypeScript): o Next os transpila junto com o app.
  transpilePackages: ['@komune/schema'],
  // Sem o cabeçalho X-Powered-By (menos superfície de fingerprint).
  poweredByHeader: false,
  // Pasta de saída do build. O padrão (.next) é o que a Vercel espera e é o que vale em produção.
  // NEXT_DIST_DIR existe só para rodar um build de conferência na mesma máquina sem derrubar o
  // `pnpm dev`, que mantém o .next aberto: `NEXT_DIST_DIR=.next-conferencia pnpm --filter web build`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  images: {
    // Avatares do Google (foto do usuário logado).
    remotePatterns: [{ protocol: 'https', hostname: '*.googleusercontent.com' }],
  },
};

export default nextConfig;
