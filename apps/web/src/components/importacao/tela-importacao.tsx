'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Undo2 } from 'lucide-react';
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
  ensinarCategorias,
  fraseDoDesfazer,
  gravar,
  mensagemDoErro,
  pedirPrevia,
  prazoDoDesfazer,
  type LinhaCrua,
  type PrazoDoDesfazer,
} from './dados';
import { ErroDaImportacao, EsqueletoDaPrevia, Progresso } from './estados';
import {
  faltando,
  montarLinhasDaPlanilha,
  sugerirMapa,
  type Sugestao,
} from './mapeamento';
import { detectarOrigem, type OrigemDetectada } from './origem-detectada';
import { CartaoDoArquivo } from './cartao-do-arquivo';
import { PassoArquivo } from './passo-arquivo';
import { PassoMapa } from './passo-mapa';
import { PassoPrevia } from './passo-previa';
import { Passos, type PassoDaImportacao } from './passos';
import type { PedidoAoLeitor, RespostaDoLeitor } from './planilha.worker';
import { montarReciboDeLeitura } from './recibo-de-leitura';
import { Recibo } from './recibo';
import {
  ResolverCategorias,
  type RespostasDeCategoria,
} from './resolver-categorias';
import {
  fraseDeZero,
  ROTULO_DECISAO,
  type CategoriaDoCatalogo,
  type LoteAnterior,
  type Mapa,
  type OrigemDeArquivo,
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
export function TelaImportacao({ podeImportar, podeDesfazer, origens, categorias }: {
  /** Papéis que escrevem na base. A autorização de verdade é o RLS. */
  podeImportar: boolean;
  /**
   * Espelho de `app.is_manager()`: quem desfaz um lote (RF-BAS-17).
   *
   * Vem separado de `podeImportar` de propósito — quem importa (sdr) não desfaz,
   * e oferecer o botão a ela era o §3.7 do laudo.
   */
  podeDesfazer: boolean;
  /**
   * As fontes que entram por arquivo, para o seletor de origem do lote.
   * Nunca vazia: a página garante a planilha como último recurso.
   */
  origens: readonly OrigemDeArquivo[];
  /** As 19 categorias ativas, para a tela de resolver os nomes novos. */
  categorias: readonly CategoriaDoCatalogo[];
}) {
  const clienteDeConsultas = useQueryClient();

  // A planilha é o padrão ANTES de haver arquivo, e só isso: assim que o
  // cabeçalho é lido, quem decide é `detectarOrigem`. Errar aqui custou 19
  // fichas em 25/09/2026, e o padrão era exatamente este.
  const padrao = origens.find((o) => o.slug === 'planilha') ?? origens[0];
  const [origemId, setOrigemId] = useState<number>(padrao?.id ?? 0);
  const [deteccao, setDeteccao] = useState<OrigemDetectada | null>(null);
  // A escolha manual vence a detecção, e continua vencendo se a pessoa trocar
  // de coluna depois. Só trocar de arquivo zera as duas.
  const [origemEscolhidaAMao, setOrigemEscolhidaAMao] = useState(false);
  const [menuDeOrigemAberto, setMenuDeOrigemAberto] = useState(false);
  const escolhida = origens.find((o) => o.id === origemId) ?? padrao;
  const nomeDaOrigem = escolhida?.nome ?? '';

  const [etapa, setEtapa] = useState<Etapa>('arquivo');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [planilha, setPlanilha] = useState<PlanilhaLida | null>(null);
  const [mapa, setMapa] = useState<Mapa>({});
  const [sugestao, setSugestao] = useState<Sugestao>({ mapa: {}, motivos: {} });
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [recibo, setRecibo] = useState<TipoRecibo | null>(null);
  /**
   * Os nomes de categoria da FONTE que a pessoa mandou não importar.
   *
   * Ficam só aqui, e não no banco: "não importar estas linhas" é o mesmo que
   * apagar as linhas do arquivo antes de mandar — elas não viram `raw_capture`,
   * não viram candidato e não deixam rastro, porque nunca entraram. Escrever
   * isso no de-para seria inventar uma categoria "lixo" que contaminaria toda
   * lista futura daquela fonte.
   */
  const [naoImportar, setNaoImportar] = useState<readonly string[]>([]);
  /**
   * O passo das categorias já foi respondido (ou pulado) para esta prévia.
   *
   * É ele que separa o passo 2 do passo 3 (30/09/2026): com categoria nova na
   * lista, a pergunta vem ANTES da conferência, numa tela própria; respondida,
   * a conferência aparece já com as contagens certas.
   */
  const [categoriasFeitas, setCategoriasFeitas] = useState(false);
  const [ensinando, setEnsinando] = useState(false);

  const [passoDaLeitura, setPassoDaLeitura] = useState<'lendo' | 'abrindo' | 'varrendo' | null>(null);
  const [andamento, setAndamento] = useState<{ rotulo: string; feitas: number; total: number } | null>(null);
  const [falha, setFalha] = useState<Falha>(null);

  const trabalhador = useRef<Worker | null>(null);
  // O catálogo de fontes lido de dentro do `addEventListener` do worker, que é
  // registrado uma vez só: sem o ref, `lerArquivoEscolhido` fecharia sobre o
  // `origens` da primeira renderização.
  const origensRef = useRef(origens);
  useEffect(() => {
    origensRef.current = origens;
  }, [origens]);

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

  /**
   * As linhas com conteúdo, já no formato que o banco entende.
   *
   * Recebe planilha, mapa e origem por parâmetro, e não do estado, porque o
   * passo do mapa pode ser PULADO: quando o recibo não tem nada em dúvida, a
   * prévia é pedida dentro do próprio `addEventListener` do worker, antes de o
   * React ter aplicado `setPlanilha`/`setMapa`.
   */
  const montarLinhasDe = useCallback(
    (
      planilha: PlanilhaLida,
      mapa: Mapa,
      nomeDaOrigem: string,
      // SEM VALOR PADRÃO, de propósito: o corte de "não importar estas linhas"
      // já foi esquecido uma vez em `trocarOrigem`, e um `= []` silencioso faz
      // a prévia contar linhas que a gravação corta. Obrigando o argumento, o
      // typecheck recusa a próxima chamada distraída.
      fora: readonly string[],
    ): LinhaCrua[] =>
      // A montagem em si é pura e vive em `mapeamento.ts`, testada lá: prévia e
      // gravação passam pela MESMA função, e não por dois laços parecidos.
      montarLinhasDaPlanilha(planilha, mapa, nomeDaOrigem, fora),
    [],
  );

  const montarLinhas = useCallback((): LinhaCrua[] => {
    if (!planilha) return [];
    return montarLinhasDe(planilha, mapa, nomeDaOrigem, naoImportar);
  }, [montarLinhasDe, planilha, mapa, nomeDaOrigem, naoImportar]);

  const conferirCom = useCallback(async (
    planilha: PlanilhaLida,
    mapa: Mapa,
    nomeDaOrigem: string,
    /** Obrigatório pelo mesmo motivo de `montarLinhasDe`. */
    fora: readonly string[],
  ) => {
    const linhas = montarLinhasDe(planilha, mapa, nomeDaOrigem, fora);
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
        setAndamento({ rotulo: 'Vendo quem já está na base', feitas, total }),
      );
      setPrevia(resultado);
    } catch (erro) {
      setFalha({ causa: mensagemDoErro(erro) });
      setEtapa('mapa');
    } finally {
      setAndamento(null);
    }
  }, [montarLinhasDe]);

  const lerArquivoEscolhido = useCallback((escolhido: File) => {
    setFalha(null);
    setArquivo(escolhido);
    setPlanilha(null);
    setPrevia(null);
    setRecibo(null);
    setDeteccao(null);
    setOrigemEscolhidaAMao(false);
    setMenuDeOrigemAberto(false);
    setCategoriasFeitas(false);
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
      // A origem é DETECTADA depois de ler o arquivo, e só enquanto ninguém a
      // corrigiu à mão. O CSV do Maps traz `cid`, `plus_code` e `data_id`, que
      // planilha escrita por gente não tem.
      // Aplicar sem condição é correto, e não descuido: `lerArquivoEscolhido`
      // zera `origemEscolhidaAMao` antes de mandar o arquivo ao worker, e esta
      // resposta vem depois. Arquivo novo, leitura nova.
      const detectada = detectarOrigem(lida.cabecalho, origensRef.current);
      setDeteccao(detectada);
      if (detectada.origem) setOrigemId(detectada.origem.id);
      setPlanilha(lida);
      setSugestao(s);
      setMapa(s.mapa);

      // O passo do mapa só existe quando há PERGUNTA a fazer: campo
      // obrigatório sem coluna, ou coluna casada por semelhança. Nos dois CSV
      // do Maps de 25/09/2026 são 10 acertos por nome exato em 36 colunas — a
      // tela pedia 36 confirmações para não perguntar nada. Quando não há
      // dúvida, o recibo do que foi lido aparece junto da prévia, e quem
      // quiser mexer numa coluna volta por "ajustar as colunas".
      const recibo = montarReciboDeLeitura(lida, s.mapa, s, detectada.origem?.nome ?? '');
      if (recibo.precisaPerguntar) {
        setEtapa('mapa');
        return;
      }
      // Arquivo novo: `lerArquivoEscolhido` acabou de zerar `naoImportar`.
      void conferirCom(lida, s.mapa, detectada.origem?.nome ?? '', []);
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
  }, [conferirCom]);


  const conferir = useCallback(async () => {
    if (!planilha) return;
    await conferirCom(planilha, mapa, nomeDaOrigem, naoImportar);
  }, [conferirCom, planilha, mapa, nomeDaOrigem, naoImportar]);

  const importar = useCallback(async () => {
    const linhas = montarLinhas();
    if (linhas.length === 0 || !arquivo) return;

    // O rótulo é só o nome do arquivo: a lista de lotes e o recibo já mostram a
    // data ao lado, e repetir a hora dentro do nome deixa a linha ilegível.
    const rotulo = arquivo.name;
    setFalha(null);
    setAndamento({ rotulo: 'Criando os parceiros', feitas: 0, total: linhas.length });

    let loteId: string | null = null;
    try {
      loteId = await abrirLote(rotulo, origemId);
      const resultado = await gravar(loteId, linhas, (feitas, total) =>
        setAndamento({ rotulo: 'Criando os parceiros', feitas, total }),
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
        //
        // Mas a frase tem de ser a do MAIOR grupo, e não a da duplicata sempre:
        // no lote dos fotógrafos de 25/09/2026 nenhuma linha era duplicata, e a
        // tela afirmou o contrário do que tinha acabado de acontecer.
        toast.info(fraseDeZero(resultado.contagem));
      } else {
        toast.success(
          `${formatarNumero(criadas)} ${criadas === 1 ? 'virou parceiro' : 'viraram parceiro'}.`,
        );
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
  }, [arquivo, clienteDeConsultas, montarLinhas, origemId]);

  /**
   * As respostas da tela de resolver: ensina o que virou categoria, corta o que
   * não entra, e REFAZ a prévia.
   *
   * A prévia é refeita porque é ela que diz quantas viram parceiro — e a
   * resposta acabou de mudar isso. Mostrar a prévia velha ao lado das
   * categorias novas seria a mesma mentira que a tarefa 3 tirou da tela.
   */
  const aplicarCategorias = useCallback(
    async (respostas: RespostasDeCategoria) => {
      if (!planilha) return;
      const pares: Array<{ nome_na_fonte: string; categoria_id: number }> = [];
      const fora: string[] = [...naoImportar];
      for (const [nome, r] of Object.entries(respostas)) {
        if (r.tipo === 'categoria') pares.push({ nome_na_fonte: nome, categoria_id: r.categoriaId });
        else if (r.tipo === 'nao_importar' && !fora.includes(nome)) fora.push(nome);
      }
      setEnsinando(true);
      try {
        const gravadas = await ensinarCategorias(origemId, pares);
        setNaoImportar(fora);
        // Antes de refazer a conferência: com a prévia zerada enquanto ela é
        // refeita, o indicador voltaria ao passo 1 por um instante.
        setCategoriasFeitas(true);
        if (gravadas > 0) {
          toast.success(
            gravadas === 1
              ? '1 nome de categoria aprendido. Na próxima lista eu não pergunto.'
              : `${formatarNumero(gravadas)} nomes de categoria aprendidos. Na próxima lista eu não pergunto.`,
          );
        }
        await conferirCom(planilha, mapa, nomeDaOrigem, fora);
      } catch (erro) {
        setFalha({
          causa: mensagemDoErro(erro),
          comoResolver:
            'Nada foi gravado na base de parceiros: ensinar categoria só escreve no de-para da fonte.',
        });
      } finally {
        setEnsinando(false);
      }
    },
    [conferirCom, mapa, naoImportar, nomeDaOrigem, origemId, planilha],
  );

  /**
   * O "Continuar" do passo das categorias. Sem nenhuma resposta, só segue: o
   * que ficou em "decidir depois" vai para a Revisão, e não há nada a ensinar.
   */
  const continuarDasCategorias = useCallback(
    async (respostas: RespostasDeCategoria) => {
      const algumaResposta = Object.values(respostas).some((r) => r.tipo !== 'nao_sei');
      if (!algumaResposta) {
        setCategoriasFeitas(true);
        return;
      }
      await aplicarCategorias(respostas);
    },
    [aplicarCategorias],
  );

  /**
   * A escolha manual de origem vence a detecção — e, quando a prévia já está na
   * tela, ela é REFEITA: a origem decide qual mapa de categorias o banco
   * consulta, então a mesma lista com outra origem dá outro resultado. Mostrar
   * a prévia velha ao lado da origem nova seria a quarta mentira da tela.
   *
   * `naoImportar` VAI JUNTO, e não é detalhe: quem já tinha respondido "não
   * importar estas linhas" e depois corrigiu a origem no "não é?" via a prévia
   * contar de volta as linhas que ela acabara de tirar, enquanto `montarLinhas`
   * continuava cortando-as na gravação. A prévia prometia mais do que o botão
   * escreve — o defeito exato que esta rodada existe para matar —, e o aviso
   * "Fora desta importação, por sua escolha: X" ficava na tela contradizendo os
   * números logo abaixo. O corte é por nome de categoria do arquivo, e o nome
   * de categoria do arquivo não muda quando a origem muda.
   */
  const trocarOrigem = useCallback(
    (id: number) => {
      setOrigemId(id);
      setOrigemEscolhidaAMao(true);
      if (etapa !== 'previa' || !planilha) return;
      const nome = origens.find((o) => o.id === id)?.nome ?? '';
      // Outra origem, outro mapa de categorias: a pergunta pode mudar.
      setCategoriasFeitas(false);
      void conferirCom(planilha, mapa, nome, naoImportar);
    },
    [conferirCom, etapa, mapa, naoImportar, origens, planilha],
  );

  const recomecar = useCallback(() => {
    setEtapa('arquivo');
    setArquivo(null);
    setPlanilha(null);
    setPrevia(null);
    setRecibo(null);
    setMapa({});
    setFalha(null);
    setDeteccao(null);
    setNaoImportar([]);
    setCategoriasFeitas(false);
    setOrigemEscolhidaAMao(false);
    setMenuDeOrigemAberto(false);
    setOrigemId(padrao?.id ?? 0);
  }, [padrao?.id]);

  const pendentes = faltando(mapa, nomeDaOrigem);
  const podeConferir = planilha !== null && pendentes.length === 0;

  if (!podeImportar) {
    return (
      <div className="flex w-full flex-col gap-4">
        <Cabecalho />
        <ErroDaImportacao
          titulo="O seu acesso não traz listas para a base"
          causa="Quem traz gente de fora para dentro da base é gestor ou SDR."
          comoResolver="Fale com um gestor se você precisa disso."
        />
      </div>
    );
  }

  // Em que passo a pessoa está. Enquanto a conferência da primeira leitura não
  // volta, ela ainda está no passo do arquivo (é o arquivo que está sendo lido).
  const passo: PassoDaImportacao =
    etapa === 'recibo'
      ? 'pronto'
      : etapa !== 'previa' || (previa === null && !categoriasFeitas)
        ? 'arquivo'
        : previa !== null && previa.categoriasNovas.length > 0 && !categoriasFeitas
          ? 'categorias'
          : 'conferir';

  // TRABALHO, e não LEITURA: o passo das colunas mostra a grade do arquivo, de
  // quantas colunas ele tiver.
  return (
    <div className={cn(TRABALHO, 'flex flex-col gap-5')}>
      <Cabecalho />
      <Passos atual={passo} />

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

      {/* O arquivo, numa linha, em todo passo depois do primeiro: é a
          referência de "do que estamos falando" enquanto a pessoa decide. */}
      {planilha && (etapa === 'mapa' || etapa === 'previa') ? (
        <CartaoDoArquivo
          arquivo={arquivo}
          planilha={planilha}
          origens={origens}
          origemId={origemId}
          aoMudarOrigem={trocarOrigem}
          deteccao={deteccao}
          temColunaDeOrigem={mapa.origem !== undefined}
          menuAberto={menuDeOrigemAberto || origemEscolhidaAMao}
          aoAbrirMenu={() => setMenuDeOrigemAberto(true)}
          recibo={
            etapa === 'previa'
              ? montarReciboDeLeitura(planilha, mapa, sugestao, nomeDaOrigem)
              : null
          }
          aoTrocarArquivo={recomecar}
          aoAjustarColunas={etapa === 'previa' ? () => setEtapa('mapa') : undefined}
        />
      ) : null}

      {etapa === 'mapa' && planilha ? (
        <>
          <PassoMapa
            planilha={planilha}
            mapa={mapa}
            sugestao={sugestao}
            origemDoLote={nomeDaOrigem}
            aoMudar={setMapa}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="menta"
              disabled={!podeConferir}
              onClick={() => void conferir()}
              className="toque h-11 md:h-10 md:px-5"
            >
              Continuar
              <ArrowRight aria-hidden="true" />
            </Button>
            {pendentes.length > 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Escolha a coluna que falta para continuar.
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {etapa === 'previa' ? (
        andamento ? (
          <Progresso {...andamento} />
        ) : previa === null ? (
          <EsqueletoDaPrevia />
        ) : passo === 'categorias' ? (
          <ResolverCategorias
            categoriasNovas={previa.categoriasNovas}
            categorias={categorias}
            ocupado={ensinando}
            aoContinuar={(respostas) => void continuarDasCategorias(respostas)}
          />
        ) : (
          <PassoPrevia
            previa={previa}
            ocupado={ensinando}
            aoImportar={() => void importar()}
            aoVoltar={
              previa.categoriasNovas.length > 0 ? () => setCategoriasFeitas(false) : undefined
            }
            foraPorEscolha={naoImportar}
            aoTrazerDeVolta={() => {
              setNaoImportar([]);
              if (planilha) void conferirCom(planilha, mapa, nomeDaOrigem, []);
            }}
          />
        )
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
      <h1 className="font-heading text-[32px] leading-tight font-normal tracking-[-0.02em]">
        Importar lista
      </h1>
      <p className="max-w-[90ch] text-sm text-muted-foreground">
        Do Google Maps ou de uma planilha. Nada é gravado antes de você conferir.
      </p>
    </header>
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
  // Sem importação anterior, NADA aqui (29/09/2026). Havia um segundo estado vazio
  // logo abaixo da área de arquivo — ícone, título e parágrafo — repetindo o que a
  // própria área já diz ("escolha o arquivo... nada é gravado antes"). Duas caixas
  // dizendo a mesma coisa é exatamente o "muita informação junta" do Rafael.
  if (!lotes || lotes.length === 0) return null;

  return (
    <section
      aria-labelledby="lotes"
      className="sombra-base flex flex-col gap-2 rounded-xl bg-card p-5"
    >
      <h2 id="lotes" className="text-[15px] font-semibold tracking-[-0.01em]">
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
                  {lote.organizacoes === 1 ? 'parceiro' : 'parceiros'}
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
          rotuloConfirmar="Desfazer"
          descricao={
            <>
              <p>
                {confirmando.lote.organizacoes > 0 ? (
                  <>
                    <span className="font-medium text-foreground">{confirmando.lote.rotulo}</span>{' '}
                    trouxe{' '}
                    <span className="numerico">
                      {formatarNumero(confirmando.lote.organizacoes)}
                    </span>{' '}
                    {confirmando.lote.organizacoes === 1 ? 'parceiro' : 'parceiros'} para a base.
                    Saem os que ninguém tocou depois; os que já têm conversa registrada, mudança
                    de etapa, autorização ou ligação ficam de pé, e o CRM diz quantos foram.
                  </>
                ) : (
                  <>
                    <span className="font-medium text-foreground">{confirmando.lote.rotulo}</span>{' '}
                    não criou parceiro nenhum na base. O que sai são os nomes que ela deixou
                    esperando na Revisão.
                  </>
                )}
              </p>
              <p>
                Os nomes que ainda não foram decididos somem da Revisão junto. Para trazer tudo de
                volta, só mandando o arquivo outra vez.
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
