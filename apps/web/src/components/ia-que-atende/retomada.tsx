'use client';

import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, MessageCircleReply, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { CHAVE_DA_IA } from './dados';
import { IA_QUE_ATENDE } from './na-conversa';
import {
  CHAVE_DA_RETOMADA,
  ErroDaRetomada,
  carregarPainelDaRetomada,
  carregarRetomadaDaConversa,
  chaveDaRetomadaNaConversa,
  configurarRetomada,
  lerDias,
  rotuloDaSituacao,
  rotuloDoMotivo,
  textoDoSelo,
  type PainelDaRetomada,
} from './retomada-dados';

/**
 * A IA que atende retoma o contato com o cliente que parou de responder (Imova,
 * 11/11/2026): o placar e a configuração na tela "IA que atende", e o selo discreto
 * da próxima retomada no cabeçalho da conversa.
 */

function mensagemDoErro(e: unknown): string {
  if (e instanceof ErroDaRetomada) return e.message;
  return 'O servidor não respondeu. Tente de novo.';
}

function usePainelDaRetomada() {
  return useQuery({ queryKey: CHAVE_DA_RETOMADA, queryFn: () => carregarPainelDaRetomada(7) });
}

const DATA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

// ---------------------------------------------------------------------------
// O placar (embaixo do placar da IA)
// ---------------------------------------------------------------------------

