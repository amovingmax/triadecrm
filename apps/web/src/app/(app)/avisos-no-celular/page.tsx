import type { Metadata } from 'next';

import { ChavesDeAvisos, type AvisoDaPessoa } from '@/components/avisos/chaves-de-avisos';
import { requireSession } from '@/lib/auth/session';
import { EMPRESA } from '@/lib/empresa';
import { LEITURA } from '@/lib/larguras';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Avisos no celular' };

/**
 * "Avisos no celular" (entrevista de 06/11/2026): cada pessoa liga e desliga, para si,
 * cada tipo de aviso do app. A lista é a desta empresa (`app.avisos_catalogo`): a
 * KOMUNE e a Imova têm avisos diferentes. Quem decide e manda é o banco (migração
 * 20261106210000); aqui só se escolhe.
 */
export default async function PaginaAvisosNoCelular() {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('avisos_meus' as never);
  const avisos = (error ? [] : (data ?? [])) as AvisoDaPessoa[];

  return (
    <div className={LEITURA}>
      <h1 className="text-xl font-semibold tracking-tight">Avisos no celular</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        O que o app do Tríade avisa você na {EMPRESA.nome}. Das 8h às 20h o aviso toca; fora disso
        chega sem som. O lembrete de compromisso sempre toca.
      </p>
      {error ? (
        <p role="alert" className="mt-6 text-sm text-quente-texto">
          Não deu para ler os seus avisos agora. Tente de novo em alguns segundos.
        </p>
      ) : (
        <ChavesDeAvisos iniciais={avisos} />
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        Para parar os avisos de uma conversa só, silencie a conversa no menu dela.
      </p>
    </div>
  );
}
