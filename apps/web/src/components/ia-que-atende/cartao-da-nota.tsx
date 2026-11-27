'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { BookOpen, Check, MessageSquare, Quote, X } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import {
  type Alcance,
  type NotaSugerida,
  TETO_DA_NOTA,
  alcancesDaNota,
  descartarNota,
  fraseDoMotivoDaNota,
  guardarNota,
  limparNota,
  ondeEntra,
  problemaDaNota,
  rotuloDoAlcance,
  textoDoAlcance,
} from './notas-sugeridas';

/**
 * "Guardar para os próximos clientes?" (Imova, 27/11/2026): a nota que a IA escreveu a
 * partir de uma resposta de vocês, com o alcance (só este imóvel ou todos), Guardar, Editar
 * e Agora não. O mesmo cartão vive no canto (logo depois da resposta, para quem respondeu)
 * e na aba Caderno (para toda a gestão). Nada entra no caderno sem o clique; quem decide
 * onde a nota entra é o banco (`public.ia_nota_guardar`).
 */
export function CartaoDaNota({
  nota,
  noCanto = false,
  aoMudar,
  aoFechar,
}: {
  nota: NotaSugerida;
  /** No canto da tela: mais compacto e com o X que só esconde ali. */
  noCanto?: boolean;
  aoMudar: () => void;
  aoFechar?: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const alcances = alcancesDaNota(nota);
  const [alcance, setAlcance] = useState<Alcance>(
    alcances.includes(nota.alcanceSugerido) ? nota.alcanceSugerido : (alcances[0] ?? 'geral'),
  );
  const [editando, setEditando] = useState(false);
  const [textos, setTextos] = useState<Record<Alcance, string>>({
    imovel: nota.textoDoImovel ?? '',
    geral: nota.textoGeral ?? '',
  });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const texto = textos[alcance];
  const editado = limparNota(texto) !== limparNota(textoDoAlcance(nota, alcance));
  const problema = problemaDaNota(texto);

  async function guardar() {
    if (problema !== null) return;
    setEnviando(true);
    setErro(null);
    const r = await guardarNota(nota.id, alcance, editado ? texto : null);
    setEnviando(false);
    if (!r.ok) {
      setErro(fraseDoMotivoDaNota(r.motivo, r.por));
      if (r.motivo === 'ja_decidida' || r.motivo === 'nao_existe') aoMudar();
      return;
    }
    toast.success('Guardado no caderno', {
      description: 'Da próxima vez, a IA responde isso direto, sem perguntar a vocês.',
      action: { label: 'Ver no caderno', onClick: () => router.push('/ia?aba=caderno') },
    });
    aoMudar();
  }

  async function agoraNao() {
    setEnviando(true);
    setErro(null);
    const r = await descartarNota(nota.id);
    setEnviando(false);
    if (!r.ok && r.motivo !== 'ja_decidida' && r.motivo !== 'nao_existe') {
      setErro(fraseDoMotivoDaNota(r.motivo, r.por));
      return;
    }
    toast('Não guardado', {
      description: 'Se outro cliente perguntar isso, a IA pergunta a vocês de novo.',
    });
    aoMudar();
  }

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-background p-3',
        noCanto ? 'border-primary/60' : 'border-border md:p-4',
      )}
    >
      <div className="flex items-start gap-2">
        <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Guardar para os próximos clientes?</p>
          <p className="text-xs text-muted-foreground">
            {nota.respondidaPorMim ? 'Você respondeu' : `${nota.respondidaPor ?? 'Alguém'} respondeu`}
            {nota.imovel ? ` sobre ${nota.imovel}` : ''}. A IA escreveu a nota; guardada, ela responde
            isso direto.
          </p>
        </div>
        {aoFechar ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="-mt-1 -mr-1 size-9 shrink-0"
            aria-label="Fechar aqui (a sugestão fica na aba Caderno)"
            onClick={aoFechar}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>

      <figure className="space-y-1 rounded-xl bg-muted/60 px-3 py-2">
        <figcaption className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Quote className="size-3" aria-hidden />A pergunta e a resposta
        </figcaption>
        <blockquote className="text-sm">&ldquo;{nota.pergunta}&rdquo;</blockquote>
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Respondido:</span> {nota.resposta}
        </p>
      </figure>

      {alcances.length > 1 ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
            Vale para
          </legend>
          {alcances.map((a) => (
            <label
              key={a}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm',
                alcance === a ? 'border-primary bg-primary/5' : 'border-border',
              )}
            >
              <input
                type="radio"
                name={`${id}-alcance`}
                className="size-4 accent-[var(--primary)]"
                checked={alcance === a}
                onChange={() => {
                  setAlcance(a);
                  setErro(null);
                }}
              />
              <span className="flex-1">{rotuloDoAlcance(nota, a)}</span>
              {a === nota.alcanceSugerido ? (
                <span className="text-[11px] font-bold text-primary">Sugerido</span>
              ) : null}
            </label>
          ))}
        </fieldset>
      ) : null}

      {editando ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-texto`} className="text-sm font-medium">
            A nota, do jeito que a IA vai ler
          </label>
          <textarea
            id={`${id}-texto`}
            rows={3}
            maxLength={TETO_DA_NOTA + 40}
            value={texto}
            onChange={(e) => setTextos((t) => ({ ...t, [alcance]: e.target.value }))}
            aria-invalid={problema !== null}
            aria-describedby={`${id}-dica`}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:text-sm"
          />
          <p
            id={`${id}-dica`}
            className={cn('text-xs', problema ? 'font-medium text-destructive-texto' : 'text-muted-foreground')}
          >
            {problema ?? `Só o fato, sem nome nem telefone de cliente. ${limparNota(texto).length} de ${TETO_DA_NOTA} letras.`}
          </p>
        </div>
      ) : (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm leading-relaxed">{texto}</p>
      )}

      <p className="text-xs text-muted-foreground">{ondeEntra(nota, alcance)}</p>

      {erro ? (
        <p role="alert" className="text-xs font-medium text-destructive-texto">
          {erro}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          className="toque h-11 md:h-9"
          disabled={enviando || problema !== null}
          onClick={() => void guardar()}
        >
          <Check aria-hidden />
          {enviando ? 'Guardando...' : 'Guardar'}
        </Button>
        {!editando ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="toque h-11 md:h-9"
            disabled={enviando}
            onClick={() => setEditando(true)}
          >
            Editar
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="toque h-11 md:h-9"
          disabled={enviando}
          onClick={() => void agoraNao()}
        >
          Agora não
        </Button>
        <Link
          href={nota.caminho}
          className="ml-auto inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary hover:underline md:min-h-9"
        >
          <MessageSquare className="size-3.5" aria-hidden />
          Ver conversa
        </Link>
      </div>
    </li>
  );
}
