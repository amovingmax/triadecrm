'use client';

import { useState } from 'react';
import { Camera, ChevronDown, Pencil, Undo2 } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CANAIS_DE_CHEGADA,
  ROTULO_DO_CANAL,
  ROTULO_DO_SUBCANAL,
  type CanalDeChegada,
  type SubcanalDeChegada,
} from '@komune/schema';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { CHAVE_CANAIS, marcarCanal, useCanais } from './canal-de-chegada-dados';
import {
  APARENCIA_DO_CANAL,
  automaticaEra,
  canalDaFicha,
  canalNoTopo,
  chegadasNaFicha,
  coresDoCanal,
  dataCompleta,
  IDENTIFICANDO,
  linhaDoCanal,
  porcentagem,
  porqueDoCanal,
  ROTULO_DA_EVIDENCIA,
  rotuloDaFoto,
  rotuloDoSubcanal,
  subcanaisParaEscolher,
  type ChegadaDaConversa,
} from './canal-de-chegada-regra';
import { ROTULO_DA_SECAO } from './fio-wpp';

/**
 * O canal de chegada do lead (06/11/2026, só Imova): o chip na lista, o chip no
 * topo da conversa (que abre o porquê e a correção) e o bloco "Como chegou" dos
 * dados do contato.
 *
 * A ETIQUETA MOSTRA SÓ O CANAL (decisão do Rafael, 06/11/2026). O subcanal, a
 * frase do porquê, os trechos que provam e a foto descrita aparecem ao tocar.
 * Corrigir é de quem atende (admin, gestor, SDR): fica no histórico do banco, a
 * IA nunca desfaz, e NADA é enviado ao cliente.
 */

type Tamanho = 'lista' | 'topo';

const TAMANHO: Record<Tamanho, { caixa: string; icone: string }> = {
  lista: { caixa: 'h-4 gap-1 px-1.5 text-[10px]', icone: 'size-2.5' },
  topo: { caixa: 'h-7 gap-1.5 px-2.5 text-[12px]', icone: 'size-3.5' },
};

/** O chip do canal, só com o canal: "Placa", "Anúncios". */
export function ChipDoCanal({
  canal,
  tamanho = 'lista',
  comSeta = false,
  className,
}: {
  canal: CanalDeChegada;
  tamanho?: Tamanho;
  /** No topo, para quem pode corrigir: o chip abre um menu. */
  comSeta?: boolean;
  className?: string;
}) {
  const { rotulo, icone: Icone } = APARENCIA_DO_CANAL[canal];
  const medidas = TAMANHO[tamanho];
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center truncate rounded-full leading-none font-medium',
        medidas.caixa,
        className,
      )}
      style={coresDoCanal(canal)}
    >
      <Icone className={cn('shrink-0', medidas.icone)} aria-hidden="true" />
      {rotulo}
      {comSeta ? <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" /> : null}
    </span>
  );
}

/**
 * O canal na linha miúda das etiquetas, junto da atitude. A lista não mostra
 * "Não identificado" nem "identificando…": quem decide isso é `canalNaLista`.
 */
export function CanalNaLista({ canal }: { canal: CanalDeChegada | null }) {
  if (!canal) return null;
  return (
    <span title={`Chegou por: ${ROTULO_DO_CANAL[canal]}`} className="inline-flex min-w-0 shrink-0">
      <ChipDoCanal canal={canal} />
    </span>
  );
}

/** O gatilho do topo e da folha, nos três estados que o topo conhece. */
function Gatilho({
  chegada,
  tamanho,
  comSeta,
}: {
  chegada: ChegadaDaConversa;
  tamanho: Tamanho;
  comSeta: boolean;
}) {
  const estado = canalNoTopo(chegada);
  if (estado.tipo === 'canal' && !estado.discreto) {
    return <ChipDoCanal canal={estado.canal} tamanho={tamanho} comSeta={comSeta} />;
  }
  // "Não identificado" e "identificando…" ficam no cinza, com borda tracejada:
  // é estado, não etiqueta.
  const Icone =
    estado.tipo === 'identificando'
      ? IDENTIFICANDO.icone
      : APARENCIA_DO_CANAL.nao_identificado.icone;
  const medidas = TAMANHO[tamanho];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border border-dashed border-wpp-linha-forte leading-none text-wpp-suave',
        medidas.caixa,
      )}
    >
      <Icone className={cn('shrink-0', medidas.icone)} aria-hidden="true" />
      {estado.tipo === 'identificando' ? IDENTIFICANDO.rotulo : ROTULO_DO_CANAL.nao_identificado}
      {comSeta ? <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" /> : null}
    </span>
  );
}

