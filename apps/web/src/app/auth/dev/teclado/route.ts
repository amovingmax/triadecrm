/**
 * O DIÁRIO DO TECLADO — SÓ EM `next dev`, SÓ COM O SUPABASE LOCAL (04/11/2026).
 *
 * Recebe as linhas que o celular de teste manda com a conversa aberta
 * (`components/conversas/registro-do-teclado.ts`) e as junta num arquivo da pasta
 * temporária do computador. Fora das travas da entrada de teste, responde 404.
 */
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NextResponse, type NextRequest } from 'next/server';

import { entradaLocalLigada } from '@/lib/auth/entrada-local';

export async function POST(request: NextRequest) {
  if (!entradaLocalLigada()) {
    return new NextResponse('Not found', { status: 404 });
  }
  const texto = (await request.text()).slice(0, 200_000);
  const aparelho = request.headers.get('user-agent') ?? '?';
  await appendFile(
    join(tmpdir(), 'triade-teclado.log'),
    `# ${new Date().toISOString()} ${aparelho}\n${texto}\n`,
  );
  return new NextResponse(null, { status: 204 });
}
