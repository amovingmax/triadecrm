'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Lock, Power, PowerOff, RotateCw } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { carregarPessoas } from './dados';
import { DialogoComMotivo } from './dialogo-com-motivo';
import {
  Aviso,
  CabecalhoDeSecao,
  Contagem,
  ErroDoPainel,
  EsqueletoLista,
  ListaAdmin,
  type ColunaAdmin,
} from './estados';
import { CHAVE_DO_MERCADO, carregarMercado, liberarFonte, ligarColeta } from './mercado-dados';
import {
  CONSEQUENCIA_DE_DESLIGAR,
  CONSEQUENCIA_DE_LIGAR,
  ROTULO_DO_VEREDITO,
  avisoDaSaude,
  botaoDaFonte,
  coletaLigada,
  condicoesNaTela,
  consequenciaDaFonte,
  diaEMes,
  fontesPorGrupo,
  fraseDaRecusaDoMercado,
  horaCurta,
  limparTexto,
  motivoSugerido,
  motivoSugeridoDaColeta,
  nomeNaTela,
  porqueDaProibida,
  problemaDoMotivo,
  proximaColeta,
  quandoFoi,
  resumoDaUltimaColeta,
  resumoDasFontes,
  rotuloDaFrequencia,
  semLeituraAutomatica,
  situacaoDaFonte,
  type DadosDoMercado,
  type FonteDeMercado,
} from './mercado-regras';

/**
 * Ajustes → Inteligência de mercado (19/11/2026, só na Imova; só admin e gestor,
 * como todo Ajustes).
 *
 * O dono libera as fontes e liga a coleta com o PRÓPRIO login: até aqui, as duas
 * coisas só mudavam por SQL. Duas partes:
 *   - COLETA: ligada ou desligada, quem mudou e quando, a última rodada e a próxima,
 *     e o botão que liga ou desliga (`public.mercado_coleta_ligar`);
 *   - FONTES: as 55 da auditoria, por grupo, com o veredito em palavras simples, a
 *     situação, as condições recolhidas e o botão de liberar ou recolher
 *     (`public.mercado_fonte_liberar`). A proibida mostra o cadeado e o porquê, sem
 *     botão; a que a auditoria mandou reconferir fica com o botão desligado.
 *
 * Toda decisão pede motivo (fica no `audit_log`) e o diálogo conta a consequência.
 * Nenhum nome de portal aparece: os textos do banco passam por `mercado-regras`.
 */
type Decisao =
  { tipo: 'coleta'; ligar: boolean } | { tipo: 'fonte'; fonte: FonteDeMercado; liberar: boolean };

export function PainelMercado() {
  const cliente = useQueryClient();
  const consulta = useQuery({
    queryKey: CHAVE_DO_MERCADO,
    queryFn: carregarMercado,
    staleTime: 30_000,
  });
  // O nome de quem liberou sai do diretório do time, como na LGPD.
  const pessoas = useQuery({ queryKey: ['admin', 'pessoas'], queryFn: carregarPessoas });
  const nomes = new Map((pessoas.data?.pessoas ?? []).map((p) => [p.id, p.nome]));
  const nomeDe = (id: string) => nomes.get(id) ?? null;

  const [decisao, setDecisao] = useState<Decisao | null>(null);
  const [recusa, setRecusa] = useState<string | null>(null);

  const decidir = useMutation({
    mutationFn: async ({ d, motivo }: { d: Decisao; motivo: string }) =>
      d.tipo === 'coleta'
        ? ligarColeta(d.ligar, motivo)
        : liberarFonte(d.fonte.id, d.liberar, motivo),
    onSuccess: (resultado, { d }) => {
      if (!resultado.ok) {
        setRecusa(fraseDaRecusaDoMercado(resultado.motivo));
        return;
      }
      setDecisao(null);
      setRecusa(null);
      void cliente.invalidateQueries({ queryKey: CHAVE_DO_MERCADO });
      if (d.tipo === 'coleta') {
        if (!resultado.mudou) {
          toast.info(d.ligar ? 'A coleta já estava ligada.' : 'A coleta já estava desligada.', {
            description: 'Outra pessoa mudou antes. A tela foi atualizada.',
          });
        } else if (d.ligar) {
          toast.success('Coleta ligada.', {
            description: `A próxima rodada é na ${quandoFoi(proximaColeta(new Date()).toISOString())}.`,
          });
        } else {
          toast.success('Coleta desligada.', { description: CONSEQUENCIA_DE_DESLIGAR });
        }
        return;
      }
      const nome = nomeNaTela(d.fonte);
      toast.success(d.liberar ? `“${nome}” liberada.` : `“${nome}” recolhida.`, {
        description: d.liberar
          ? 'Ela entra na próxima coleta, se a coleta estiver ligada.'
          : 'O robô deixa de ler esta fonte.',
      });
    },
    onError: () => setRecusa(fraseDaRecusaDoMercado(null)),
  });

  if (consulta.isPending) return <EsqueletoLista linhas={6} colunas={3} />;
  if (consulta.isError) {
    return (
      <ErroDoPainel
        causa="Não deu para ler as fontes e a coleta de mercado."
        aoTentar={() => void consulta.refetch()}
      />
    );
  }

  const dados = consulta.data;
  const ligada = coletaLigada(dados.chave);
  const abrir = (d: Decisao) => {
    setRecusa(null);
    setDecisao(d);
  };

  return (
    <div className="flex flex-col gap-8">
      <BlocoDaColeta
        dados={dados}
        ligada={ligada}
        nomeDe={nomeDe}
        atualizando={consulta.isFetching}
        aoAtualizar={() => void consulta.refetch()}
        aoDecidir={() => abrir({ tipo: 'coleta', ligar: !ligada })}
      />
      <BlocoDasFontes
        dados={dados}
        nomeDe={nomeDe}
        aoDecidir={(fonte, liberar) => abrir({ tipo: 'fonte', fonte, liberar })}
      />

      {decisao ? (
        <DialogoComMotivo
          aberto
          aoFechar={() => {
            setDecisao(null);
            setRecusa(null);
          }}
          {...textosDoDialogo(decisao, ligada)}
          validarMotivo={problemaDoMotivo}
          erro={recusa}
          ocupado={decidir.isPending}
          aoConfirmar={(motivo) => {
            setRecusa(null);
            decidir.mutate({ d: decisao, motivo });
          }}
        />
      ) : null}
    </div>
  );
}

