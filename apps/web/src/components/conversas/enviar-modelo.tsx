'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import { FileCheck2, Phone, SendHorizontal } from 'lucide-react';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { ErroDaConversa } from './acoes';
import { CHAVE_CONVERSAS, chaveDaLinha } from './dados';
import {
  dicaDaVariavel,
  ehCumprimento,
  escolherModeloInicial,
  faltando,
  fraseDoBloqueio,
  preencher,
  previaSchema,
  quandoFoi,
  resultadoDoEnvioSchema,
  rotuloDaVariavel,
  tetoDaVariavel,
  valoresIniciais,
  VARIAVEL_DO_ATENDENTE,
  type PreviaDoEnvio,
} from './envio-de-modelo';
import { fraseDaRecusaDoEnvio, MOTIVOS_DE_RECUSA_DO_ENVIO } from './mensagens';
import { esquecerPedidoDeModelo, lerPedidoDeModelo } from './pedido-de-modelo';

/**
 * Mandar WhatsApp pelo CRM com um modelo aprovado pela Meta.
 *
 * É a caixa de quem ainda não tem conversa aberta (primeiro contato) e de quem
 * tem conversa com a janela de 24 h fechada — nos dois casos a Meta só aceita
 * modelo. Substitui o botão que abria o WhatsApp Web: a mensagem sai do número
 * da KOMUNE, fica na conversa e passa pelas travas do banco (supressão, horário,
 * teto do número).
 *
 * A caixa pergunta antes (`wa_preparar_envio`) e só oferece o botão quando nada
 * barra. Quem decide continua sendo o banco no clique: se a prévia e o gatilho
 * discordarem, a recusa chega com a frase dele.
 */
/**
 * Fora da janela de 24 h, só o cumprimento (decisão do Rafael, 22/09/2026).
 *
 * "Eu gosto da ideia de engessar a primeira mensagem pra desbloquear as 24
 * horas livres, mas essa mensagem poderia ser apenas bom dia, boa tarde e boa
 * noite." A caixa manda o cumprimento do período com um clique — no primeiro
 * contato e na retomada — e o que se quer dizer vai em texto livre quando a
 * pessoa responder. A exceção é o recibo da ligação, que chega com o seu
 * modelo já escolhido (resumo, confirmação ou "tentei te ligar").
 */
export function EnviarModelo({
  organizacaoId,
  className,
}: {
  organizacaoId: string;
  className?: string;
}) {
  const previa = useQuery({
    queryKey: chaveDaPrevia(organizacaoId),
    queryFn: () => carregarPrevia(organizacaoId),
    staleTime: 30_000,
  });

  if (previa.isPending) {
    return (
      <Moldura className={className}>
        <p className="text-xs text-muted-foreground">Vendo se dá para mandar WhatsApp agora...</p>
      </Moldura>
    );
  }
  if (previa.isError) {
    return (
      <Moldura className={className}>
        <p className="text-xs text-muted-foreground">
          {previa.error instanceof ErroDaConversa
            ? previa.error.message
            : 'Não deu para consultar o WhatsApp agora.'}
        </p>
        <Button
          variant="outline"
          className="toque h-11 md:h-9"
          onClick={() => void previa.refetch()}
        >
          Tentar de novo
        </Button>
      </Moldura>
    );
  }

  const p = previa.data;

  if (p.bloqueio) {
    return (
      <Moldura className={className}>
        <p className="text-sm font-medium">{tituloDoBloqueio(p.bloqueio.motivo)}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {fraseDoBloqueio(p.bloqueio, MOTIVOS_DE_RECUSA_DO_ENVIO)}
        </p>
        {p.bloqueio.motivo === 'ficha_sem_whatsapp' ? (
          <Button asChild variant="outline" className="toque h-11 md:h-9">
            <Link href={`/parceiros/${organizacaoId}`}>Abrir a ficha</Link>
          </Button>
        ) : (
          <RegistrarPorTelefone organizacaoId={organizacaoId} />
        )}
      </Moldura>
    );
  }

  if (p.modelos.length === 0) {
    return (
      <Moldura className={className}>
        <SemCumprimento janelaAberta={p.janela_24h_aberta} />
        <RegistrarPorTelefone organizacaoId={organizacaoId} />
      </Moldura>
    );
  }

  if (p.sem_resposta_desde && !p.janela_24h_aberta) {
    return (
      <EsperandoResposta desde={p.sem_resposta_desde} className={className}>
        <Formulario previa={p} organizacaoId={organizacaoId} />
      </EsperandoResposta>
    );
  }

  return <Formulario previa={p} organizacaoId={organizacaoId} className={className} />;
}

/**
 * Já mandamos e a pessoa não respondeu: a caixa não oferece a segunda mensagem de
 * cara. Duas mensagens frias seguidas são o que faz a pessoa bloquear, e bloqueio
 * derruba a qualidade do número na Meta. Quem quer retomar (o follow-up do
 * D+3, por exemplo) abre o formulário com um toque a mais.
 */
