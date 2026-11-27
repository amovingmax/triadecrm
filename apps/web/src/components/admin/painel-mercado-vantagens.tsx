'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, CircleAlert, RefreshCw, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { DialogoComMotivo } from './dialogo-com-motivo';
import { CabecalhoDeSecao, Contagem, ErroDoPainel, EsqueletoLista, Vazio } from './estados';
import {
  CHAVE_DAS_VANTAGENS,
  aprovarImovel,
  carregarVantagens,
  decidirVantagem,
} from './mercado-vantagens-dados';
import { ligarIaClientes } from './mercado-dados';
import {
  CONSEQUENCIA_DE_VOLTAR,
  MOTIVO_SUGERIDO_DE_REPROVAR,
  MOTIVO_SUGERIDO_DE_VOLTAR,
  ROTULO_DA_SITUACAO,
  avisoDePortalNoTexto,
  baseDaConta,
  consequenciaDeAprovar,
  consequenciaDeReprovar,
  dataCurta,
  deOndeVeio,
  detalheDaSituacao,
  emUso,
  forcaNaTela,
  fraseDaRecusaDaVantagem,
  hojeEmNatal,
  iaUsaComClientes,
  lerParaIa,
  marcasNaTela,
  momentosNaTela,
  paraQuemServe,
  numerosNaTela,
  oQueMudou,
  pedeConferencia,
  porImovel,
  propostasTravadas,
  quandoAIaRecebe,
  quandoAIaUsa,
  quemMudouAChaveDaIa,
  resumoDaAprovacao,
  resumoDoImovel,
  resumoDoQueAIaRecebe,
  rotuloDeAprovar,
  temConferencia,
  textoDoVazio,
  totalParaAprovar,
  travaAprovacao,
  validadeNaTela,
  type ImovelComVantagens,
  type ImovelParaIa,
  type ResultadoDaAprovacao,
  type Situacao,
  type VantagemNaTela,
} from './mercado-vantagens-regras';
import { diaEMes, problemaDoMotivo, type DadosDoMercado } from './mercado-regras';

/**
 * Ajustes → Inteligência de mercado → Vantagens para a IA (etapa 6, 19/11/2026; só na
 * Imova, só admin e gestor, como todo Ajustes).
 *
 * Por imóvel da carteira, as vantagens que o motor propôs: o texto que a IA recebe, a
 * fonte citada de leve, quando a IA usa, a prova (números, de onde veio, data), a
 * validade, o "não diga" do imóvel e a situação. O dono aprova POR IMÓVEL
 * (`public.mercado_argumentos_aprovar_imovel`) e reprova uma vantagem com motivo
 * (`public.mercado_argumento_decidir`). Embaixo, "O que a IA recebe hoje", lido de
 * `public.mercado_vantagens_para_ia()`: é exatamente o que vai para a IA.
 *
 * O bloco busca os próprios dados: se a leitura das vantagens falhar, a coleta e as
 * fontes, acima e abaixo, continuam de pé.
 */
type Decisao = { tipo: 'reprovar' | 'voltar'; item: VantagemNaTela };