function textosDoDialogo(
  d: Decisao,
  ligadaAgora: boolean,
): { titulo: string; descricao: React.ReactNode; rotuloConfirmar: string; motivoInicial: string } {
  if (d.tipo === 'coleta') {
    return {
      titulo: d.ligar ? 'Ligar a coleta' : 'Desligar a coleta',
      descricao: <p>{d.ligar ? CONSEQUENCIA_DE_LIGAR : CONSEQUENCIA_DE_DESLIGAR}</p>,
      rotuloConfirmar: d.ligar ? 'Ligar a coleta' : 'Desligar a coleta',
      motivoInicial: motivoSugeridoDaColeta(d.ligar),
    };
  }
  const { fonte, liberar } = d;
  const condicoes = liberar && fonte.veredito === 'CONDICIONAL' ? condicoesNaTela(fonte) : [];
  return {
    titulo: `${liberar ? 'Liberar' : 'Recolher'} “${nomeNaTela(fonte)}”`,
    descricao: (
      <>
        {consequenciaDaFonte(fonte, liberar, ligadaAgora).map((frase) => (
          <p key={frase}>{frase}</p>
        ))}
        {condicoes.length > 0 ? (
          <>
            <p className="font-medium text-foreground">As condições que o robô segue:</p>
            <ul className="list-disc space-y-1 pl-5">
              {condicoes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        ) : null}
      </>
    ),
    rotuloConfirmar: liberar ? 'Liberar a fonte' : 'Recolher a fonte',
    motivoInicial: motivoSugerido(fonte, liberar),
  };
}

// ---------------------------------------------------------------------------
// Coleta
// ---------------------------------------------------------------------------

function BlocoDaColeta({
  dados,
  ligada,
  nomeDe,
  atualizando,
  aoAtualizar,
  aoDecidir,
}: {
  dados: DadosDoMercado;
  ligada: boolean;
  nomeDe: (id: string) => string | null;
  atualizando: boolean;
  aoAtualizar: () => void;
  aoDecidir: () => void;
}) {
  const { chave } = dados;
  const ultima = resumoDaUltimaColeta(dados.coletas);
  const quem = chave?.mudou_por ? (nomeDe(chave.mudou_por) ?? 'alguém da equipe') : null;
  const motivo = limparTexto(chave?.motivo ?? null);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="mercado-coleta">
      <CabecalhoDeSecao
        titulo="Coleta"
        descricao="O robô que lê as fontes liberadas duas vezes por semana e guarda o que acha para a Inteligência de mercado e para a IA que atende."
        acao={
          <Button
            variant="outline"
            size="sm"
            className="toque h-11 md:h-9"
            onClick={aoAtualizar}
            disabled={atualizando}
          >
            <RotateCw className={cn(atualizando && 'animate-spin')} aria-hidden="true" />
            Atualizar
          </Button>
        }
      />
      <div className="sombra-base flex flex-col gap-4 rounded-xl bg-card p-4 md:flex-row md:items-start md:justify-between md:p-5">
        <div className="min-w-0 space-y-2">
          <p id="mercado-coleta" className="flex items-center gap-2 text-lg font-medium">
            <span
              aria-hidden="true"
              className={cn(
                'inline-block size-2.5 rounded-full',
                ligada ? 'bg-foreground' : 'ring-2 ring-muted-foreground ring-inset',
              )}
            />
            {ligada ? 'Coleta ligada' : 'Coleta desligada'}
          </p>
          {quem && chave?.mudou_em ? (
            <p className="text-sm text-muted-foreground">
              {ligada ? 'Ligada' : 'Desligada'} por {quem} em {diaEMes(chave.mudou_em)}, às{' '}
              {horaCurta(chave.mudou_em)}
              {motivo ? <>: “{motivo}”</> : '.'}
            </p>
          ) : null}
          <p className="text-sm">
            {ultima.tipo === 'nenhuma' ? (
              'Nenhuma coleta feita ainda.'
            ) : (
              <>
                Última coleta: {ultima.quando} ·{' '}
                <Contagem n={ultima.fontes} rotulo={ultima.fontes === 1 ? 'fonte' : 'fontes'} />
                {ultima.comErro > 0 ? <>, {ultima.comErro} com erro</> : null}
                {ultima.rodando > 0 ? <>, {ultima.rodando} sendo lidas agora</> : null}.
              </>
            )}
          </p>
          {ligada ? (
            <p className="text-sm">
              Próxima: {quandoFoi(proximaColeta(new Date()).toISOString())}.
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">{resumoDasFontes(dados.fontes)}</p>
          {!dados.roboUltimoSinal ? (
            <p className="max-w-prose text-sm text-muted-foreground">
              O robô da coleta ainda não deu sinal no servidor. Ligar deixa tudo pronto: a coleta
              começa na primeira segunda ou quinta depois que ele estiver no ar.
            </p>
          ) : null}
        </div>
        <Button
          variant={ligada ? 'outline' : 'default'}
          className="toque h-11 shrink-0 md:h-9"
          onClick={aoDecidir}
        >
          {ligada ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
          {ligada ? 'Desligar a coleta' : 'Ligar a coleta'}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fontes
// ---------------------------------------------------------------------------

function BlocoDasFontes({
  dados,
  nomeDe,
  aoDecidir,
}: {
  dados: DadosDoMercado;
  nomeDe: (id: string) => string | null;
  aoDecidir: (fonte: FonteDeMercado, liberar: boolean) => void;
}) {
  const grupos = fontesPorGrupo(dados.fontes);
  const saude = new Map(dados.saude.map((s) => [s.fonte, s.estado]));
  const liberadas = dados.fontes.filter((f) => f.liberada && f.veredito !== 'PROIBIDA').length;

  const colunas: ColunaAdmin<FonteDeMercado>[] = [
    {
      id: 'fonte',
      rotulo: 'Fonte',
      principal: true,
      largura: 'w-[44%]',
      celula: (f) => <CelulaDaFonte fonte={f} aviso={avisoDaSaude(saude.get(f.id))} />,
    },
    {
      id: 'veredito',
      rotulo: 'Veredito',
      largura: 'w-36',
      celula: (f) => (
        <Badge
          variant={f.veredito === 'PROIBIDA' ? 'secondary' : 'outline'}
          className="h-6 gap-1 px-2 font-normal"
        >
          {f.veredito === 'PROIBIDA' ? <Lock aria-hidden="true" /> : null}
          {ROTULO_DO_VEREDITO[f.veredito]}
        </Badge>
      ),
    },
    {
      id: 'situacao',
      rotulo: 'Situação',
      celula: (f) => <CelulaDaSituacao fonte={f} nomeDe={nomeDe} />,
    },
  ];

  return (
    <section className="flex flex-col gap-5">
      <CabecalhoDeSecao
        titulo="Fontes"
        descricao="Só as fontes liberadas são lidas. As proibidas ficam na lista para todo mundo saber por quê: o robô nunca acessa nenhuma delas."
        contagem={
          <>
            <Contagem n={dados.fontes.length} rotulo="fontes" />
            {' · '}
            <Contagem n={liberadas} rotulo={liberadas === 1 ? 'liberada' : 'liberadas'} />
          </>
        }
      />
      {grupos.map(({ grupo, fontes }) => (
        <div key={grupo.id} className="flex flex-col gap-2">
          <div>
            <h3 className="text-sm font-semibold">{grupo.rotulo}</h3>
            <p className="text-xs text-muted-foreground">{grupo.descricao}</p>
          </div>
          <ListaAdmin
            colunas={colunas}
            linhas={fontes}
            chave={(f) => f.id}
            rotuloDaLista={`Fontes: ${grupo.rotulo}`}
            larguraDasAcoes="w-32"
            acoes={(f) => <AcaoDaFonte fonte={f} aoDecidir={aoDecidir} />}
          />
        </div>
      ))}
      <Aviso titulo="Quem decide e onde fica registrado">
        <p>
          Liberar, recolher, ligar e desligar são de admin e gestor. Cada decisão fica na Auditoria
          (Ajustes → LGPD), com quem decidiu, quando e o motivo.
        </p>
        <p className="mt-2">
          O veredito de cada fonte veio da auditoria de 18/11, que leu as regras de uso de cada
          site, uma por uma. Fonte proibida não se libera por aqui.
        </p>
      </Aviso>
    </section>
  );
}

function CelulaDaFonte({ fonte, aviso }: { fonte: FonteDeMercado; aviso: string | null }) {
  const condicoes = condicoesNaTela(fonte);
  const oQueTraz = limparTexto(fonte.tipo_de_dado);
  const motivo = limparTexto(fonte.liberada_motivo);
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="font-medium [overflow-wrap:anywhere]">{nomeNaTela(fonte)}</span>
      {aviso ? <span className="text-xs font-normal text-destructive-texto">{aviso}</span> : null}
      <details className="group text-xs font-normal">
        <summary className="flex min-h-9 w-fit cursor-pointer list-none items-center gap-1 text-muted-foreground transition-colors hover:text-foreground md:min-h-7">
          <ChevronRight
            className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
          ver condições
        </summary>
        <div className="mt-1 space-y-2 pl-[1.125rem] leading-relaxed text-muted-foreground">
          {oQueTraz ? (
            <p>
              <span className="text-foreground">O que traz:</span> {oQueTraz}
            </p>
          ) : null}
          {fonte.veredito !== 'PROIBIDA' ? (
            <p>
              <span className="text-foreground">Com que frequência:</span>{' '}
              {rotuloDaFrequencia(fonte.frequencia)}
            </p>
          ) : null}
          {condicoes.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4">
              {condicoes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : (
            <p>Sem condições além do ritmo e da citação da fonte.</p>
          )}
          {motivo && fonte.veredito !== 'PROIBIDA' ? (
            <p>
              <span className="text-foreground">Motivo da última decisão:</span> {motivo}
            </p>
          ) : null}
        </div>
      </details>
    </span>
  );
}

function CelulaDaSituacao({
  fonte,
  nomeDe,
}: {
  fonte: FonteDeMercado;
  nomeDe: (id: string) => string | null;
}) {
  if (fonte.veredito === 'PROIBIDA') {
    return (
      <span className="flex items-start gap-1.5">
        <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="leading-snug">
          <span className="sr-only">Proibida: </span>
          {porqueDaProibida(fonte)}
        </span>
      </span>
    );
  }
  const situacao = situacaoDaFonte(fonte, nomeDe);
  const botao = botaoDaFonte(fonte);
  return (
    <span className="flex flex-col gap-0.5">
      <span className={cn(situacao.tom === 'liberada' ? 'font-medium' : 'text-muted-foreground')}>
        {situacao.texto}
      </span>
      {botao.tipo !== 'cadeado' && botao.explicacao ? (
        <span className="text-xs leading-snug text-muted-foreground">{botao.explicacao}</span>
      ) : null}
      {fonte.liberada && semLeituraAutomatica(fonte) ? (
        <span className="text-xs leading-snug text-muted-foreground">
          O robô ainda não sabe ler esta fonte sozinho.
        </span>
      ) : null}
    </span>
  );
}

function AcaoDaFonte({
  fonte,
  aoDecidir,
}: {
  fonte: FonteDeMercado;
  aoDecidir: (fonte: FonteDeMercado, liberar: boolean) => void;
}) {
  const botao = botaoDaFonte(fonte);
  // A proibida não tem botão: o cadeado e o porquê já estão na situação.
  if (botao.tipo === 'cadeado') return null;
  const liberar = botao.tipo === 'liberar';
  return (
    <Button
      variant={liberar ? 'default' : 'outline'}
      size="sm"
      className="toque h-11 md:h-8"
      // A explicação do botão desligado fica escrita na situação, ao lado.
      disabled={botao.desabilitado}
      onClick={() => aoDecidir(fonte, liberar)}
    >
      {liberar ? 'Liberar' : 'Recolher'}
    </Button>
  );
}
