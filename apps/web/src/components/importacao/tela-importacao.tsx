'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Undo2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { TRABALHO } from '@/lib/larguras';
import { DialogoConfirmar } from '@/components/admin/confirmar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarDataHora, formatarNumero } from '@/components/parceiros/formatos';

import {
  abrirLote,
  buscarLotes,
  desfazerLote,
  encerrarLote,
  fraseDoDesfazer,
  gravar,
  mensagemDoErro,
  pedirPrevia,
  prazoDoDesfazer,
  totalDe,
  type LinhaCrua,
  type PrazoDoDesfazer,
} from './dados';
import { ErroDaImportacao, EsqueletoDaPrevia, Progresso, SemLotes } from './estados';
import { faltando, linhaParaObjeto, sugerirMapa, temConteudo, type Sugestao } from './mapeamento';
import { PassoArquivo } from './passo-arquivo';
import { PassoMapa } from './passo-mapa';
import { PassoPrevia } from './passo-previa';
import type { PedidoAoLeitor, RespostaDoLeitor } from './planilha.worker';
import { Recibo } from './recibo';
import {
  ROTULO_DECISAO,
  type LoteAnterior,
  type Mapa,
  type PlanilhaLida,
  type Previa,
  type Recibo as TipoRecibo,
} from './tipos';

type Etapa = 'arquivo' | 'mapa' | 'previa' | 'recibo';

type Falha = { causa: string; comoResolver?: string } | null;

/**
 * A importação de planilha (RF-BAS-07), de ponta a ponta.
 *
 * Quatro etapas numa tela só, porque são quatro momentos de um trabalho só:
 * escolher o arquivo, dizer o que é cada coluna, conferir a prévia e gravar.
 * Voltar é sempre possível até a gravação; depois dela, o que existe é o desfazer
 * de 48 h, que é uma promessa diferente e aparece em dois lugares: no recibo, para
 * quem acabou de gravar, e em cada lote da lista, para quem só descobre o erro no
 * dia seguinte.
 *
 * Onde cada coisa acontece
 *   · ler o arquivo → Web Worker (a tela não pode congelar em planilha grande);
 *   · classificar e gravar → Postgres, em pedaços, com barra andando;
 *   · nesta função → o passo atual, o mapa de colunas e a tradução dos erros.
 */
