'use client';

import { useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import type { AppRole } from '@/lib/auth/role';
import { fraseDoArquivo } from '@/lib/midia-dos-grupos';
import { iniciaisDe } from '@/lib/iniciais';
import { EMPRESA } from '@/lib/empresa';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { dataHoraCompleta } from '@/components/conversas/formatos';
import { ErroDoArquivo, subirFotoDoPerfil } from '@/components/grupos/midia';
import { situacaoDasAcoes, temPedidoNaFila } from '@/components/grupos/regras';

import { Interruptor } from './painel-atendimento';
import {
  CHAVE_DO_WHATSAPP,
  CHAVE_DOS_PEDIDOS_DO_PERFIL,
  carregarPedidosDoPerfil,
  carregarWhatsapp,
  lerPerfilDoWhatsapp,
  mudarOpcaoDeEnvio,
  salvarPerfilNoWhatsapp,
} from './whatsapp-dados';
import {
  conferirPerfil,
  formularioDoPerfil,
  fraseDoPerfil,
  mudancasDoPerfil,
  VERTICAIS,
  type FormularioDoPerfil,
  type PerfilDoWhatsapp,
} from './whatsapp-regras';

/** Depois de pedir, a tela confere de 3 em 3 s, por até 90 s, se o perfil voltou da Meta. */
const RITMO_DA_ESPERA_MS = 3_000;
const ESPERA_MAXIMA_MS = 90_000;

/**
 * Ajustes → WhatsApp (27/10/2026).
 *
 * Em cima, o que o contato percebe de nós: os tiques azuis e o "digitando…"
 * (admin e gestor mudam). Embaixo, o perfil da empresa no WhatsApp — o recado,
 * a descrição, o endereço, o e-mail, os sites, a categoria e a foto — que só o
 * admin muda. O perfil mora na Meta: o CRM pede ao worker-wa que leia ou grave,
 * e mostra o que a Meta devolveu.
 */
export function PainelWhatsapp({ papel }: { papel: AppRole }) {
  const clientes = useQueryClient();
  const admin = papel === 'admin';
  const podeEditar = papel === 'admin' || papel === 'gestor';
  /** O `lido_em` de antes do pedido: enquanto for o mesmo, a resposta da Meta não chegou. */
  const [esperando, setEsperando] = useState<{ lidoEm: string | null; ate: number } | null>(null);

  const consulta = useQuery({
    queryKey: CHAVE_DO_WHATSAPP,
    queryFn: carregarWhatsapp,
    refetchInterval: (q) =>
      esperando !== null &&
      Date.now() < esperando.ate &&
      (q.state.data?.perfil?.lidoEm ?? null) === esperando.lidoEm
        ? RITMO_DA_ESPERA_MS
        : false,
  });
  const pedidos = useQuery({
    queryKey: CHAVE_DOS_PEDIDOS_DO_PERFIL,
    queryFn: carregarPedidosDoPerfil,
    enabled: admin,
    refetchInterval: (q) => (temPedidoNaFila(q.state.data ?? []) ? RITMO_DA_ESPERA_MS : false),
  });

  const mudar = useMutation({
    mutationFn: mudarOpcaoDeEnvio,
    onSuccess: () => {
      toast.success('Salvo.');
      void clientes.invalidateQueries({ queryKey: CHAVE_DO_WHATSAPP });
    },
    onError: (e: Error) => toast.error('Não salvou.', { description: e.message }),
  });

  const aoPedir = () => {
    setEsperando({
      lidoEm: consulta.data?.perfil?.lidoEm ?? null,
      // `Date.now()` aqui é no clique, não na pintura.
      ate: Date.now() + ESPERA_MAXIMA_MS,
    });
    void clientes.invalidateQueries({ queryKey: CHAVE_DOS_PEDIDOS_DO_PERFIL });
    void clientes.invalidateQueries({ queryKey: CHAVE_DO_WHATSAPP });
  };

  if (consulta.isPending) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (consulta.isError || !consulta.data) {
    return <p className="text-sm text-destructive">Não deu para ler as configurações.</p>;
  }
  const { envio, perfil } = consulta.data;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-base font-medium">O que o contato vê</h2>
        <Interruptor
          id="wa-confirmar-leitura"
          titulo="Mostrar ao contato que a mensagem foi lida"
          descricao={
            envio.confirmarLeitura
              ? 'Ligado: quando alguém do time abre a conversa, o contato vê os tiques azuis.'
              : 'Desligado: o contato vê só que a mensagem chegou, nunca que foi lida.'
          }
          ligado={envio.confirmarLeitura}
          podeEditar={podeEditar && !mudar.isPending}
          aoMudar={(v) => mudar.mutate({ confirmar_leitura: v })}
        />
        <Interruptor
          id="wa-mostrar-digitando"
          titulo="Mostrar “digitando…” para o contato"
          descricao={
            envio.mostrarDigitando
              ? 'Ligado: enquanto alguém do time escreve, o contato vê “digitando…”.'
              : 'Desligado: o contato só vê a mensagem quando ela chega.'
          }
          ligado={envio.mostrarDigitando}
          podeEditar={podeEditar && !mudar.isPending}
          aoMudar={(v) => mudar.mutate({ mostrar_digitando: v })}
        />
      </section>

      <section className="flex flex-col gap-3 border-t border-hairline pt-4">
        <h2 className="font-heading text-base font-medium">Perfil da empresa no WhatsApp</h2>
        {admin ? (
          <PerfilDaEmpresa
            // O formulário recomeça quando o perfil volta da Meta.
            key={perfil?.lidoEm ?? 'nunca-lido'}
            perfil={perfil}
            pedidos={pedidos.data ?? []}
            aoPedir={aoPedir}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            O recado, a descrição, o endereço e a foto que aparecem para quem abre o perfil da{' '}
            {EMPRESA.nome} no WhatsApp. Só o admin muda.
          </p>
        )}
      </section>
    </div>
  );
}