/**
 * O que se sabe da chegada: o canal com o subcanal, o porquê, os trechos que
 * provam, a foto descrita (nunca a imagem) e, depois de uma correção, o que a
 * automática dizia.
 */
export function DetalheDoCanal({ chegada }: { chegada: ChegadaDaConversa }) {
  const { canal, subcanal, foto } = chegada;
  const detalhe = canal ? rotuloDoSubcanal(canal, subcanal) : null;
  const era = automaticaEra(chegada);
  // A foto tem bloco próprio; o trecho dela não se repete na lista.
  const provas = chegada.evidencias.filter((e) => !(foto && e.tipo === 'foto'));
  const palpite =
    chegada.palpite && (canal === null || canal === 'nao_identificado') ? chegada.palpite : null;

  return (
    <div className="flex min-w-0 flex-col gap-2 text-[13px] leading-snug">
      {/* O chip é só o canal; o detalhe (subcanal) vem ao lado, por extenso. */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Gatilho chegada={chegada} tamanho="topo" comSeta={false} />
        {detalhe ? <span className="font-medium">{detalhe}</span> : null}
      </p>
      <p className="text-wpp-suave">{porqueDoCanal(chegada)}</p>

      {provas.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="O que mostra o canal">
          {provas.map((e, i) => (
            <li
              key={`${e.mensagemId ?? 'sem'}-${i}`}
              className="rounded-lg bg-wpp-chip px-2.5 py-1.5 text-[12.5px] text-wpp-chip-texto"
            >
              <span className="font-medium">{ROTULO_DA_EVIDENCIA[e.tipo]}: </span>
              {e.tipo === 'texto' ? `“${e.trecho}”` : e.trecho}
            </li>
          ))}
        </ul>
      ) : null}

      {foto ? (
        <div className="flex items-start gap-2 rounded-lg bg-wpp-chip px-2.5 py-1.5 text-[12.5px] text-wpp-chip-texto">
          <Camera className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block font-medium">{rotuloDaFoto(foto)}</span>
            {foto.descricao ? <span className="block opacity-80">{foto.descricao}</span> : null}
          </span>
        </div>
      ) : null}

      {palpite ? (
        <p className="text-[12px] text-wpp-suave">
          A IA achou que podia ser {ROTULO_DO_CANAL[palpite.canal].toLowerCase()}
          {palpite.confianca !== null ? ` (${porcentagem(palpite.confianca)})` : ''}, mas sem
          certeza bastante para marcar.
        </p>
      ) : null}
      {era ? <p className="text-[12px] text-wpp-suave">A automática dizia: {era}.</p> : null}
      <p className="text-[11px] text-wpp-suave">
        Chegou em <span className="numerico">{dataCompleta(chegada.inicioEm)}</span>
        {chegada.situacao === 'lendo' && !chegada.marcada
          ? ' · ainda pode mudar nas primeiras 24 h'
          : ''}
      </p>
    </div>
  );
}

/**
 * Corrigir: escolher o canal e, se quiser, o detalhe; ou voltar para a
 * automática. Sem detalhe, o banco escolhe (o automático, se for do mesmo canal).
 */
