'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import { FileCheck2, Phone, SendHorizontal } from 'lucide-react';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { ErroDaConversa } from './acoes';
import { CHAVE_CONVERSAS, chaveDaLinha } from './dados';
import {
  dicaDaVariavel,
  escolherModeloInicial,
  faltando,
  fraseDoBloqueio,
  grupoDoModelo,
  preencher,
  previaSchema,
  quandoFoi,
  resultadoDoEnvioSchema,
  rotuloDaVariavel,
  tetoDaVariavel,
  valoresIniciais,
  variavelLivreDoModelo,
  VARIAVEL_DO_ATENDENTE,
  type ModeloParaEnviar,
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
 * As molduras em que a pessoa ESCREVE — as únicas que a tela oferece desde
 * 17/09/2026.
 *
 * ===========================================================================
 * POR QUE OS TEXTOS PRONTOS SAÍRAM DA TELA
 * ===========================================================================
 * "Não quero ficar preso a modelo, quero conversar de forma humana" (Rafael,
 * 17/09). E ele está certo: um texto pronto que a pessoa não escreveu chega como
 * mala direta, e o parceiro responde como se responde a mala direta.
 *
 * O que a Meta exige fora da janela de 24 h é uma MOLDURA aprovada — não um texto
 * pronto. As molduras livres (`GEN-ABR-LIVRE`, `GEN-ABR-PARCERIA`,
 * `GEN-ABR-LANCAMENTO`, `GEN-FUP-LIVRE`) resolvem isso: a saudação com o nome de
 * quem envia e a saída obrigatória (SAIR + privacidade, RF-CON-12) são fixas e
 * aprovadas; o meio é um campo de 900 caracteres que a pessoa escreve na hora.
 *
 * Então a tela mostra só essas. O texto pronto continua no banco — a Meta precisa
 * dele aprovado para as mensagens operacionais (confirmar reunião, lembrete,
 * pós-ligação), que saem de OUTRAS telas com o texto já decidido, e chegam aqui
 * apenas quando o recibo da ligação pede um modelo específico.
 */
function molduraLivre(modelo: ModeloParaEnviar): boolean {
  return variavelLivreDoModelo(modelo) !== null;
}

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
        <p className="flex items-center gap-2 text-sm font-medium">
          <FileCheck2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          Nenhum modelo aprovado pela Meta ainda
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {p.janela_24h_aberta
            ? 'A janela de 24 h está aberta: escreva a resposta no campo de texto.'
            : 'Para começar conversa (ou retomar depois de 24 h sem resposta) a Meta só aceita modelo aprovado. '}
          {p.janela_24h_aberta ? null : (
            <>
              <span className="numerico">{p.modelos_esperando_meta}</span>
              {p.modelos_esperando_meta === 1
                ? ' modelo está esperando a aprovação, que costuma levar de minutos a um dia.'
                : ' modelos estão esperando a aprovação, que costuma levar de minutos a um dia.'}
            </>
          )}
        </p>
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
  // Só as molduras em que se escreve — mais a que o recibo da ligação pediu, que
  // não é a pessoa escolhendo texto pronto: é um fluxo que já decidiu.
  const oferecidos = previa.modelos.filter(
    (m) => molduraLivre(m) || m.id === modeloDoRecibo?.id,
  );
  const [modeloId, setModeloId] = useState<number>(
    modeloDoRecibo?.id ??
      escolherModeloInicial(oferecidos, previa.valores)?.id ??
      oferecidos[0]?.id ??
      previa.modelos[0]!.id,
  );
  const [trocando, setTrocando] = useState(false);
  const [digitados, setDigitados] = useState<Record<string, string>>(() =>
    modeloDoRecibo ? pedido!.valores : {},
  );

  const grupos = useMemo(() => agrupar(oferecidos), [oferecidos]);


  const modelo =
    previa.modelos.find((m) => m.id === modeloId) ?? oferecidos[0] ?? previa.modelos[0]!;
  const valores = valoresIniciais(modelo, previa.valores, digitados);
  const vazias = faltando(modelo, valores);
  const longa = modelo.variaveis.find((v) => (valores[v] ?? '').trim().length > tetoDaVariavel(v));
  const texto = preencher(modelo.corpo, valores);

  // `{{atendente}}` não é campo: o banco põe o nome de quem clicou, sempre. E a
  // variável de texto livre não é campo de formulário: ela É a mensagem.
  const livre = variavelLivreDoModelo(modelo);
  const campos = modelo.variaveis.filter((v) => v !== VARIAVEL_DO_ATENDENTE && v !== livre);
  const assinaComNome = modelo.variaveis.includes(VARIAVEL_DO_ATENDENTE);

  const enviar = useMutation({
    mutationFn: () => enviarModelo(organizacaoId, modelo.id, valores),
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

  // Nenhuma moldura livre aprovada: a tela diz isso e oferece o caminho que existe.
  // Cair no texto pronto seria devolver pela porta dos fundos o que saiu pela frente.
  if (oferecidos.length === 0) {
    return (
      <Moldura className={className}>
        <p className="flex items-center gap-2 text-sm font-medium">
          <FileCheck2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          Ainda não dá para abrir conversa por aqui
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Fora da janela de 24 h a Meta só aceita moldura aprovada, e as molduras em que
          você escreve ainda estão na revisão deles
          {previa.modelos_esperando_meta > 0 ? (
            <>
              {' ('}
              <span className="numerico">{previa.modelos_esperando_meta}</span>
              {' esperando)'}
            </>
          ) : null}
          . Costuma levar de minutos a um dia. Enquanto isso: quem responder nas últimas
          24 h você atende aqui, escrevendo livre.
        </p>
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
          {previa.primeiro_contato ? 'Primeira mensagem' : 'Escrever para o parceiro'}
        </p>
        {previa.primeiro_contato && previa.teto ? (
          <span className="text-[11px] text-muted-foreground">
            <span className="numerico">{previa.teto.usados}</span> de{' '}
            <span className="numerico">{previa.teto.teto}</span> primeiros contatos hoje
          </span>
        ) : null}
      </div>

      {livre ? (
        <div className="space-y-1">
          <label htmlFor={`livre-${modelo.id}`} className="text-xs text-muted-foreground">
            O que você quer dizer
          </label>
          <textarea
            id={`livre-${modelo.id}`}
            autoFocus
            rows={5}
            value={valores[livre] ?? ''}
            maxLength={tetoDaVariavel(livre)}
            onChange={(e) => setDigitados((d) => ({ ...d, [livre]: e.target.value }))}
            placeholder="Escreva como você falaria. A saudação com o seu nome e a saída (SAIR) já entram sozinhas."
            className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            <span className="numerico">{(valores[livre] ?? '').length}</span> de{' '}
            <span className="numerico">{tetoDaVariavel(livre)}</span> caracteres. Sai num parágrafo
            só: a Meta não aceita quebra de linha dentro do texto.
          </p>
        </div>
      ) : null}

      {pedido && !modeloDoRecibo ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          O modelo que a ligação pediu ({pedido.codigo}) ainda não foi aprovado pela Meta. Escolha
          outro ou registre por telefone.
        </p>
      ) : null}

      {trocando || oferecidos.length <= 1 ? null : (
        <button
          type="button"
          onClick={() => setTrocando(true)}
          className="self-start rounded px-1 text-xs text-muted-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Trocar a moldura (<span className="numerico">{oferecidos.length}</span>)
        </button>
      )}

      {/* O seletor só existe depois de a pessoa PEDIR para trocar. Com uma moldura
          só, mostrá-lo era mostrar uma escolha que não existe. */}
      <div className={cn('space-y-1', !trocando && 'hidden')}>
        <label htmlFor="modelo-whatsapp" className="text-xs text-muted-foreground">
          Moldura
        </label>
        <Select value={String(modelo.id)} onValueChange={(v) => setModeloId(Number(v))}>
          <SelectTrigger id="modelo-whatsapp" className="toque h-11 w-full md:h-9">
            <SelectValue>{modelo.nome}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {grupos.map(([grupo, lista]) => (
              <SelectGroup key={grupo}>
                <SelectLabel>{grupo}</SelectLabel>
                {lista.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.nome}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

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

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Como vai chegar
          {assinaComNome && previa.valores[VARIAVEL_DO_ATENDENTE]
            ? ` · a mensagem se apresenta com o seu nome (${previa.valores[VARIAVEL_DO_ATENDENTE]})`
            : null}
        </p>
        <p className="rounded-lg border border-hairline bg-card/60 px-3 py-2 text-sm leading-relaxed whitespace-pre-line">
          {texto}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" className="toque h-11 md:h-9" disabled={!pode}>
          <SendHorizontal aria-hidden="true" />
          {enviar.isPending ? 'Enviando...' : 'Enviar pelo WhatsApp'}
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

function agrupar(modelos: ModeloParaEnviar[]): [string, ModeloParaEnviar[]][] {
  const mapa = new Map<string, ModeloParaEnviar[]>();
  for (const m of modelos) {
    const g = grupoDoModelo(m);
    mapa.set(g, [...(mapa.get(g) ?? []), m]);
  }
  return [...mapa.entries()];
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
