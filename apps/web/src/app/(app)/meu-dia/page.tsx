import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { dataPorExtenso, primeiroNome, saudacaoDoDia } from '@/components/meu-dia/formatos';
import { TelaMeuDia } from '@/components/meu-dia/tela-meu-dia';

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
export default async function Pagina() {
  const sessao = await requireSession();
  const agora = new Date();

  return (
    <TelaMeuDia
      nome={primeiroNome(sessao.nome)}
      saudacao={saudacaoDoDia(agora)}
      data={dataPorExtenso(agora)}
      podeDefinirMeta={sessao.papel === 'admin' || sessao.papel === 'gestor'}
    />
  );
}