function PerfilDaEmpresa({
  perfil,
  pedidos,
  aoPedir,
}: {
  perfil: PerfilDoWhatsapp | null;
  pedidos: Parameters<typeof situacaoDasAcoes>[0];
  aoPedir: () => void;
}) {
  const id = useId();
  const seletor = useRef<HTMLInputElement>(null);
  const inicial = formularioDoPerfil(perfil);
  const [form, setForm] = useState<FormularioDoPerfil>(inicial);
  const [foto, setFoto] = useState<File | null>(null);
  const mudar = (parcial: Partial<FormularioDoPerfil>) =>
    setForm((atual) => ({ ...atual, ...parcial }));

  const situacao = situacaoDasAcoes(pedidos);
  const naFila = temPedidoNaFila(pedidos);
  const mudancas = mudancasDoPerfil(inicial, form);
  const temMudanca = Object.keys(mudancas).length > 0 || foto !== null;

  const ler = useMutation({
    mutationFn: lerPerfilDoWhatsapp,
    onSuccess: () => {
      toast.success('Pedido ao WhatsApp.', {
        description: 'O perfil aparece aqui em alguns segundos.',
      });
      aoPedir();
    },
    onError: (e: Error) => toast.error('Não deu.', { description: e.message }),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const dados: Record<string, unknown> = { ...mudancas };
      const motivo = conferirPerfil(dados);
      if (motivo) throw new Error(fraseDoPerfil(motivo));
      if (foto) dados.foto_path = await subirFotoDoPerfil(foto);
      if (Object.keys(dados).length === 0) throw new Error(fraseDoPerfil('nada_mudou'));
      await salvarPerfilNoWhatsapp(dados);
    },
    onSuccess: () => {
      setFoto(null);
      toast.success('Salvo; o WhatsApp atualiza em alguns segundos.');
      aoPedir();
    },
    onError: (e: Error) =>
      toast.error('Não salvou.', {
        description: e instanceof ErroDoArquivo ? fraseDoArquivo(e.motivo) : e.message,
      }),
  });

  const vertical = form.vertical;
  const verticalConhecida = vertical === '' || VERTICAIS.some((v) => v.valor === vertical);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {naFila
          ? 'Esperando o WhatsApp responder…'
          : perfil?.lidoEm
            ? `Lido do WhatsApp em ${dataHoraCompleta(perfil.lidoEm)}.`
            : 'O CRM ainda não leu o perfil do WhatsApp. Toque em “Ler do WhatsApp”.'}
      </p>
      {situacao.falha && !naFila ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-relaxed">
          <span className="font-medium text-destructive-texto">
            O WhatsApp recusou {situacao.falha.rotulo}:
          </span>{' '}
          {situacao.falha.erro}
        </p>
      ) : null}

      <div className="flex items-center gap-4">
        <Avatar className="size-16 shrink-0">
          {perfil?.profilePictureUrl ? <AvatarImage src={perfil.profilePictureUrl} alt="" /> : null}
          <AvatarFallback className="bg-muted text-base font-medium text-muted-foreground">
            {iniciaisDe(EMPRESA.nome)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-1">
          <input
            ref={seletor}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              setFoto(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => seletor.current?.click()}
            className="toque h-10 w-fit md:h-8"
          >
            <Camera aria-hidden="true" />
            Trocar a foto
          </Button>
          <p className="truncate text-[11px] text-muted-foreground">
            {foto ? `Nova: ${foto.name} (vai quadrada, ao salvar)` : 'Quadrada, até 5 MB.'}
          </p>
        </div>
      </div>

      <Campo id={`${id}-about`} rotulo="Recado" ajuda={`${form.about.length} de 139`}>
        <Input
          id={`${id}-about`}
          value={form.about}
          maxLength={139}
          onChange={(e) => mudar({ about: e.target.value })}
          placeholder="Ex.: O marketplace de eventos de Natal"
          className="h-11 md:h-9"
        />
      </Campo>
      <Campo
        id={`${id}-description`}
        rotulo="Descrição"
        ajuda={`${form.description.length} de 512`}
      >
        <textarea
          id={`${id}-description`}
          value={form.description}
          maxLength={512}
          rows={3}
          onChange={(e) => mudar({ description: e.target.value })}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </Campo>
      <Campo id={`${id}-address`} rotulo="Endereço">
        <Input
          id={`${id}-address`}
          value={form.address}
          maxLength={256}
          onChange={(e) => mudar({ address: e.target.value })}
          className="h-11 md:h-9"
        />
      </Campo>
      <Campo id={`${id}-email`} rotulo="E-mail">
        <Input
          id={`${id}-email`}
          type="email"
          value={form.email}
          maxLength={128}
          onChange={(e) => mudar({ email: e.target.value })}
          className="h-11 md:h-9"
        />
      </Campo>
      <Campo id={`${id}-site1`} rotulo="Sites" ajuda="Até 2, começando com https://">
        <div className="flex flex-col gap-2">
          <Input
            id={`${id}-site1`}
            type="url"
            value={form.site1}
            maxLength={256}
            onChange={(e) => mudar({ site1: e.target.value })}
            placeholder="https://"
            className="h-11 md:h-9"
          />
          <Input
            aria-label="Segundo site"
            type="url"
            value={form.site2}
            maxLength={256}
            onChange={(e) => mudar({ site2: e.target.value })}
            placeholder="https://"
            className="h-11 md:h-9"
          />
        </div>
      </Campo>
      <Campo id={`${id}-vertical`} rotulo="Categoria">
        <select
          id={`${id}-vertical`}
          value={vertical}
          onChange={(e) => mudar({ vertical: e.target.value })}
          className="h-11 w-full rounded-full border border-input bg-background px-3 text-base md:h-9 md:text-sm"
        >
          {vertical === '' ? <option value="">Escolha</option> : null}
          {VERTICAIS.map((v) => (
            <option key={v.valor} value={v.valor}>
              {v.rotulo}
            </option>
          ))}
          {verticalConhecida ? null : <option value={vertical}>{vertical}</option>}
        </select>
      </Campo>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => salvar.mutate()}
          disabled={!temMudanca || salvar.isPending}
          className="toque h-11 md:h-9"
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar no WhatsApp'}
        </Button>
        <Button
          variant="outline"
          onClick={() => ler.mutate()}
          disabled={ler.isPending || naFila}
          className="toque h-11 md:h-9"
        >
          <RefreshCw aria-hidden="true" />
          Ler do WhatsApp
        </Button>
      </div>
    </div>
  );
}

function Campo({
  id,
  rotulo,
  ajuda,
  children,
}: {
  id: string;
  rotulo: string;
  ajuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {rotulo}
        </label>
        {ajuda ? <span className="text-[11px] text-muted-foreground">{ajuda}</span> : null}
      </div>
      {children}
    </div>
  );
}