export function CorrigirCanal({
  chegada,
  aoTerminar,
  aoCancelar,
}: {
  chegada: ChegadaDaConversa;
  aoTerminar: () => void;
  aoCancelar?: () => void;
}) {
  const clientes = useQueryClient();
  const [canal, setCanal] = useState<CanalDeChegada | null>(chegada.canal);
  const [subcanal, setSubcanal] = useState<SubcanalDeChegada | null>(chegada.subcanal);

  const marcar = useMutation({
    mutationFn: (escolha: { canal: CanalDeChegada | null; subcanal: SubcanalDeChegada | null }) =>
      marcarCanal(chegada.id, escolha.canal, escolha.subcanal),
    onSuccess: (_, escolha) => {
      // A ficha lê as chegadas no servidor: ela mostra a correção na próxima vez que abrir.
      void clientes.invalidateQueries({ queryKey: CHAVE_CANAIS });
      toast.success(escolha.canal ? 'Canal corrigido.' : 'Voltou para a automática.', {
        description: 'Fica no histórico. Nada foi enviado ao cliente.',
      });
      aoTerminar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não deu para gravar.'),
  });

  const subcanais = canal ? subcanaisParaEscolher(canal) : [];
  const igualAoQueVale = canal === chegada.canal && subcanal === chegada.subcanal;
  // Escolher o mesmo que a automática disse CONFIRMA: vira decisão de gente, e a
  // IA não muda mais. Igual ao que a própria pessoa já marcou, não há o que gravar.
  const nadaMudou = igualAoQueVale && chegada.marcada !== null;
  const era = automaticaEra(chegada);

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-xs font-medium text-wpp-suave">Por onde chegou</legend>
        <div className="flex flex-wrap gap-1.5">
          {CANAIS_DE_CHEGADA.map((c) => (
            <Opcao
              key={c}
              ativa={c === canal}
              disabled={marcar.isPending}
              onClick={() => {
                setCanal(c);
                setSubcanal(c === chegada.canal ? chegada.subcanal : null);
              }}
            >
              {ROTULO_DO_CANAL[c]}
            </Opcao>
          ))}
        </div>
      </fieldset>

      {subcanais.length > 0 ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium text-wpp-suave">
            Detalhe <span className="font-normal">(opcional)</span>
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {subcanais.map((s) => (
              <Opcao
                key={s}
                ativa={s === subcanal}
                disabled={marcar.isPending}
                // Tocar de novo no escolhido desmarca: o banco escolhe.
                onClick={() => setSubcanal(s === subcanal ? null : s)}
              >
                {ROTULO_DO_SUBCANAL[s]}
              </Opcao>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {chegada.marcada ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="toque mr-auto h-9 text-wpp-suave md:h-7"
            disabled={marcar.isPending}
            onClick={() => marcar.mutate({ canal: null, subcanal: null })}
            title={era ? `A automática dizia: ${era}` : undefined}
          >
            <Undo2 aria-hidden="true" />
            Voltar para a automática
          </Button>
        ) : null}
        {aoCancelar ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="toque h-9 md:h-7"
            disabled={marcar.isPending}
            onClick={aoCancelar}
          >
            Cancelar
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          className="toque h-9 px-3.5 md:h-7"
          disabled={!canal || nadaMudou || marcar.isPending}
          onClick={() => canal && marcar.mutate({ canal, subcanal })}
        >
          {igualAoQueVale && !chegada.marcada ? 'Confirmar' : 'Gravar'}
        </Button>
      </div>
    </div>
  );
}

function Opcao({
  ativa,
  disabled,
  onClick,
  children,
}: {
  ativa: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'toque inline-flex h-9 items-center rounded-full px-3 text-[13px] font-medium transition-colors md:h-7 md:text-xs',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50',
        ativa
          ? 'bg-foreground text-background'
          : 'border border-wpp-linha-forte text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

/**
 * O canal no TOPO da conversa: o chip, e ao tocar o porquê e a correção. Conversa
 * sem chegada (aberta por nós) não mostra nada; desligado, também não.
 */
export function CanalNoTopo({
  conversaId,
  podeEscrever,
  className,
}: {
  conversaId: string;
  podeEscrever: boolean;
  className?: string;
}) {
  const { ligada, porConversa } = useCanais();
  const chegada = porConversa.get(conversaId);
  const [aberto, setAberto] = useState(false);
  if (!ligada || !chegada) return null;

  const rotulo = chegada.canal ? ROTULO_DO_CANAL[chegada.canal] : 'identificando';
  return (
    <PopoverPrimitive.Root open={aberto} onOpenChange={setAberto}>
      <PopoverPrimitive.Trigger
        className={cn(
          'toque shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          className,
        )}
        aria-label={`Como chegou: ${rotulo}. ${podeEscrever ? 'Ver o porquê ou corrigir' : 'Ver o porquê'}`}
      >
        <Gatilho chegada={chegada} tamanho="topo" comSeta={podeEscrever} />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 flex max-h-[70svh] w-[20rem] flex-col gap-3 overflow-y-auto rounded-2xl border border-wpp-linha bg-popover p-3.5 text-popover-foreground shadow-wpp-pop outline-none"
        >
          <p className={ROTULO_DA_SECAO}>Como chegou</p>
          <DetalheDoCanal chegada={chegada} />
          {podeEscrever ? (
            <div className="border-t border-wpp-linha pt-3">
              <CorrigirCanal
                key={`${chegada.id}:${chegada.canal}:${chegada.subcanal}`}
                chegada={chegada}
                aoTerminar={() => setAberto(false)}
              />
            </div>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * "Como chegou", nos dados do contato (a folha do celular e a coluna ao lado no
 * computador): o mesmo conteúdo do topo, aberto, e o "Corrigir" a um toque.
 */
export function ComoChegou({
  conversaId,
  podeEscrever,
}: {
  conversaId: string;
  podeEscrever: boolean;
}) {
  const { ligada, porConversa } = useCanais();
  const chegada = porConversa.get(conversaId);
  const [corrigindo, setCorrigindo] = useState(false);
  if (!ligada || !chegada) return null;

  return (
    <section aria-label="Como chegou" className="flex flex-col gap-2">
      <h3 className={ROTULO_DA_SECAO}>Como chegou</h3>
      <DetalheDoCanal chegada={chegada} />
      {podeEscrever ? (
        corrigindo ? (
          <div className="rounded-xl border border-wpp-linha p-3">
            <CorrigirCanal
              key={`${chegada.id}:${chegada.canal}:${chegada.subcanal}`}
              chegada={chegada}
              aoTerminar={() => setCorrigindo(false)}
              aoCancelar={() => setCorrigindo(false)}
            />
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="toque h-11 self-start rounded-full md:h-8"
            onClick={() => setCorrigindo(true)}
          >
            <Pencil aria-hidden="true" />
            Corrigir o canal
          </Button>
        )
      ) : null}
    </section>
  );
}

/**
 * "Como chegou" na ficha, ao lado da origem: cada vez que a pessoa nos procurou,
 * da primeira à última. "Chegou pela placa em 06/11/2026", "Voltou por anúncio
 * em 03/02/2027". Só leitura: quem corrige é a conversa.
 *
 * Não é a origem da ficha (`source_id`, que diz como ela entrou no CRM): é o
 * meio por onde a PESSOA ficou sabendo da empresa.
 */
export function CanalNoTopoDaFicha({ chegadas }: { chegadas: readonly ChegadaDaConversa[] }) {
  const chegada = canalDaFicha(chegadas);
  if (!chegada?.canal) return null;
  return (
    <span
      title={`Chegou por: ${linhaDoCanal(chegada.canal, chegada.subcanal)}`}
      className="inline-flex min-w-0 shrink-0"
    >
      <ChipDoCanal canal={chegada.canal} tamanho="topo" />
    </span>
  );
}

export function ComoChegouNaFicha({ chegadas }: { chegadas: readonly ChegadaDaConversa[] }) {
  const itens = chegadasNaFicha(chegadas);
  if (itens.length === 0) return null;
  return (
    <section
      aria-label="Como chegou"
      className="flex flex-col gap-2 border-t border-hairline pt-4 text-[13px] leading-relaxed"
    >
      <h3 className="text-[12.5px] text-muted-foreground">Como chegou</h3>
      <ul className="flex flex-col gap-2.5">
        {itens.map((i) => {
          const Icone = i.canal ? APARENCIA_DO_CANAL[i.canal].icone : IDENTIFICANDO.icone;
          return (
            <li key={i.id} className="flex min-w-0 items-start gap-2">
              <Icone
                className="mt-[3px] size-3.5 shrink-0"
                style={i.canal ? { color: coresDoCanal(i.canal).color } : undefined}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-foreground">{i.frase}</p>
                {i.detalhe ? <p className="text-muted-foreground">{i.detalhe}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
