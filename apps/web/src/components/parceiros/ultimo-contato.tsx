import { MapPin, MessageCircle, PhoneCall, AtSign, Mail, Video, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { definicaoTemperatura } from '@/components/temperatura/escala-termica';

import { diasDeDiferenca } from './formatos';
import type { LinhaParceiro, PortaDoContato } from './tipos';

/**
 * O último contato de um parceiro, na lista: O QUE deu, e não só QUANDO foi.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA CÉLULA EXISTE
 * ---------------------------------------------------------------------------
 * O pedido (Rafael, 11/09/2026): "algo mais completo na aba de parceiros que fale
 * melhor que já entramos em contato, e com a tag correta do que o contato
 * resultou". O time faz a captação A PARTIR desta lista, e ela só dizia "4d" — o
 * mesmo "4d" para o parceiro que marcou reunião e para o que não atendeu pela
 * quarta vez. Para saber a diferença, era abrir ficha por ficha.
 *
 * ---------------------------------------------------------------------------
 * A TAG, E A ÚNICA COR QUE ELA PODE TER
 * ---------------------------------------------------------------------------
 * A tag é o rótulo do desfecho, no vocabulário do catálogo — "Não atendeu",
 * "Decisor interessado", "Número inválido". Nenhuma tradução no meio: é a mesma
 * palavra que a pessoa tocou no Registrar, e é por ela que o time procura.
 *
 * Cor, neste produto, é a escala térmica e só ela. Então a tag pinta em
 * quente/morno/frio QUANDO o desfecho aplica temperatura (é o `sets_temperature`
 * do catálogo: "Interessado" esquenta, "Agora não" esfria) — e aí a cor não é
 * enfeite, é a mesma informação que a barra térmica já dá. Desfecho que não mexe
 * em temperatura fica neutro.
 *
 * O `nenhuma` (número inválido) é a exceção deliberada, sem ganhar matiz: ele leva
 * contorno em vez de fundo. É o único desfecho em que o próximo passo não é ligar
 * de novo, é achar outro número — e ele tem de saltar da lista sem roubar a cor
 * que significa temperatura.
 *
 * ---------------------------------------------------------------------------
 * A LINHA DE BAIXO
 * ---------------------------------------------------------------------------
 * Canal, há quanto tempo, a tentativa e quem. Nesta ordem porque é a ordem em que
 * a pergunta vem: por onde falei, quando, quantas vezes já tentei, e — para duas
 * pessoas não ligarem para o mesmo parceiro na mesma manhã — quem foi.
 */

type Resumo = {
  contatado: boolean;
  tag: string;
  porta: PortaDoContato | null;
  /** Só existe quando o desfecho aplica temperatura. */
  temperatura: string | null;
  canal: { rotulo: string; icone: LucideIcon } | null;
  quando: string | null;
  tentativas: string | null;
  quem: string | null;
  /** Frase inteira, para o `title` e para o leitor de tela. */
  descricao: string;
};

/**
 * O canal sai do PREFIXO DO DESFECHO, e não de `activities.channel`.
 *
 * O canal da atividade não distingue visita de reunião: as duas gravam
 * `channel = 'presencial'` (migração 001100, mapa de superfície), e a diferença
 * mora no `type` (`visit` contra `meeting`). O prefixo do catálogo é inequívoco e
 * já vem na linha — `reu_interessado` é reunião mesmo quando a reunião foi na loja.
 */
const CANAL_POR_PREFIXO: Record<string, { rotulo: string; icone: LucideIcon }> = {
  lig: { rotulo: 'Ligação', icone: PhoneCall },
  wa: { rotulo: 'WhatsApp', icone: MessageCircle },
  vis: { rotulo: 'Visita', icone: MapPin },
  reu: { rotulo: 'Reunião', icone: Video },
  dm: { rotulo: 'Instagram', icone: AtSign },
};

/** Só se o desfecho vier sem prefixo conhecido: um catálogo novo não pode sumir com o canal. */
const CANAL_POR_ATIVIDADE: Record<string, { rotulo: string; icone: LucideIcon }> = {
  phone: { rotulo: 'Ligação', icone: PhoneCall },
  whatsapp: { rotulo: 'WhatsApp', icone: MessageCircle },
  presencial: { rotulo: 'Presencial', icone: MapPin },
  instagram: { rotulo: 'Instagram', icone: AtSign },
  email: { rotulo: 'E-mail', icone: Mail },
};

function canalDo(slug: string, canalDaAtividade: string | null) {
  const prefixo = slug.split('_')[0] ?? '';
  return (
    CANAL_POR_PREFIXO[prefixo] ??
    (canalDaAtividade ? (CANAL_POR_ATIVIDADE[canalDaAtividade] ?? null) : null)
  );
}

/** Só o primeiro nome: é como o time se chama ("foi o Matheus"). */
function primeiroNome(nome: string | null): string | null {
  if (!nome) return null;
  return nome.trim().split(/\s+/)[0] ?? null;
}

function quandoFoi(iso: string | null, agora: Date): string | null {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  const dias = diasDeDiferenca(data, agora);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias} d`;
}

/**
 * Lógica pura da célula, separada para ser testada sem montar componente.
 *
 * "1ª tentativa" e não "1 tentativa": a pergunta que a pessoa faz é "quantas
 * vezes eu já tentei?", e o ordinal responde direto — "não atendeu, 4ª tentativa"
 * diz na hora que é hora de parar de ligar e mandar mensagem.
 */
export function resumoDoContato(linha: LinhaParceiro, agora: Date = new Date()): Resumo {
  if (!linha.last_outcome_slug || !linha.last_outcome_name) {
    return {
      contatado: false,
      tag: 'Ainda não contatado',
      porta: null,
      temperatura: null,
      canal: null,
      quando: null,
      tentativas: null,
      quem: null,
      descricao: 'Ninguém falou com este parceiro ainda.',
    };
  }

  const canal = canalDo(linha.last_outcome_slug, linha.last_contact_channel);
  const quando = quandoFoi(linha.last_contact_at, agora);
  const n = linha.contact_attempts;
  const tentativas = n > 0 ? `${n}ª tentativa` : null;
  const quem = primeiroNome(linha.last_contact_by);

  const partes = [
    linha.last_outcome_name,
    canal ? `por ${canal.rotulo.toLowerCase()}` : null,
    quando,
    tentativas,
    quem ? `por ${quem}` : null,
  ].filter(Boolean);

  return {
    contatado: true,
    tag: linha.last_outcome_name,
    porta: linha.last_outcome_counts_as,
    temperatura: linha.last_outcome_temperature,
    canal,
    quando,
    tentativas,
    quem,
    descricao: `Último contato: ${partes.join(', ')}.`,
  };
}

export function UltimoContato({
  linha,
  compacto = false,
}: {
  linha: LinhaParceiro;
  /**
   * No cartão do celular: só a tag e o "há quanto tempo". Canal, tentativa e quem
   * ficam no `title` — a coluna do nome já disputa os 390px com tudo o mais.
   */
  compacto?: boolean;
}) {
  const r = resumoDoContato(linha);

  if (!r.contatado) {
    return (
      <span title={r.descricao} className="text-xs whitespace-nowrap text-muted-foreground">
        {compacto ? '-' : r.tag}
        <span className="sr-only">{r.descricao}</span>
      </span>
    );
  }

  const Icone = r.canal?.icone;

  return (
    <span title={r.descricao} className="flex min-w-0 flex-col items-start gap-1">
      <TagDoContato resumo={r} />

      {/* 12px, e não os 11px da primeira versão. Canal, quando, tentativa e QUEM
          são o que decide a próxima ligação — "a Ana ligou ontem" é o que evita a
          segunda chamada da manhã —, e estavam no menor texto da tela. Continuam
          secundários pela tinta, não por um tamanho que se lê com esforço. */}
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {Icone && !compacto ? (
          <Icone className="size-3.5 shrink-0" aria-label={r.canal?.rotulo} />
        ) : null}
        {r.quando ? <span className="whitespace-nowrap">{r.quando}</span> : null}
        {!compacto && r.tentativas ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">{r.tentativas}</span>
          </>
        ) : null}
        {!compacto && r.quem ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate">{r.quem}</span>
          </>
        ) : null}
      </span>
      <span className="sr-only">{r.descricao}</span>
    </span>
  );
}

/**
 * A tag sozinha, sem a linha de baixo. Serve ao cartão do celular, onde ela entra
 * na fileira de metadados junto do chip de temperatura — que quebra linha e tem
 * espaço para "Decisor interessado", ao contrário da coluna da direita.
 */
export function TagDoContato({ resumo, className }: { resumo: Resumo; className?: string }) {
  if (!resumo.contatado) return null;
  const termica = resumo.temperatura ? definicaoTemperatura(resumo.temperatura) : null;

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center self-start overflow-hidden rounded-lg px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        // Sem temperatura: fundo neutro. Número inválido: contorno, porque o
        // próximo passo muda de natureza — achar outro número, não ligar de novo —
        // e isso não pode depender de matiz.
        !termica && resumo.porta === 'nenhuma' && 'border border-foreground/40 text-foreground',
        !termica && resumo.porta !== 'nenhuma' && 'bg-muted text-muted-foreground',
        className,
      )}
      style={termica ? { backgroundColor: termica.corFundo, color: termica.corTexto } : undefined}
    >
      <span className="truncate">{resumo.tag}</span>
    </span>
  );
}
