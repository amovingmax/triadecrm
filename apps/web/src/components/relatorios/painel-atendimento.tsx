'use client';

import { useQuery } from '@tanstack/react-query';

import { carregarAtendimento, chaveDoRelatorio, mensagemDoErro } from './dados';
import { ErroDoRelatorio, EsqueletoRelatorio } from './estados';
import { formatarInteiro, formatarMinutos, formatarPercentual } from './formatos';
import { TirasDeResumo } from './painel';
import type { Periodo } from './periodo';
import { BarraProporcao } from './tabela';
import type { DefinicaoPainel } from './tipos';

/**
 * Como o time atende no WhatsApp (Fase 4, 22/09/2026): quatro perguntas, cada
 * uma num bloco, sem nada que não leve a uma ação.
 *
 * 1. Quanto a gente demora para responder (mediana, só no horário, e contando
 *    só resposta de gente — menu e aviso automático não contam).
 * 2. Quem atende quantas conversas, e em quanto tempo.
 * 3. Quantos chegam em cada etapa do funil de captação.
 * 4. Por que os negócios se perdem.
 */
export function PainelAtendimento({ painel, periodo }: { painel: DefinicaoPainel; periodo: Periodo }) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('atendimento', periodo),
    queryFn: () => carregarAtendimento(periodo),
  });

  return (
    <section className="flex flex-col gap-6" aria-labelledby="titulo-atendimento">
      <header>
        <h2 id="titulo-atendimento" className="font-heading text-lg font-semibold tracking-tight">
          {painel.titulo}
        </h2>
        <p className="text-sm text-muted-foreground">{painel.descricao}</p>
      </header>

      {consulta.isPending ? (
        <EsqueletoRelatorio colunas={4} linhas={6} />
      ) : consulta.isError ? (
        <ErroDoRelatorio causa={mensagemDoErro(consulta.error)} aoTentar={() => void consulta.refetch()} />
      ) : (
        <Blocos dados={consulta.data} />
      )}
    </section>
  );
}

function Blocos({ dados }: { dados: Awaited<ReturnType<typeof carregarAtendimento>> }) {
  const p = dados.primeira_resposta;
  const pessoas = dados.por_atendente;
  const maiorConversas = pessoas.reduce((m, x) => Math.max(m, x.conversas), 0);
  const maiorChegaram = dados.conversao.reduce((m, x) => Math.max(m, x.chegaram), 0);
  const maiorPerda = dados.perdas.reduce((m, x) => Math.max(m, x.total), 0);
  const totalPerdas = dados.perdas.reduce((s, x) => s + x.total, 0);

  return (
    <>
      <TirasDeResumo
        colunas={4}
        itens={[
          {
            chave: 'mediana',
            rotulo: 'Primeira resposta',
            valor: formatarMinutos(p.mediana_min),
            apoio: 'mediana, no horário',
            ajuda: 'Da mensagem do parceiro até a primeira resposta de alguém do time. Menu e aviso automático não contam.',
          },
          {
            chave: 'em1h',
            rotulo: 'Respondidas em até 1 h',
            valor: p.respondidas > 0 ? (formatarPercentual((p.em_ate_1h * 100) / p.chegadas) ?? '—') : '—',
            apoio: `${formatarInteiro(p.em_ate_1h)} de ${formatarInteiro(p.chegadas)}`,
          },
          {
            chave: 'sem',
            rotulo: 'Ainda sem resposta',
            valor: formatarInteiro(p.sem_resposta),
            apoio: 'mensagens que chegaram no período',
          },
          {
            chave: 'perdas',
            rotulo: 'Negócios perdidos',
            valor: formatarInteiro(totalPerdas),
            apoio: 'no período',
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Bloco titulo="Por atendente" vazio={pessoas.length === 0 ? 'Ninguém atendeu conversa no período.' : null}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1.5 font-medium">Pessoa</th>
                <th className="py-1.5 text-right font-medium">Conversas</th>
                <th className="py-1.5 text-right font-medium">Mensagens</th>
                <th className="py-1.5 text-right font-medium">1ª resposta</th>
              </tr>
            </thead>
            <tbody>
              {pessoas.map((x) => (
                <tr key={x.pessoa_id} className="border-t border-hairline">
                  <td className="py-2">{x.nome}</td>
                  <td className="py-2">
                    <span className="ml-auto flex w-24 flex-col items-end gap-1">
                      <span className="numerico">{formatarInteiro(x.conversas)}</span>
                      <BarraProporcao valor={x.conversas} maximo={maiorConversas} />
                    </span>
                  </td>
                  <td className="numerico py-2 text-right">{formatarInteiro(x.mensagens)}</td>
                  <td className="numerico py-2 text-right">{formatarMinutos(x.mediana_min)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Bloco>

        <Bloco titulo="Conversão por etapa (captação)" vazio={dados.conversao.length === 0 ? 'Sem negócios no período.' : null}>
          <ul className="flex flex-col gap-2 text-sm">
            {dados.conversao.map((x) => (
              <li key={x.etapa} className="grid grid-cols-[minmax(0,1fr)_6rem_7rem] items-center gap-3">
                <span className="truncate">{x.etapa}</span>
                <BarraProporcao valor={x.chegaram} maximo={maiorChegaram} />
                <span className="numerico text-right whitespace-nowrap text-muted-foreground">
                  {formatarInteiro(x.chegaram)}
                  {x.conversao !== null ? ` · ${formatarPercentual(x.conversao) ?? ''}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Bloco>

        <Bloco titulo="Motivos de perda" vazio={dados.perdas.length === 0 ? 'Nenhum negócio perdido no período.' : null}>
          <ul className="flex flex-col gap-2 text-sm">
            {dados.perdas.map((x) => (
              <li key={x.motivo} className="grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] items-center gap-3">
                <span className="truncate">{x.motivo}</span>
                <BarraProporcao valor={x.total} maximo={maiorPerda} />
                <span className="numerico text-right">{formatarInteiro(x.total)}</span>
              </li>
            ))}
          </ul>
        </Bloco>
      </div>
    </>
  );
}

function Bloco({ titulo, vazio, children }: { titulo: string; vazio: string | null; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-hairline bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">{titulo}</h3>
      {vazio ? <p className="text-sm text-muted-foreground">{vazio}</p> : children}
    </section>
  );
}