export function BlocoDasVantagens({
  dados,
  ligada,
  nomeDe,
}: {
  dados: DadosDoMercado;
  ligada: boolean;
  nomeDe: (id: string) => string | null;
}) {
  const cliente = useQueryClient();
  const consulta = useQuery({
    queryKey: CHAVE_DAS_VANTAGENS,
    queryFn: carregarVantagens,
    staleTime: 30_000,
  });
  const iaClientes = iaUsaComClientes(dados.chave);

  const [aprovando, setAprovando] = useState<ImovelComVantagens | null>(null);
  const [resultado, setResultado] = useState<ReturnType<typeof resumoDaAprovacao> | null>(null);
  const [decisao, setDecisao] = useState<Decisao | null>(null);
  const [recusa, setRecusa] = useState<string | null>(null);

  const atualizar = () => void cliente.invalidateQueries({ queryKey: CHAVE_DAS_VANTAGENS });

  const aprovar = useMutation({
    mutationFn: ({ im, confirmo }: { im: ImovelComVantagens; confirmo: boolean }) =>
      aprovarImovel(im.codigo, confirmo),
    onSuccess: (r: ResultadoDaAprovacao, { im }) => {
      if (!r.ok) {
        setRecusa(fraseDaRecusaDaVantagem(r.motivo));
        return;
      }
      atualizar();
      const textoDe = (id: string) => im.propostas.find((x) => x.v.id === id)?.v.texto ?? null;
      const resumo = resumoDaAprovacao(r, textoDe);
      if (resumo.foraDela.length > 0) {
        // Alguma ficou esperando: o diálogo mostra qual e por quê, em vez de um aviso
        // que some sozinho.
        setResultado(resumo);
        return;
      }
      setAprovando(null);
      toast.success(resumo.titulo, {
        description: !ligada
          ? 'A IA passa a usar quando a coleta for ligada.'
          : iaClientes
            ? 'A IA já pode usar com os clientes.'
            : 'Por enquanto a IA usa só nas conversas de treino.',
      });
    },
    onError: () => setRecusa(fraseDaRecusaDaVantagem(null)),
  });

  const [mudarIa, setMudarIa] = useState<boolean | null>(null);
  const mudarChaveDaIa = useMutation({
    mutationFn: ({ ligar, motivo }: { ligar: boolean; motivo: string }) =>
      ligarIaClientes(ligar, motivo),
    onSuccess: (r, { ligar }) => {
      if (!r.ok) {
        setRecusa(fraseDaRecusaDaVantagem(r.motivo));
        return;
      }
      setMudarIa(null);
      setRecusa(null);
      atualizar();
      toast.success(
        ligar
          ? 'A IA passa a usar as vantagens com clientes.'
          : 'A IA parou de usar as vantagens com clientes.',
        {
          description: ligar
            ? 'Desligue aqui mesmo quando quiser.'
            : 'Nas conversas de treino ela continua usando.',
        },
      );
    },
    onError: () => setRecusa(fraseDaRecusaDaVantagem(null)),
  });

  const decidir = useMutation({
    mutationFn: ({ d, motivo }: { d: Decisao; motivo: string }) =>
      decidirVantagem(d.item.v.id, d.tipo === 'reprovar' ? 'recusar' : 'voltar', motivo),
    onSuccess: (r, { d }) => {
      if (!r.ok) {
        setRecusa(fraseDaRecusaDaVantagem(r.motivo));
        return;
      }
      setDecisao(null);
      setRecusa(null);
      atualizar();
      toast.success(
        d.tipo === 'reprovar' ? 'Vantagem reprovada.' : 'Vantagem de volta às propostas.',
        {
          description:
            d.tipo === 'reprovar'
              ? emUso(d.item.situacao)
                ? 'A IA deixou de usar esta frase.'
                : 'Ela não vai para a IA.'
              : 'Ela só vai para a IA depois de aprovada.',
        },
      );
    },
    onError: () => setRecusa(fraseDaRecusaDaVantagem(null)),
  });

  const hoje = hojeEmNatal(new Date());
  const imoveis = consulta.data
    ? porImovel(consulta.data.vantagens, consulta.data.execucoes, consulta.data.carteira, hoje)
    : [];
  const total = totalParaAprovar(imoveis);
  const titulos = new Map(imoveis.map((im) => [im.codigo, im.titulo]));

  return (
    <section className="flex flex-col gap-5" aria-label="Vantagens para a IA">
      <CabecalhoDeSecao
        titulo="Vantagens para a IA"
        descricao="O que a IA pode contar aos clientes sobre cada imóvel nosso: a frase, o número, de onde veio e até quando vale. Nada vai para a IA sem aprovação de admin ou gestor."
        contagem={
          imoveis.length > 0 ? (
            <>
              <Contagem n={imoveis.length} rotulo={imoveis.length === 1 ? 'imóvel' : 'imóveis'} />
              {' · '}
              <Contagem n={total} rotulo="para aprovar" />
            </>
          ) : undefined
        }
      />
      <QuandoAIaRecebe
        ligada={ligada}
        iaClientes={iaClientes}
        quemMudou={quemMudouAChaveDaIa(dados.chave, nomeDe)}
        aoDecidir={() => {
          setRecusa(null);
          setMudarIa(!iaClientes);
        }}
      />

      {consulta.isPending ? (
        <EsqueletoLista linhas={4} colunas={2} />
      ) : consulta.isError ? (
        <ErroDoPainel
          causa="Não deu para ler as vantagens dos imóveis."
          aoTentar={() => void consulta.refetch()}
        />
      ) : imoveis.length === 0 ? (
        <Vazio
          titulo="Nenhuma vantagem ainda"
          texto={textoDoVazio({ coletaLigada: ligada, coletas: dados.coletas, agora: new Date() })}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {imoveis.map((im) => (
            <CartaoDoImovel
              key={im.codigo}
              im={im}
              hoje={hoje}
              dados={dados}
              nomeDe={nomeDe}
              aoAprovar={() => {
                setRecusa(null);
                setResultado(null);
                setAprovando(im);
              }}
              aoDecidir={(d) => {
                setRecusa(null);
                setDecisao(d);
              }}
            />
          ))}
        </div>
      )}

      {consulta.data ? (
        <OQueAIaRecebe
          paraIa={consulta.data.paraIa}
          titulos={titulos}
          avisos={avisosDaIa(consulta.data.vantagens)}
          ligada={ligada}
          hoje={hoje}
        />
      ) : null}

      {aprovando ? (
        <DialogoAprovar
          im={aprovando}
          hoje={hoje}
          ligada={ligada}
          iaClientes={iaClientes}
          ocupado={aprovar.isPending}
          erro={recusa}
          resultado={resultado}
          aoFechar={() => {
            setAprovando(null);
            setResultado(null);
            setRecusa(null);
          }}
          aoConfirmar={(confirmo) => {
            setRecusa(null);
            aprovar.mutate({ im: aprovando, confirmo });
          }}
        />
      ) : null}

      {mudarIa !== null ? (
        <DialogoComMotivo
          aberto
          aoFechar={() => {
            setMudarIa(null);
            setRecusa(null);
          }}
          titulo={
            mudarIa
              ? 'Ligar: a IA usa as vantagens com clientes'
              : 'Desligar: a IA para de usar com clientes'
          }
          descricao={
            <p>
              {mudarIa
                ? 'A partir de agora, a IA recebe as vantagens aprovadas em todas as conversas, não só nas de treino. Ela usa uma por mensagem, só quando o cliente dá a deixa, e nunca abre a conversa com dados.'
                : 'A IA para de receber as vantagens nas conversas com clientes na hora; nas conversas de treino continua recebendo. As aprovações ficam guardadas.'}
            </p>
          }
          rotuloConfirmar={mudarIa ? 'Ligar com clientes' : 'Desligar com clientes'}
          motivoInicial={
            mudarIa
              ? 'Testei as vantagens na conversa de treino e aprovo o uso com clientes.'
              : 'Pausar o uso das vantagens com clientes.'
          }
          validarMotivo={problemaDoMotivo}
          erro={recusa}
          ocupado={mudarChaveDaIa.isPending}
          aoConfirmar={(motivo) => {
            setRecusa(null);
            mudarChaveDaIa.mutate({ ligar: mudarIa, motivo });
          }}
        />
      ) : null}

      {decisao ? (
        <DialogoComMotivo
          aberto
          aoFechar={() => {
            setDecisao(null);
            setRecusa(null);
          }}
          titulo={decisao.tipo === 'reprovar' ? 'Reprovar esta vantagem' : 'Voltar para aprovação'}
          descricao={
            <>
              <blockquote className="border-l-2 border-foreground/20 pl-3 text-foreground">
                {decisao.item.v.texto}
              </blockquote>
              {(decisao.tipo === 'reprovar'
                ? consequenciaDeReprovar(decisao.item.situacao)
                : [CONSEQUENCIA_DE_VOLTAR]
              ).map((frase) => (
                <p key={frase}>{frase}</p>
              ))}
            </>
          }
          rotuloConfirmar={decisao.tipo === 'reprovar' ? 'Reprovar' : 'Voltar para aprovação'}
          motivoInicial={
            decisao.tipo === 'reprovar' ? MOTIVO_SUGERIDO_DE_REPROVAR : MOTIVO_SUGERIDO_DE_VOLTAR
          }
          validarMotivo={problemaDoMotivo}
          erro={recusa}
          ocupado={decidir.isPending}
          aoConfirmar={(motivo) => {
            setRecusa(null);
            decidir.mutate({ d: decisao, motivo });
          }}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Quando a IA recebe
// ---------------------------------------------------------------------------

function QuandoAIaRecebe({
  ligada,
  iaClientes,
  quemMudou,
  aoDecidir,
}: {
  ligada: boolean;
  iaClientes: boolean;
  quemMudou: string | null;
  aoDecidir: () => void;
}) {
  const { titulo, texto } = quandoAIaRecebe({ coletaLigada: ligada, iaClientes });
  return (
    <div className="sombra-base flex flex-col gap-2 rounded-xl bg-card p-4 md:p-5">
      <p className="flex items-center gap-2 font-medium">
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-2.5 shrink-0 rounded-full',
            ligada && iaClientes ? 'bg-foreground' : 'ring-2 ring-muted-foreground ring-inset',
          )}
        />
        {titulo}
      </p>
      <p className="max-w-[90ch] text-sm text-muted-foreground">{texto}</p>
      <p className="text-sm">
        IA usa as vantagens com clientes:{' '}
        <span className="font-medium">{iaClientes ? 'ligada' : 'desligada'}</span>.
        <span className="text-muted-foreground">
          {' '}
          {quemMudou ??
            (iaClientes ? null : 'Ela é ligada depois do teste nas conversas de treino.')}
        </span>
      </p>
      <div>
        <Button
          type="button"
          variant={iaClientes ? 'outline' : 'default'}
          size="sm"
          onClick={aoDecidir}
        >
          {iaClientes ? 'Desligar com clientes' : 'Ligar com clientes'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Um imóvel
// ---------------------------------------------------------------------------

function CartaoDoImovel({
  im,
  hoje,
  dados,
  nomeDe,
  aoAprovar,
  aoDecidir,
}: {
  im: ImovelComVantagens;
  hoje: string;
  dados: DadosDoMercado;
  nomeDe: (id: string) => string | null;
  aoAprovar: () => void;
  aoDecidir: (d: Decisao) => void;
}) {
  const ativas = [...im.propostas, ...im.emUso];
  const idTitulo = `imovel-${im.codigo}`;
  return (
    <article className="sombra-base rounded-xl bg-card" aria-labelledby={idTitulo}>
      <header className="flex flex-col gap-3 border-b border-hairline p-4 md:flex-row md:items-start md:justify-between md:px-5">
        <div className="min-w-0 space-y-0.5">
          <h3 id={idTitulo} className="flex flex-wrap items-baseline gap-x-2 text-base">
            <span className="numerico text-sm text-muted-foreground">{im.codigo}</span>
            <span className="font-medium [overflow-wrap:anywhere]">{im.titulo}</span>
          </h3>
          <p className="text-sm text-muted-foreground">
            {resumoDoImovel(im)}
            {im.ultimaConta ? ` · última conta em ${diaEMes(im.ultimaConta)}` : ''}
          </p>
        </div>
        {im.propostas.length > 0 ? (
          <Button className="toque h-11 w-full shrink-0 md:h-9 md:w-auto" onClick={aoAprovar}>
            <Check aria-hidden="true" />
            {rotuloDeAprovar(im)}
          </Button>
        ) : null}
      </header>

      {ativas.length === 0 && im.fora.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground md:px-5">
          Sem vantagem verdadeira agora: com este imóvel, a IA segue a conversa normal.
        </p>
      ) : null}

      {ativas.length > 0 ? (
        <ol className="divide-y divide-hairline">
          {ativas.map((item) => (
            <ItemDaVantagem
              key={item.v.id}
              item={item}
              hoje={hoje}
              dados={dados}
              nomeDe={nomeDe}
              aoDecidir={aoDecidir}
            />
          ))}
        </ol>
      ) : null}

      {im.fora.length > 0 ? (
        <details className="group border-t border-hairline">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-4 text-sm text-muted-foreground transition-colors hover:text-foreground md:min-h-10 md:px-5">
            <ChevronRight
              className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
            {im.fora.length === 1
              ? '1 vencida ou reprovada'
              : `${im.fora.length} vencidas ou reprovadas`}
          </summary>
          <ol className="divide-y divide-hairline border-t border-hairline">
            {im.fora.map((item) => (
              <ItemDaVantagem
                key={item.v.id}
                item={item}
                hoje={hoje}
                dados={dados}
                nomeDe={nomeDe}
                aoDecidir={aoDecidir}
              />
            ))}
          </ol>
        </details>
      ) : null}

      {im.naoDiga.length > 0 ? (
        <footer className="border-t border-hairline px-4 py-3 md:px-5">
          <p className="text-xs font-medium">A IA não diz sobre este imóvel</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {im.naoDiga.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </footer>
      ) : null}
    </article>
  );
}

function SeloDaSituacao({ situacao }: { situacao: Situacao }) {
  const Icone =
    situacao === 'renovada'
      ? RefreshCw
      : situacao === 'reprovada'
        ? X
        : situacao === 'aprovada'
          ? Check
          : null;
  return (
    <Badge
      variant={situacao === 'proposta' ? 'secondary' : 'outline'}
      className={cn(
        'h-6 gap-1 px-2 font-normal',
        (situacao === 'vencida' || situacao === 'reprovada') && 'text-muted-foreground',
      )}
    >
      {Icone ? <Icone aria-hidden="true" /> : null}
      {ROTULO_DA_SITUACAO[situacao]}
    </Badge>
  );
}

function ItemDaVantagem({
  item,
  hoje,
  dados,
  nomeDe,
  aoDecidir,
}: {
  item: VantagemNaTela;
  hoje: string;
  dados: DadosDoMercado;
  nomeDe: (id: string) => string | null;
  aoDecidir: (d: Decisao) => void;
}) {
  const { v, situacao } = item;
  const fora = situacao === 'vencida' || situacao === 'reprovada';
  const numeros = numerosNaTela(v.numeros);
  const base = baseDaConta(v);
  const mudanca = oQueMudou(v, situacao);
  const marcas = marcasNaTela(v.marcas);
  const portal = avisoDePortalNoTexto(v);
  const pode = situacao === 'proposta' || emUso(situacao);

  return (
    <li className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-6 md:px-5">
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <SeloDaSituacao situacao={situacao} />
          <span>{forcaNaTela(v.forca)}</span>
          {/* Na vencida e na reprovada, a validade não diz nada: o porquê vem embaixo. */}
          {fora ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span>{validadeNaTela(v.valido_ate, hoje)}</span>
            </>
          )}
        </div>

        <blockquote
          className={cn(
            'border-l-2 border-foreground/20 pl-3 text-[15px] leading-relaxed',
            fora && 'text-muted-foreground',
          )}
        >
          {v.texto}
        </blockquote>

        <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-sm md:grid-cols-[7.5rem_1fr]">
          <dt className="text-xs leading-5 text-muted-foreground">Cita de leve</dt>
          <dd className="min-w-0">{v.fonte_texto}</dd>
          <dt className="text-xs leading-5 text-muted-foreground">Quando a IA usa</dt>
          <dd className="min-w-0">
            <ul className="flex flex-wrap gap-x-1.5 gap-y-0.5" aria-label="Quando a IA usa">
              {momentosNaTela(v).map((m, i, todos) => (
                <li key={m}>
                  {m}
                  {i < todos.length - 1 ? (
                    <span aria-hidden="true" className="ml-1.5 text-muted-foreground">
                      ·
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </dd>
          {paraQuemServe(v).length > 0 ? (
            <>
              <dt className="text-xs leading-5 text-muted-foreground">Serve para</dt>
              <dd className="min-w-0">{paraQuemServe(v).join(' · ')}</dd>
            </>
          ) : null}
          {v.aviso ? (
            <>
              <dt className="text-xs leading-5 text-muted-foreground">Junto, a IA diz</dt>
              <dd className="min-w-0">{v.aviso}</dd>
            </>
          ) : null}
        </dl>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {detalheDaSituacao(v, situacao, hoje, nomeDe)}
        </p>

        {!fora && (marcas.length > 0 || portal) ? (
          <ul className="flex flex-col gap-1.5">
            {marcas.map((m) => (
              <li key={m.marca} className="flex items-start gap-2 text-sm">
                <CircleAlert
                  className={cn(
                    'mt-0.5 size-4 shrink-0',
                    m.trava ? 'text-destructive-texto' : 'text-muted-foreground',
                  )}
                  aria-hidden="true"
                />
                <span className={cn(m.trava && 'text-destructive-texto')}>{m.texto}</span>
              </li>
            ))}
            {portal ? (
              <li className="flex items-start gap-2 text-sm">
                <CircleAlert
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>{portal}</span>
              </li>
            ) : null}
          </ul>
        ) : null}

        {mudanca ? (
          <div className="rounded-lg bg-muted/60 p-3 text-sm">
            <p className="font-medium">
              {situacao === 'renovada'
                ? `O que mudou desde a aprovação de ${mudanca.desde}`
                : `O que mudou desde a última aprovação (${mudanca.desde})`}
            </p>
            {mudanca.numeros.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {mudanca.numeros.map((n) => (
                  <li key={n.rotulo} className="text-muted-foreground">
                    {n.rotulo}:{' '}
                    <span className="numerico text-foreground">
                      {n.antes ?? 'nada'} → {n.agora ?? 'nada'}
                    </span>
                    {n.variacao ? ` (${n.variacao})` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
            {mudanca.textoAntes ? (
              <p className="mt-1 text-muted-foreground">
                A frase aprovada era: “{mudanca.textoAntes}”
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="rounded-lg bg-muted/40 p-3 text-sm">
          <p className="text-xs font-medium">A prova</p>
          {numeros.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Os números da conta">
              {numeros.map((n) => (
                <li
                  key={n.chave}
                  className="rounded-md bg-card px-2 py-1 text-xs ring-1 ring-foreground/10"
                >
                  <span className="text-muted-foreground">{n.rotulo}:</span>{' '}
                  <span className="numerico">{n.valor}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1">
            <dt className="text-xs leading-5 text-muted-foreground">De onde veio</dt>
            <dd className="min-w-0">{deOndeVeio(v, dados.fontes)}</dd>
            {base ? (
              <>
                <dt className="text-xs leading-5 text-muted-foreground">Base</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere]">{base}</dd>
              </>
            ) : null}
            <dt className="text-xs leading-5 text-muted-foreground">Data do dado</dt>
            <dd className="min-w-0">
              {dataCurta(v.data_dado, hoje)}
              <span className="text-muted-foreground"> · lido em {diaEMes(v.coletado_em)}</span>
            </dd>
          </dl>
        </div>

        {pode ? (
          <Button
            variant="outline"
            size="sm"
            className="toque h-11 w-full md:h-8 md:w-fit md:self-end"
            onClick={() => aoDecidir({ tipo: 'reprovar', item })}
          >
            <X aria-hidden="true" />
            Reprovar
          </Button>
        ) : situacao === 'reprovada' ? (
          <Button
            variant="outline"
            size="sm"
            className="toque h-11 w-full md:h-8 md:w-fit md:self-end"
            onClick={() => aoDecidir({ tipo: 'voltar', item })}
          >
            <Undo2 aria-hidden="true" />
            Voltar para aprovação
          </Button>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Aprovar um imóvel
// ---------------------------------------------------------------------------

function DialogoAprovar({
  im,
  hoje,
  ligada,
  iaClientes,
  ocupado,
  erro,
  resultado,
  aoFechar,
  aoConfirmar,
}: {
  im: ImovelComVantagens;
  hoje: string;
  ligada: boolean;
  iaClientes: boolean;
  ocupado: boolean;
  erro: string | null;
  resultado: ReturnType<typeof resumoDaAprovacao> | null;
  aoFechar: () => void;
  aoConfirmar: (confirmoConferido: boolean) => void;
}) {
  const [conferi, setConferi] = useState(false);
  const aprovaveis = im.propostas.filter((x) => !travaAprovacao(x.v));
  const travadas = propostasTravadas(im);
  const conferencia = temConferencia(im);
  const n = aprovaveis.length;

  return (
    <Dialog open onOpenChange={(estado) => !estado && !ocupado && aoFechar()}>
      <DialogContent className="sm:max-w-lg">
        {resultado ? (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8">{resultado.titulo}</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2 text-left leading-relaxed">
                  <p>
                    {resultado.foraDela.length === 1
                      ? 'Esta ficou esperando:'
                      : `Estas ${resultado.foraDela.length} ficaram esperando:`}
                  </p>
                  <ul className="space-y-2">
                    {resultado.foraDela.map((x) => (
                      <li key={x.texto} className="space-y-0.5">
                        <p className="line-clamp-2 text-foreground">“{x.texto}”</p>
                        <p>{x.porque}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button type="button" onClick={aoFechar} className="toque h-11 md:h-9">
                Entendi
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8">
                {im.propostas.length === 1 ? 'Aprovar a vantagem de' : 'Aprovar as vantagens de'}{' '}
                {im.codigo}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2 text-left leading-relaxed">
                  {consequenciaDeAprovar(im, { coletaLigada: ligada, iaClientes, hoje }).map(
                    (f) => (
                      <p key={f}>{f}</p>
                    ),
                  )}
                </div>
              </DialogDescription>
            </DialogHeader>

            {n > 0 ? (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">O que passa a ir para a IA</p>
                <ol className="max-h-48 list-decimal space-y-1.5 overflow-y-auto pl-5 text-sm text-muted-foreground">
                  {aprovaveis.map((x) => (
                    <li key={x.v.id}>
                      {x.v.texto}
                      {pedeConferencia(x.v) ? (
                        <span className="text-foreground"> (pede conferência)</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {travadas.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Não podem ser aprovadas agora</p>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {travadas.map((t) => (
                    <li key={t.texto}>
                      <span className="line-clamp-2">“{t.texto}”</span> {t.porque}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {conferencia ? (
              <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md py-1.5 text-sm md:min-h-0">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={conferi}
                  onChange={(e) => setConferi(e.target.checked)}
                />
                <span className="flex flex-col">
                  <span className="font-medium">A equipe conferiu o anúncio comparado</span>
                  <span className="text-xs text-muted-foreground">
                    Ele é parecido de verdade com o nosso imóvel. Sem marcar, a que pede conferência
                    continua esperando e as outras são aprovadas.
                  </span>
                </span>
              </label>
            ) : null}

            {erro ? (
              <p role="alert" className="text-xs text-destructive-texto">
                {erro}
              </p>
            ) : null}

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={aoFechar}
                disabled={ocupado}
                className="toque h-11 md:h-9"
              >
                Voltar
              </Button>
              <Button
                type="button"
                onClick={() => aoConfirmar(conferi)}
                disabled={ocupado || n === 0}
                className="toque h-11 md:h-9"
              >
                {ocupado
                  ? 'Gravando...'
                  : n === 1
                    ? 'Aprovar a vantagem'
                    : `Aprovar ${n} vantagens`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// O que a IA recebe hoje
// ---------------------------------------------------------------------------

/** O aviso de cada vantagem por "código|chave": a IA o recebe junto com a frase. */
function avisosDaIa(
  vantagens: readonly { imovel_codigo: string; chave: string; aviso: string | null }[],
) {
  return new Map(
    vantagens
      .filter((v) => v.aviso && v.aviso.trim() !== '')
      .map((v) => [`${v.imovel_codigo}|${v.chave}`, (v.aviso as string).trim()]),
  );
}

function OQueAIaRecebe({
  paraIa,
  titulos,
  avisos,
  ligada,
  hoje,
}: {
  paraIa: unknown;
  titulos: Map<string, string>;
  /** O "Junto, a IA diz" de cada vantagem, que a IA recebe ao lado da frase. */
  avisos: Map<string, string>;
  ligada: boolean;
  hoje: string;
}) {
  const lista: ImovelParaIa[] = paraIa === null ? [] : lerParaIa(paraIa);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="mercado-para-ia">
      <header className="space-y-1">
        <h3 id="mercado-para-ia" className="text-sm font-semibold">
          O que a IA recebe hoje
          {lista.length > 0 ? (
            <span className="ml-2 font-normal text-muted-foreground">
              {resumoDoQueAIaRecebe(lista)}
            </span>
          ) : null}
        </h3>
        <p className="max-w-[90ch] text-xs text-muted-foreground">
          Exatamente o que vai para a IA agora: só o que está aprovado e dentro da validade, com o
          aviso de cada frase, sem a prova e sem o nome dos sites de onde vieram os anúncios.
        </p>
      </header>

      <div className="sombra-base rounded-xl bg-card px-4 py-1 md:px-5 md:py-2">
        {paraIa === null ? (
          <p className="py-3 text-sm text-muted-foreground">
            Não deu para ler o que a IA recebe agora. Atualize a tela; se continuar, avise no grupo
            do time.
          </p>
        ) : lista.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            {ligada
              ? 'Nada por enquanto: nenhuma vantagem aprovada está dentro da validade. Sem vantagem, a IA segue a conversa normal.'
              : 'Nada: com a coleta desligada, a IA não recebe nenhuma vantagem.'}
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {lista.map((im) => (
              <li key={im.codigo} className="flex flex-col gap-2 py-3">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="numerico text-sm text-muted-foreground">{im.codigo}</span>
                  <span className="font-medium">{titulos.get(im.codigo) ?? ''}</span>
                </p>
                <ol className="list-decimal space-y-2 pl-5 text-sm">
                  {im.diferenciais.map((d) => (
                    <li key={d.id || d.texto}>
                      <p>{d.texto}</p>
                      <p className="text-xs text-muted-foreground">
                        Cita {d.fonte || 'a pesquisa da Imova'} · {quandoAIaUsa(d)}
                        {d.valido_ate ? ` · vale até ${dataCurta(d.valido_ate, hoje)}` : ''}
                      </p>
                      {avisos.get(`${im.codigo}|${d.id}`) ? (
                        <p className="text-xs text-muted-foreground">
                          <span className="text-foreground">Junto, a IA diz:</span>{' '}
                          {avisos.get(`${im.codigo}|${d.id}`)}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
                {im.naoUse.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="text-foreground">Não diga:</span> {im.naoUse.join('; ')}.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {paraIa !== null && lista.length > 0 ? (
        <details className="group text-sm">
          <summary className="flex min-h-9 w-fit cursor-pointer list-none items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight
              className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
            Ver no formato que a IA lê
          </summary>
          <pre className="mt-2 max-h-96 overflow-y-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed break-words whitespace-pre-wrap">
            {JSON.stringify(paraIa, null, 2)}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