export function PlacarDaRetomada() {
  const { data: p } = usePainelDaRetomada();
  if (!p) return null;
  const { placar } = p;
  // Desligada e sem nada no período: o placar não ocupa a tela.
  if (!p.config.ligada && placar.enviadas + placar.puladas + placar.naFila === 0) return null;
  const taxa =
    placar.clientes === 0 ? null : Math.round((placar.responderam / placar.clientes) * 100);
  const principal = p.motivos[0];
  const itens: { rotulo: string; valor: string; detalhe?: string }[] = [
    {
      rotulo: 'Retomadas que saíram',
      valor: String(placar.enviadas),
      detalhe: `${placar.porTexto} texto da IA · ${placar.porModelo} modelo${placar.falharam > 0 ? ` · ${placar.falharam} falharam` : ''}`,
    },
    {
      rotulo: 'Responderam depois',
      valor: String(placar.responderam),
      detalhe:
        (taxa === null
          ? 'nenhum cliente retomado ainda'
          : `${taxa}% de ${placar.clientes} cliente(s)`) +
        (placar.pediramParaSair > 0 ? ` · ${placar.pediramParaSair} pediram para sair` : ''),
    },
    {
      rotulo: 'Não saíram',
      valor: String(placar.puladas),
      detalhe: principal ? `mais comum: ${rotuloDoMotivo(principal.motivo)}` : undefined,
    },
    {
      rotulo: 'Custo da retomada',
      valor: `US$ ${p.custoUsd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
      detalhe: placar.naFila > 0 ? `${placar.naFila} sendo escrita(s) agora` : undefined,
    },
  ];
  return (
    <section aria-label="Retomadas dos últimos 7 dias" className="flex flex-col gap-2">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Retomar o contato · últimos 7 dias
      </h2>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {itens.map((i) => (
          <div key={i.rotulo} className="rounded-lg border border-hairline bg-card px-3 py-2">
            <dt className="text-xs text-muted-foreground">{i.rotulo}</dt>
            <dd className="numerico text-xl">{i.valor}</dd>
            {i.detalhe ? <dd className="text-[11px] text-muted-foreground">{i.detalhe}</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// A configuração (último bloco da aba Configuração)
// ---------------------------------------------------------------------------

export function ConfiguracaoDaRetomada({ iaLigada }: { iaLigada: boolean }) {
  const { data: p, isPending, isError } = usePainelDaRetomada();
  if (isPending) return <p className="text-sm text-muted-foreground">Carregando a retomada…</p>;
  if (isError || !p)
    return <p className="text-sm text-destructive-texto">Não deu para carregar a retomada.</p>;
  if (!p.podeConfigurar) return null;
  // A chave remonta o formulário quando a configuração muda no banco.
  return <FormularioDaRetomada key={JSON.stringify(p.config)} painel={p} iaLigada={iaLigada} />;
}

function FormularioDaRetomada({
  painel,
  iaLigada,
}: {
  painel: PainelDaRetomada;
  iaLigada: boolean;
}) {
  const clientes = useQueryClient();
  const { config, modelos } = painel;
  const [dias, setDias] = useState(config.dias.join(', '));
  const idDias = useId();
  const idModelo = useId();
  const diasLidos = lerDias(dias);
  const diasMudaram = diasLidos !== null && diasLidos.join(',') !== config.dias.join(',');

  const salvar = useMutation({
    mutationFn: (valores: Record<string, unknown>) => configurarRetomada(valores),
    onSuccess: () => {
      void clientes.invalidateQueries({ queryKey: CHAVE_DA_IA });
      toast.success('Retomada salva.');
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  const comModelo = config.dias.filter((d) => d >= 2);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-card p-3">
      <div className="flex flex-col gap-1">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <MessageCircleReply className="size-4" aria-hidden="true" />
          Retomar quem parou de responder
        </h3>
        <p className="text-sm text-muted-foreground">
          Quando a Imova falou por último e o cliente não respondeu, a IA retoma o contato nos dias
          escolhidos, sem pressão. No dia 1 ela escreve um texto curto, ainda dentro das 24 h do
          WhatsApp (entre {config.textoDeHoras} e {config.textoAteHoras} h depois da última mensagem
          do cliente). Depois disso o WhatsApp só aceita modelo aprovado pela Meta.
        </p>
        <p className="text-xs text-muted-foreground">
          Só onde a IA atende, só no horário de envio do CRM, nunca em domingo ou feriado, e com
          pelo menos {config.intervaloMinHoras} h entre uma retomada e outra. Para quando o cliente
          responde, pede para sair, a equipe assume ou conclui a conversa, o negócio fecha ou há
          visita marcada. Nenhum modelo sai sem a IA ter lido a conversa antes: se o texto do dia 1
          não saiu, ela lê antes do primeiro modelo, e se o cliente encerrou o assunto, nada sai. Só
          conta o silêncio que começou depois de ligar.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={config.ligada ? 'outline' : 'default'}
          disabled={salvar.isPending}
          onClick={() => salvar.mutate({ ligada: !config.ligada })}
        >
          {config.ligada ? 'Desligar a retomada' : 'Ligar a retomada'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {config.ligada
            ? `Ligada${config.ligadaEm ? ` desde ${DATA.format(new Date(config.ligadaEm))}` : ''}.`
            : 'Desligada: nenhuma retomada sai.'}
        </span>
      </div>
      {config.ligada && !iaLigada ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />A IA está desligada: a
          retomada só sai com ela ligada.
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={idDias} className="text-xs text-muted-foreground">
          Dias sem resposta (até cinco, em ordem; 1 = texto da IA)
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={idDias}
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            inputMode="numeric"
            className="w-40"
            aria-invalid={diasLidos === null}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={salvar.isPending || !diasMudaram}
            onClick={() => diasLidos && salvar.mutate({ dias: diasLidos })}
          >
            Salvar os dias
          </Button>
        </div>
        {diasLidos === null ? (
          <p className="text-xs text-destructive-texto">
            Use de 1 a 30, em ordem crescente: por exemplo, 1, 3, 7.
          </p>
        ) : null}
      </div>

      {comModelo.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            O modelo de cada dia. Ele precisa estar aprovado pela Meta; sem modelo aprovado, a
            retomada daquele dia não sai e o motivo fica no placar. O CRM preenche {'{{nome}}'} (o
            primeiro nome), {'{{imovel}}'} (o imóvel de que falavam) e {'{{saudacao}}'}. Os textos
            propostos estão no guia <code>docs/operacao/retomar-contato.md</code>.
          </p>
          {modelos.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum modelo de WhatsApp de marketing ou utilidade no CRM ainda.
            </p>
          ) : null}
          {comModelo.map((d) => {
            const escolhido = config.modelos[String(d)] ?? '';
            const modelo = modelos.find((m) => m.codigo === escolhido);
            return (
              <div key={d} className="flex flex-col gap-1">
                <label htmlFor={`${idModelo}-${d}`} className="text-xs text-muted-foreground">
                  Dia {d}
                </label>
                <select
                  id={`${idModelo}-${d}`}
                  value={escolhido}
                  disabled={salvar.isPending}
                  onChange={(e) =>
                    salvar.mutate({
                      modelos: {
                        ...config.modelos,
                        [String(d)]: e.target.value === '' ? null : e.target.value,
                      },
                    })
                  }
                  className="h-10 max-w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="">Nenhum: o dia {d} não sai</option>
                  {modelos.map((m) => (
                    <option key={m.codigo} value={m.codigo}>
                      {m.nome} ({m.codigo}) · {rotuloDaSituacao(m)}
                      {m.preenche ? '' : ' · variável que a retomada não preenche'}
                    </option>
                  ))}
                </select>
                {modelo ? (
                  <p className="text-[11px] whitespace-pre-line text-muted-foreground">
                    {!modelo.aprovado || !modelo.ativo || !modelo.preenche ? (
                      <span className="text-destructive-texto">
                        Não sai assim:{' '}
                        {!modelo.ativo
                          ? 'o modelo está desligado'
                          : !modelo.aprovado
                            ? rotuloDaSituacao(modelo)
                            : 'tem variável que a retomada não preenche'}
                        .{' '}
                      </span>
                    ) : null}
                    {modelo.corpo}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// O selo na conversa
// ---------------------------------------------------------------------------

/** "Retomada amanhã, 08:00": discreto, ao lado do selo da IA; some quando não há retomada a caminho. */
export function SeloDaRetomada({ fioId, naFolha = false }: { fioId: string; naFolha?: boolean }) {
  const { data } = useQuery({
    queryKey: chaveDaRetomadaNaConversa(fioId),
    queryFn: () => carregarRetomadaDaConversa(fioId),
    enabled: IA_QUE_ATENDE,
    staleTime: 60_000,
  });
  if (!IA_QUE_ATENDE) return null;
  const selo = textoDoSelo(data ?? null);
  if (selo === null) return null;
  return (
    <Badge
      variant="pilula"
      title={selo.detalhe}
      className={
        naFolha
          ? 'h-9 gap-1.5 px-3 text-sm font-normal text-muted-foreground'
          : 'h-5 gap-1 px-2 text-[11px] font-normal text-muted-foreground'
      }
    >
      <Clock className="size-3" aria-hidden="true" />
      {selo.rotulo}
    </Badge>
  );
}
