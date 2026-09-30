import type { NextConfig } from 'next';

import { REDIRECIONAMENTOS } from './src/lib/redirecionamentos';

const nextConfig: NextConfig = {
  // Pacotes internos "just-in-time" (exportam o fonte TypeScript): o Next os transpila junto com o app.
  transpilePackages: ['@komune/schema', '@komune/prompts'],
  // Sem o cabeçalho X-Powered-By (menos superfície de fingerprint).
  poweredByHeader: false,
  // Pasta de saída do build. O padrão (.next) é o que a Vercel espera e é o que vale em produção.
  // NEXT_DIST_DIR existe só para rodar um build de conferência na mesma máquina sem derrubar o
  // `pnpm dev`, que mantém o .next aberto: `NEXT_DIST_DIR=.next-conferencia pnpm --filter web build`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Só vale em `next dev`: deixa abrir o app também por 127.0.0.1. É o que permite
  // testar dois papéis lado a lado no mesmo navegador (um em localhost, outro em
  // 127.0.0.1, cada endereço com o seu cookie de sessão). Sem isto o Next bloqueia
  // os recursos de desenvolvimento dessa origem e a tela não fica interativa.
  allowedDevOrigins: ['127.0.0.1'],
  // Sem o botão "N" do Next no canto da tela em `next dev` (em produção ele nunca
  // aparece). Erro de compilação ou de execução continua abrindo o aviso do Next.
  devIndicators: false,
  images: {
    // Avatares do Google (foto do usuário logado).
    remotePatterns: [{ protocol: 'https', hostname: '*.googleusercontent.com' }],
  },
  // A lista mora em src/lib/redirecionamentos.ts porque o Vitest deste pacote
  // só enxerga `src/**/*.test.ts`, e redirect sem teste some numa refatoração.
  async redirects() {
    return [...REDIRECIONAMENTOS];
  },
};

export default nextConfig;
