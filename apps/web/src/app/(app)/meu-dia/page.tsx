import type { Metadata } from 'next';

import { carregarPessoasAcompanhadas } from '@/lib/auth/equipe';
import { pessoaPedida } from '@/lib/auth/hierarquia';
import { requireSession } from '@/lib/auth/session';
import { hojeEmNatal } from '@/components/agenda/tipos';
import { MeuDiaDeQuemLiga } from '@/components/ligacoes-do-dia/meu-dia-de-quem-liga';
import { dataPorExtenso, primeiroNome, saudacaoDoDia } from '@/components/meu-dia/formatos';
import { TelaMeuDia, type PessoaDoSeletor } from '@/components/meu-dia/tela-meu-dia';
import { abaDaUrl } from '@/components/meu-dia/tipos';

export const metadata: Metadata = { title: 'Meu dia' };

/**
 * Meu dia (RF-MET-03, RF-MET-04) — a rota padrão do aplicativo.
 *
 * O servidor faz três coisas e sai da frente: exige sessão, resolve o primeiro nome
 * de quem entrou e escreve a saudação e a data em `America/Fortaleza`. Essas duas
 * frases nascem aqui, e não no navegador, porque dependem do relógio: calculadas no
 * cliente elas divergiriam da renderização do servidor na virada de qualquer hora
 * cheia e a hidratação acusaria a diferença.
 *
 * A fila e o resumo são buscados no cliente, com TanStack Query, porque mudam o dia
 * inteiro — a pessoa registra um contato e volta para cá esperando a fila menor.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sessao, params] = await Promise.all([requireSession(), searchParams]);
  const agora = new Date();

  // Quem liga tem outro Meu dia (pivô de 06/10/2026): o que ela fez hoje e onde
  // continua, e mais nada. Fila de quem respondeu, meta e funil são da gestão.
  if (sessao.papel === 'sdr') {
    return (
      <MeuDiaDeQuemLiga
        usuarioId={sessao.id}
        nome={primeiroNome(sessao.nome)}
        saudacao={saudacaoDoDia(agora)}
        hoje={hojeEmNatal(agora)}
      />
    );
  }

  // Admin e gestor escolhem de quem é o dia (`lib/auth/hierarquia.ts`); para os
  // outros papéis a lista é só a própria pessoa e nem vai ao banco.
  // O papel vem junto, na mesma leitura da `team_directory`: a tela usa para saber
  // se o bloco "Responderam e estão esperando" da `meu_dia` é a fila de todos
  // (admin, gestor e sdr) ou a da pessoa (embaixador) — `alcanceDeQuemRespondeu`.
  const pessoas: PessoaDoSeletor[] = await carregarPessoasAcompanhadas(sessao);

  return (
    <TelaMeuDia
      nome={primeiroNome(sessao.nome)}
      saudacao={saudacaoDoDia(agora)}
      data={dataPorExtenso(agora)}
      podeDefinirMeta={sessao.papel === 'admin' || sessao.papel === 'gestor'}
      usuarioId={sessao.id}
      hoje={hojeEmNatal(agora)}
      abaInicial={abaDaUrl(params.aba)}
      pessoas={pessoas}
      pessoaInicial={pessoaPedida(params.pessoa, pessoas, sessao.id)}
    />
  );
}
