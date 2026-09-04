'use client';

/**
 * Os campos que a etapa de destino exige (RF-FUN-04), desenhados a partir do dado.
 *
 * A lista não está escrita em código: ela vem de `stages.required_fields`, que o
 * gestor edita na v1. Por isso este arquivo não pergunta "é a etapa Reunião
 * marcada?"; pergunta "que tipo de campo é este?". Um campo novo no catálogo aparece
 * na folha sem uma linha de código nova, e o `move_deal` continua sendo quem recusa
 * o que faltar.
 *
 * Os quatro que o MVP conhece pelo nome:
 *   * `lost_reason_id`         — lista fechada de `lost_reasons` (tem tela própria);
 *   * `meeting_at`             — data e hora, campo nativo do aparelho;
 *   * `meeting_format`         — enum com rótulo em pt-BR (`ROTULOS_FORMATO_REUNIAO`);
 *   * `authorization_evidence` — texto literal do que a pessoa disse; vira prova em
 *                                `consent_events`, então é área de texto, não linha.
 * Qualquer outro cai no campo de texto e viaja em `p_fields` sem interpretação.
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { rotuloFormatoReuniao, type CampoObrigatorio } from '../tipos';
import { minimoDoCampoDeData } from './datas';
import { CAMPO_EVIDENCIA } from './formulario-mover';

/** Rótulo + controle + erro, com a ligação de acessibilidade já feita. */
export function Campo({
  id,
  rotulo,
  dica,
  erro,
  children,
}: {
  id: string;
  rotulo: string;
  dica?: string;
  erro?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {erro ? (
        <p role="alert" className="text-sm text-destructive-texto">
          {erro}
        </p>
      ) : dica ? (
        <p className="text-xs text-muted-foreground">{dica}</p>
      ) : null}
    </div>
  );
}

/** Área de texto com o mesmo desenho do `Input` (não existe Textarea no kit). */
export function AreaDeTexto({
  className,
  invalido,
  ...resto
}: React.ComponentProps<'textarea'> & { invalido?: boolean }) {
  return (
    <textarea
      data-slot="input"
      aria-invalid={invalido}
      className={cn(
        'min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...resto}
    />
  );
}

/**
 * Um campo exigido pela etapa. O valor é sempre texto (é o que os campos nativos
 * entregam); quem converte para número ou ISO é `montarPedido`.
 */
export function CampoDaEtapa({
  campo,
  valor,
  aoMudar,
  erro,
  id,
}: {
  campo: CampoObrigatorio;
  valor: string;
  aoMudar: (valor: string) => void;
  erro?: string;
  id: string;
}) {
  const invalido = Boolean(erro);

  if (campo.type === 'timestamptz') {
    return (
      <Campo
        id={id}
        rotulo={campo.label}
        erro={erro}
        dica="A data combinada vira a próxima ação e uma tarefa na sua agenda."
      >
        <Input
          id={id}
          type="datetime-local"
          min={minimoDoCampoDeData()}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          aria-invalid={invalido}
          className="numerico h-11 md:h-9"
        />
      </Campo>
    );
  }

  if (campo.type === 'enum') {
    return (
      <Campo id={id} rotulo={campo.label} erro={erro}>
        <Select value={valor || undefined} onValueChange={aoMudar}>
          <SelectTrigger id={id} aria-invalid={invalido} className="h-11 w-full md:h-9">
            <SelectValue placeholder="Escolha o formato" />
          </SelectTrigger>
          <SelectContent>
            {(campo.options ?? []).map((opcao) => (
              <SelectItem key={opcao} value={opcao}>
                {rotuloFormatoReuniao(opcao)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>
    );
  }

  // A evidência da autorização é o texto literal do que a pessoa disse: precisa de
  // espaço para uma frase inteira, não de uma linha.
  if (campo.field === CAMPO_EVIDENCIA) {
    return (
      <Campo
        id={id}
        rotulo="Evidência da autorização"
        erro={erro}
        dica="Cole o que a pessoa escreveu ou disse, com data e canal. Fica registrado como prova (LGPD)."
      >
        <AreaDeTexto
          id={id}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          invalido={invalido}
          placeholder='Ex.: "Pode cadastrar meu buffet lá, sim" — WhatsApp, 04/09 às 15:12.'
        />
      </Campo>
    );
  }

  return (
    <Campo id={id} rotulo={campo.label} erro={erro}>
      <Input
        id={id}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        aria-invalid={invalido}
        className="h-11 md:h-9"
      />
    </Campo>
  );
}