function EsperandoResposta({
  desde,
  className,
  children,
}: {
  desde: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  if (aberto) return <div className={className}>{children}</div>;
  return (
    <Moldura className={className}>
      <p className="text-sm font-medium">Esperando a resposta</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        A última mensagem saiu {quandoFoi(desde)} e ainda não teve resposta. Mandar outra em seguida
        costuma virar bloqueio; a retomada combinada é depois de três dias (D+3).
      </p>
      <Button variant="outline" className="toque h-11 md:h-9" onClick={() => setAberto(true)}>
        Mandar outra mensagem
      </Button>
    </Moldura>
  );
}

function Formulario({
  previa,
  organizacaoId,
  className,
}: {
  previa: PreviaDoEnvio;
  organizacaoId: string;
  className?: string;
}) {
  const clientes = useQueryClient();
  // Veio do recibo da ligação ("Mandar a confirmação no WhatsApp"): o modelo já vem
  // escolhido e o dia, a hora e o formato, preenchidos. A pessoa ainda revê e envia.
  const [pedido] = useState(() => lerPedidoDeModelo(organizacaoId));
  const modeloDoRecibo = pedido
    ? (previa.modelos.find((m) => m.codigo === pedido.codigo) ?? null)
    : null;
  // Fora o recibo, é o cumprimento do período, e mais nada. Calculado a cada
  // desenho: a caixa aberta às 11h59 passa a dizer "Boa tarde!" ao meio-dia.
  const modelo = modeloDoRecibo ?? escolherModeloInicial(previa.modelos);
  const [digitados, setDigitados] = useState<Record<string, string>>(() =>
    modeloDoRecibo ? pedido!.valores : {},
  );

  const valores = modelo ? valoresIniciais(modelo, previa.valores, digitados) : {};
  const vazias = modelo ? faltando(modelo, valores) : [];
  const longa = modelo?.variaveis.find((v) => (valores[v] ?? '').trim().length > tetoDaVariavel(v));
  const texto = modelo ? preencher(modelo.corpo, valores) : '';
  const cumprimento = modelo !== null && ehCumprimento(modelo);

  // CAMPO SÓ PARA O QUE O CRM NÃO SABE: o recibo da ligação já traz dia, hora e
  // formato; o nome vem da ficha; `{{atendente}}` é o primeiro nome de quem
  // clica. A lista sai de `previa.valores` — o que o SERVIDOR sabe —, e não do
  // digitado: senão apagar o texto faria o campo sumir embaixo do cursor.
  const campos = (modelo?.variaveis ?? []).filter(
    (v) => v !== VARIAVEL_DO_ATENDENTE && (previa.valores[v] ?? '').trim() === '',
  );
  const assinaComNome = modelo?.variaveis.includes(VARIAVEL_DO_ATENDENTE) ?? false;

  const enviar = useMutation({
    mutationFn: () => enviarModelo(organizacaoId, modelo!.id, valores),
    onSuccess: (r) => {
      setDigitados({});
      if (pedido) esquecerPedidoDeModelo();
      toast.success('Mensagem na fila do WhatsApp.', {
        description: r.primeiro_contato
          ? 'Sai pelo número da KOMUNE em instantes e conta como primeiro contato de hoje.'
          : 'Sai pelo número da KOMUNE em instantes.',
      });
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      void clientes.invalidateQueries({ queryKey: chaveDaLinha(organizacaoId) });
      void clientes.invalidateQueries({ queryKey: chaveDaPrevia(organizacaoId) });
    },
    onError: (erro) => {
      toast.error('A mensagem não saiu.', {
        description:
          erro instanceof ErroDaConversa ? erro.message : 'Tente de novo em alguns segundos.',
      });
      void clientes.invalidateQueries({ queryKey: chaveDaPrevia(organizacaoId) });
    },
  });

  if (!modelo) {
    return (
      <Moldura className={className}>
        <SemCumprimento janelaAberta={previa.janela_24h_aberta} />
        <RegistrarPorTelefone organizacaoId={organizacaoId} />
      </Moldura>
    );
  }

  const pode = vazias.length === 0 && !longa && !enviar.isPending;

  return (
    <form
      className={cn('space-y-3', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (pode) enviar.mutate();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <FileCheck2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {!cumprimento
            ? 'Depois da ligação'
            : previa.primeiro_contato
              ? 'Primeira mensagem'
              : 'Retomar a conversa'}
        </p>
        {previa.primeiro_contato && previa.teto ? (
          <span className="text-[11px] text-muted-foreground">
            <span className="numerico">{previa.teto.usados}</span> de{' '}
            <span className="numerico">{previa.teto.teto}</span> primeiros contatos hoje
          </span>
        ) : null}
      </div>

      {cumprimento ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Quando a pessoa responder, a conversa fica livre por 24 h: aí você escreve o que quiser.
        </p>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Como vai chegar
            {assinaComNome && previa.valores[VARIAVEL_DO_ATENDENTE]
              ? ` · assinada com o seu nome (${previa.valores[VARIAVEL_DO_ATENDENTE]})`
              : null}
          </p>
          <p className="rounded-lg border border-hairline bg-card/60 px-3 py-2 text-sm leading-relaxed whitespace-pre-line">
            {texto}
          </p>
        </div>
      )}

      {pedido && !modeloDoRecibo ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          O modelo que a ligação pediu ({pedido.codigo}) não está aprovado pela Meta. Mande o
          cumprimento e escreva o resto quando a pessoa responder.
        </p>
      ) : null}

      {campos.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {campos.map((v) => {
            const id = `var-${v}`;
            const dica = dicaDaVariavel(v);
            return (
              <div key={v} className="space-y-1">
                <label htmlFor={id} className="text-xs text-muted-foreground">
                  {rotuloDaVariavel(v)}
                </label>
                <Input
                  id={id}
                  value={valores[v] ?? ''}
                  maxLength={tetoDaVariavel(v)}
                  placeholder={dica ?? undefined}
                  onChange={(e) => setDigitados((d) => ({ ...d, [v]: e.target.value }))}
                  className="h-11 md:h-9"
                />
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" className="toque h-11 md:h-9" disabled={!pode}>
          <SendHorizontal aria-hidden="true" />
          {enviar.isPending ? 'Enviando...' : cumprimento ? `Mandar “${texto}”` : 'Enviar pelo WhatsApp'}
        </Button>
        {vazias.length > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            Falta preencher: {vazias.map((v) => rotuloDaVariavel(v).toLowerCase()).join(', ')}.
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** O cumprimento ainda não passou pela Meta: sem ele, não dá para abrir conversa. */
function SemCumprimento({ janelaAberta }: { janelaAberta: boolean }) {
  return (
    <>
      <p className="flex items-center gap-2 text-sm font-medium">
        <FileCheck2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {janelaAberta ? 'Pode escrever livre' : 'O cumprimento ainda não foi aprovado pela Meta'}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {janelaAberta
          ? 'A janela de 24 h está aberta: escreva a resposta no campo de texto.'
          : 'Fora da janela de 24 h, a conversa só abre com "Bom dia!", "Boa tarde!" ou "Boa noite!", e a Meta ainda não liberou. Enquanto isso, dá para registrar um contato por telefone.'}
      </p>
    </>
  );
}

function Moldura({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-2 rounded-xl border border-dashed border-hairline p-3', className)}>
      {children}
    </div>
  );
}

function RegistrarPorTelefone({ organizacaoId }: { organizacaoId: string }) {
  return (
    <Button asChild variant="outline" className="toque h-11 md:h-9">
      <Link href={`/registrar?org=${organizacaoId}`}>
        <Phone aria-hidden="true" />
        Registrar contato por telefone
      </Link>
    </Button>
  );
}

function tituloDoBloqueio(motivo: string): string {
  if (motivo === 'whatsapp_nao_configurado') return 'O WhatsApp da KOMUNE ainda não está conectado';
  if (motivo === 'ficha_sem_whatsapp') return 'Esta ficha não tem WhatsApp';
  if (motivo === 'contato_suprimido' || motivo === 'numero_suprimido')
    return 'Pediu para não receber';
  if (motivo.startsWith('janela_')) return 'Fora do horário de envio';
  if (motivo.startsWith('teto_')) return 'Limite do dia atingido';
  return 'Agora não dá para mandar';
}

export function chaveDaPrevia(organizacaoId: string) {
  return ['conversas', 'previa-envio', organizacaoId] as const;
}

async function carregarPrevia(organizacaoId: string): Promise<PreviaDoEnvio> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('wa_preparar_envio', {
    p_organization_id: organizacaoId,
  });
  if (error) {
    if (error.code === '42501') {
      throw new ErroDaConversa('Seu perfil não pode mandar mensagem.', false, error);
    }
    throw new ErroDaConversa('Não deu para consultar o WhatsApp agora.', true, error);
  }
  const lido = previaSchema.safeParse(data);
  if (!lido.success) {
    throw new ErroDaConversa(
      'Esta versão da tela não conversa com o servidor. Recarregue a página.',
      false,
      lido.error,
    );
  }
  return lido.data;
}

async function enviarModelo(
  organizacaoId: string,
  modeloId: number,
  valores: Record<string, string>,
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('wa_enviar_modelo', {
    p_organization_id: organizacaoId,
    p_template_id: modeloId,
    p_parametros: valores,
  });
  if (error) {
    const frase = fraseDaRecusaDoEnvio(error.message);
    if (frase) throw new ErroDaConversa(frase, false, error);
    if (error.code === '42501') {
      throw new ErroDaConversa('Seu perfil não pode mandar mensagem.', false, error);
    }
    throw new ErroDaConversa(
      'Não deu para falar com o servidor. Verifique a conexão e tente de novo.',
      true,
      error,
    );
  }
  const lido = resultadoDoEnvioSchema.safeParse(data);
  if (!lido.success) {
    throw new ErroDaConversa(
      'A resposta do servidor veio incompleta. Recarregue a conversa.',
      false,
    );
  }
  return lido.data;
}