export function TelaImportacao({ podeImportar, podeDesfazer, origemPlanilhaId }: {
  /** Papéis que escrevem na base. A autorização de verdade é o RLS. */
  podeImportar: boolean;
  /**
   * Espelho de `app.is_manager()`: quem desfaz um lote (RF-BAS-17).
   *
   * Vem separado de `podeImportar` de propósito — quem importa (sdr) não desfaz,
   * e oferecer o botão a ela era o §3.7 do laudo.
   */
  podeDesfazer: boolean;
  /** Id da fonte "planilha" no catálogo: é o `source_id` do lote. */
  origemPlanilhaId: number;
}) {
  const clienteDeConsultas = useQueryClient();

  const [etapa, setEtapa] = useState<Etapa>('arquivo');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [planilha, setPlanilha] = useState<PlanilhaLida | null>(null);
  const [mapa, setMapa] = useState<Mapa>({});
  const [sugestao, setSugestao] = useState<Sugestao>({ mapa: {}, motivos: {} });
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [recibo, setRecibo] = useState<TipoRecibo | null>(null);

  const [passoDaLeitura, setPassoDaLeitura] = useState<'lendo' | 'abrindo' | 'varrendo' | null>(null);
  const [andamento, setAndamento] = useState<{ rotulo: string; feitas: number; total: number } | null>(null);
  const [falha, setFalha] = useState<Falha>(null);

  const trabalhador = useRef<Worker | null>(null);

  const lotes = useQuery({
    queryKey: ['importacao', 'lotes'],
    queryFn: buscarLotes,
    enabled: podeImportar,
  });

  // O worker é criado uma vez e desligado ao sair da tela: um worker vivo depois
  // da navegação segura o arquivo inteiro na memória do navegador.
  useEffect(() => {
    return () => {
      trabalhador.current?.terminate();
      trabalhador.current = null;
    };
  }, []);

  const lerArquivoEscolhido = useCallback((escolhido: File) => {
    setFalha(null);
    setArquivo(escolhido);
    setPlanilha(null);
    setPrevia(null);
    setRecibo(null);
    setPassoDaLeitura('lendo');

    trabalhador.current?.terminate();
    const w = new Worker(new URL('./planilha.worker.ts', import.meta.url));
    trabalhador.current = w;

    w.addEventListener('message', (evento: MessageEvent<RespostaDoLeitor>) => {
      const resposta = evento.data;
      if (resposta.tipo === 'passo') {
        setPassoDaLeitura(resposta.passo);
        return;
      }
      if (resposta.tipo === 'erro') {
        setPassoDaLeitura(null);
        setFalha({ causa: resposta.mensagem, comoResolver: resposta.comoResolver });
        return;
      }
      setPassoDaLeitura(null);
      const lida = resposta.planilha;
      if (lida.cabecalho.length === 0) {
        setFalha({
          causa: 'A planilha está vazia.',
          comoResolver: 'Confira se você mandou o arquivo certo e se a aba tem cabeçalho.',
        });
        return;
      }
      if (lida.linhas.length === 0) {
        setFalha({
          causa: `A aba "${lida.aba}" tem cabeçalho mas nenhuma linha de dado.`,
          comoResolver:
            lida.abas.length > 1
              ? `As abas deste arquivo são: ${lida.abas.join(', ')}. Preencha a aba certa e mande de novo.`
              : 'Preencha a planilha e mande de novo.',
        });
        return;
      }
      const s = sugerirMapa(lida.cabecalho);
      setPlanilha(lida);
      setSugestao(s);
      setMapa(s.mapa);
      setEtapa('mapa');
    });

    w.addEventListener('error', () => {
      setPassoDaLeitura(null);
      setFalha({
        causa: 'O leitor de planilha parou no meio.',
        comoResolver: 'Recarregue a página e tente de novo com o mesmo arquivo.',
      });
    });

    const pedido: PedidoAoLeitor = { arquivo: escolhido };
    w.postMessage(pedido);
  }, []);

  /** As linhas com conteúdo, já no formato que o banco entende. */
  const montarLinhas = useCallback((): LinhaCrua[] => {
    if (!planilha) return [];
    const saida: LinhaCrua[] = [];
    planilha.linhas.forEach((valores, i) => {
      if (!temConteudo(valores, mapa)) return;
      // +2: a linha 1 é o cabeçalho e a contagem da planilha começa em 1. Assim o
      // número que a prévia mostra é o número que a pessoa vê no Excel.
      saida.push(linhaParaObjeto(valores, mapa, i + 2));
    });
    return saida;
  }, [planilha, mapa]);

  const conferir = useCallback(async () => {
    const linhas = montarLinhas();
    if (linhas.length === 0) {
      setFalha({
        causa: 'Nenhuma linha tem conteúdo nas colunas que você indicou.',
        comoResolver: 'Confira o mapa das colunas: talvez o nome esteja em outra.',
      });
      return;
    }
    setFalha(null);
    setEtapa('previa');
    setPrevia(null);
    setAndamento({ rotulo: 'Conferindo contra a base', feitas: 0, total: linhas.length });
    try {
      const resultado = await pedirPrevia(linhas, (feitas, total) =>
        setAndamento({ rotulo: 'Conferindo contra a base', feitas, total }),
      );
      setPrevia(resultado);
    } catch (erro) {
      setFalha({ causa: mensagemDoErro(erro) });
      setEtapa('mapa');
    } finally {
      setAndamento(null);
    }
  }, [montarLinhas]);

  const importar = useCallback(async () => {
    const linhas = montarLinhas();
    if (linhas.length === 0 || !arquivo) return;

    // O rótulo é só o nome do arquivo: a lista de lotes e o recibo já mostram a
    // data ao lado, e repetir a hora dentro do nome deixa a linha ilegível.
    const rotulo = arquivo.name;
    setFalha(null);
    setAndamento({ rotulo: 'Gravando', feitas: 0, total: linhas.length });

    let loteId: string | null = null;
    try {
      loteId = await abrirLote(rotulo, origemPlanilhaId);
      const resultado = await gravar(loteId, linhas, (feitas, total) =>
        setAndamento({ rotulo: 'Gravando', feitas, total }),
      );
      const desfazerAte = await encerrarLote(loteId);
      setRecibo({
        loteId,
        rotulo,
        contagem: resultado.contagem,
        linhas: resultado.linhas,
        desfazerAte,
      });
      setEtapa('recibo');
      void clienteDeConsultas.invalidateQueries({ queryKey: ['importacao'] });
      const criadas = resultado.contagem.entra ?? 0;
      if (criadas === 0) {
        // Zero não é fracasso: no reimport do mesmo arquivo é exatamente o
        // esperado. Um "sucesso: 0 fichas" faria a pessoa importar de novo
        // achando que falhou.
        toast.info('Nada novo entrou: essas linhas já estavam na base.');
      } else {
        toast.success(`${formatarNumero(criadas)} ${criadas === 1 ? 'ficha criada' : 'fichas criadas'}.`);
      }
    } catch (erro) {
      if (loteId) await encerrarLote(loteId, 'Falhou no meio da gravação.').catch(() => undefined);
      setFalha({
        causa: mensagemDoErro(erro),
        comoResolver:
          'O que já tinha sido gravado continua no lote e pode ser desfeito na lista de importações.',
      });
      void clienteDeConsultas.invalidateQueries({ queryKey: ['importacao'] });
    } finally {
      setAndamento(null);
    }
  }, [arquivo, clienteDeConsultas, montarLinhas, origemPlanilhaId]);

  const recomecar = useCallback(() => {
    setEtapa('arquivo');
    setArquivo(null);
    setPlanilha(null);
    setPrevia(null);
    setRecibo(null);
    setMapa({});
    setFalha(null);
  }, []);

  const pendentes = faltando(mapa);
  const podeConferir = planilha !== null && pendentes.length === 0;

  if (!podeImportar) {
    return (
      <div className="flex w-full flex-col gap-4">
        <Cabecalho />
        <ErroDaImportacao
          titulo="O seu acesso não importa planilha"
          causa="Importar traz gente de fora para dentro da base, e por isso é restrito a quem escreve nela."
          comoResolver="Fale com um gestor se você precisa deste acesso."
        />
      </div>
    );
  }

  // TRABALHO, e não LEITURA: o passo do mapa mostra a prévia da planilha, que é uma
  // tabela de quantas colunas o arquivo tiver. Numa coluna de 896px ela rolaria de
  // lado justamente onde a pessoa precisa comparar cabeçalho com conteúdo.
  return (
    <div className={cn(TRABALHO, 'flex flex-col gap-6')}>
      <Cabecalho />

      {falha ? (
        <ErroDaImportacao
          causa={falha.causa}
          comoResolver={falha.comoResolver}
          aoTentar={() => setFalha(null)}
        />
      ) : null}

      {etapa === 'arquivo' ? (
        <>
          <PassoArquivo
            aoEscolher={lerArquivoEscolhido}
            ocupado={passoDaLeitura !== null}
            passo={passoDaLeitura}
          />
          <ListaDeLotes
            lotes={lotes.data ?? null}
            carregando={lotes.isPending}
            podeDesfazer={podeDesfazer}
            aoDesfazer={() => {
              void clienteDeConsultas.invalidateQueries({ queryKey: ['importacao'] });
            }}
          />
        </>
      ) : null}

      {etapa === 'mapa' && planilha ? (
        <>
          <ArquivoEscolhido arquivo={arquivo} planilha={planilha} aoTrocar={recomecar} />
          <PassoMapa planilha={planilha} mapa={mapa} sugestao={sugestao} aoMudar={setMapa} />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={!podeConferir}
              onClick={() => void conferir()}
              className="toque h-11 md:h-9"
            >
              Conferir antes de gravar
            </Button>
            {pendentes.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                Indique as colunas obrigatórias para continuar.
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {etapa === 'previa' ? (
        <>
          {planilha ? (
            <ArquivoEscolhido arquivo={arquivo} planilha={planilha} aoTrocar={recomecar} />
          ) : null}

          {andamento ? <Progresso {...andamento} /> : null}

          {previa === null ? (
            <EsqueletoDaPrevia />
          ) : (
            <>
              <PassoPrevia previa={previa} aoVoltar={() => setEtapa('mapa')} />
              {/* A barra de gravar acompanha a rolagem porque a prévia é longa: sem
                  isso a pessoa lê 68 linhas e tem de voltar ao topo para agir. No
                  celular ela para ACIMA da barra de navegação da casca — senão o
                  botão principal ficaria debaixo do menu. */}
              <div className="sticky bottom-[calc(var(--altura-barra-inferior)+var(--area-segura-inferior))] -mx-4 flex flex-wrap items-center gap-3 border-t border-hairline bg-background/95 px-4 py-3 backdrop-blur md:mx-0 md:bottom-0 md:rounded-xl md:border md:px-4">
                <Button
                  disabled={andamento !== null}
                  onClick={() => void importar()}
                  className="toque h-11 md:h-9"
                >
                  <Upload aria-hidden="true" />
                  Gravar {formatarNumero(totalDe(previa.contagem))}{' '}
                  {totalDe(previa.contagem) === 1 ? 'linha' : 'linhas'}
                </Button>
                <p className="text-sm text-muted-foreground">
                  {formatarNumero(previa.contagem.entra ?? 0)} viram ficha agora; o resto vai para a
                  fila do Radar ou não entra.
                </p>
              </div>
            </>
          )}
        </>
      ) : null}

      {etapa === 'recibo' && recibo ? (
        <Recibo
          recibo={recibo}
          podeDesfazer={podeDesfazer}
          aoRecomecar={recomecar}
          aoDesfazer={() => {
            recomecar();
            void clienteDeConsultas.invalidateQueries({ queryKey: ['importacao'] });
          }}
        />
      ) : null}
    </div>
  );
}

function Cabecalho() {
  return (
    <header>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Importar planilha</h1>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        A planilha vira ficha pela mesma esteira do Radar: nada é gravado antes de você ver a
        prévia, e o que já existe na base não é sobrescrito.
      </p>
    </header>
  );
}

function ArquivoEscolhido({
  arquivo,
  planilha,
  aoTrocar,
}: {
  arquivo: File | null;
  planilha: PlanilhaLida;
  aoTrocar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline p-3">
      <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{arquivo?.name ?? planilha.aba}</p>
        <p className="text-sm text-muted-foreground">
          Aba {planilha.aba} · <span className="numerico">{planilha.linhas.length}</span>{' '}
          {planilha.linhas.length === 1 ? 'linha' : 'linhas'}
        </p>
      </div>
      <Button variant="ghost" onClick={aoTrocar} className="toque h-11 md:h-9">
        Trocar arquivo
      </Button>
    </div>
  );
}

/**
 * As importações anteriores — e o desfazer de 48 h onde ele é de fato usado.
 *
 * O botão do recibo só alcança quem acabou de gravar e ainda está com a tela
 * aberta. O caso real do desfazer é outro: a planilha entra à noite e no dia
 * seguinte alguém percebe que era o arquivo errado. Aí a pessoa abre esta tela,
 * vê o lote com data e autor, e as 48 h continuam correndo no banco. Sem o botão
 * aqui, o único caminho era apagar ficha por ficha.
 *
 * Quem decide continua sendo o Postgres (`app.is_manager()` e o `can_undo_until`
 * no relógio do servidor). A tela só evita oferecer um botão que já se sabe
 * recusado, e conta a quem não pode a quem pedir e até quando.
 */
function ListaDeLotes({
  lotes,
  carregando,
  podeDesfazer,
  aoDesfazer,
}: {
  lotes: LoteAnterior[] | null;
  carregando: boolean;
  /** Espelho de `app.is_manager()`: quem desfaz um lote (RF-BAS-17). */
  podeDesfazer: boolean;
  /** Chamado depois de desfazer, para a lista e as contagens se refazerem. */
  aoDesfazer: () => void;
}) {
  // Guarda junto o prazo que a pessoa VIU na linha: recalcular dentro do diálogo
  // faria o texto discordar do botão que acabou de ser apertado.
  const [confirmando, setConfirmando] = useState<{
    lote: LoteAnterior;
    prazo: PrazoDoDesfazer;
  } | null>(null);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);

  const desfazer = async (lote: LoteAnterior) => {
    setConfirmando(null);
    setDesfazendo(lote.id);
    try {
      const r = await desfazerLote(lote.id);
      if (r.jaEstava) {
        // Duas abas abertas, ou dois gestores no mesmo lote: o banco responde
        // "já estava" em vez de errar, e dizer "removi" seria mentira.
        toast.info('Esse lote já tinha sido desfeito.');
      } else {
        toast.success(fraseDoDesfazer(r));
      }
      aoDesfazer();
    } catch (erro) {
      toast.error(mensagemDoErro(erro));
    } finally {
      setDesfazendo(null);
    }
  };

  if (carregando) {
    return (
      <div aria-busy="true" className="h-24 animate-pulse rounded-xl bg-muted/60" aria-label="Carregando as importações anteriores" />
    );
  }
  if (!lotes || lotes.length === 0) return <SemLotes />;

  return (
    <section aria-labelledby="lotes" className="flex flex-col gap-2">
      <h2 id="lotes" className="font-heading font-medium tracking-tight">
        Importações anteriores
      </h2>
      <ul className="border-t border-hairline">
        {lotes.map((lote) => {
          // O `pode_desfazer` diz o que o banco respondeu na hora da consulta; o
          // prazo confere o relógio agora. Numa aba aberta desde ontem o primeiro
          // continua verdadeiro depois de as 48 h terem vencido, e oferecer o botão
          // ali só renderia uma recusa.
          const prazo = lote.pode_desfazer ? prazoDoDesfazer(lote.desfazer_ate) : null;

          return (
            <li
              key={lote.id}
              className="flex flex-col gap-1 border-b border-hairline py-3 md:flex-row md:items-center md:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{lote.rotulo}</p>
                <p className="text-sm text-muted-foreground">
                  <span className="numerico">{formatarDataHora(lote.criado_em)}</span>
                  {lote.quem ? ` · ${lote.quem}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="pilula" className="h-auto py-1">
                  <span className="numerico font-semibold">{formatarNumero(lote.organizacoes)}</span>
                  {lote.organizacoes === 1 ? 'ficha' : 'fichas'}
                </Badge>
                {(['duplicata', 'revisao', 'nao_contatar'] as const)
                  .filter((d) => (lote.stats[d] ?? 0) > 0)
                  .map((d) => (
                    <Badge key={d} variant="outline" className="h-auto py-1 font-normal">
                      <span className="numerico">{formatarNumero(lote.stats[d] ?? 0)}</span>
                      {ROTULO_DECISAO[d].toLowerCase()}
                    </Badge>
                  ))}
              </div>

              {prazo ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {podeDesfazer ? (
                    <Button
                      variant="destructive"
                      // Um desfazer de cada vez: dois lotes em voo ao mesmo tempo
                      // deixariam a lista contando duas histórias diferentes.
                      disabled={desfazendo !== null}
                      onClick={() => setConfirmando({ lote, prazo })}
                      aria-label={`Desfazer a importação ${lote.rotulo}`}
                      className="toque h-11 md:h-9"
                    >
                      <Undo2 aria-hidden="true" />
                      {desfazendo === lote.id ? 'Desfazendo...' : 'Desfazer'}
                    </Button>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {podeDesfazer ? null : 'Desfazer é de gestor · '}
                    {prazo.verbo} <span className="numerico">{prazo.numero}</span> {prazo.unidade}
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {confirmando ? (
        <DialogoConfirmar
          aberto
          aoFechar={() => setConfirmando(null)}
          titulo="Desfazer esta importação?"
          perigo
          rotuloConfirmar="Desfazer o lote"
          descricao={
            <>
              <p>
                {confirmando.lote.organizacoes > 0 ? (
                  <>
                    O lote{' '}
                    <span className="font-medium text-foreground">{confirmando.lote.rotulo}</span>{' '}
                    tem{' '}
                    <span className="numerico">
                      {formatarNumero(confirmando.lote.organizacoes)}
                    </span>{' '}
                    {confirmando.lote.organizacoes === 1 ? 'ficha' : 'fichas'} na base. Saem as que
                    ninguém tocou depois da importação; as que já têm conversa registrada, mudança
                    de etapa, autorização ou ligação ficam de pé, e o CRM diz quantas foram.
                  </>
                ) : (
                  <>
                    O lote{' '}
                    <span className="font-medium text-foreground">{confirmando.lote.rotulo}</span>{' '}
                    não tem ficha na base para remover. O que sai são os candidatos que ele deixou
                    na fila do Radar.
                  </>
                )}
              </p>
              <p>
                Os candidatos que ainda não foram decididos somem da fila do Radar junto. Para
                trazer tudo de volta, só importando a planilha outra vez.
              </p>
              <p>Das 48 horas do desfazer, {confirmando.prazo.frase}.</p>
            </>
          }
          aoConfirmar={() => void desfazer(confirmando.lote)}
        />
      ) : null}
    </section>
  );
}
