'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Footprints, Loader2, Pencil, UsersRound, Video, X } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SeletorDeAba } from '@/components/ui/abas';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';
import type { SugestaoDeAlvo } from '@/components/registro/tipos';

import {
  faixaDoHorario,
  livresDoDia,
  marcarReuniao,
  marcarVisita,
  recadoDoMotivo,
  type ConflitoDeVisita,
  type HorarioLivre,
} from './acoes-reuniao';
import { CampoParceiro } from './campo-parceiro';
import { lerSala, salvarMinhaSala, validarSala, type SalaDaPessoa } from './sala';
import { diaDoInstante, ehFimDeSemana, horaEmNatal, rotuloDiaPorExtenso, type Dia } from './tipos';

/**
 * Marcar um compromisso direto pela Agenda: reunião ou visita.
 *
 * DE QUEM É O COMPROMISSO. Nasce na agenda de QUEM MARCA. Gestor e admin podem,
 * de propósito, escolher em "Para quem" alguém que acompanham (a lista é a da
 * hierarquia, `lib/auth/hierarquia.ts`, e o banco confere de novo em
 * `app.pode_marcar_para`). Com outra pessoa escolhida, a folha muda de cara: a
 * faixa âmbar diz na agenda de quem o compromisso vai cair, os horários livres
 * são os dela, e o botão diz o nome dela. Quem recebe ganha um aviso
 * (`agenda_avisos`, e o e-mail de reunião de sempre).
 *
 * Nada de regra de horário aqui — quem confere se a pessoa está livre é o banco:
 *
 *  · **Reunião** escolhe um dos horários livres da MESMA grade que o robô usa
 *    (`reuniao_livres`, a da tira "Livres hoje") e grava por
 *    `reuniao_marcar_na_agenda`, com a trava de colisão, o teto do dia e o
 *    e-mail. Precisa de um negócio aberto: parceiro sem negócio vai para a ficha.
 *    On-line, a sala de quem atende é OPCIONAL para quem marca pela tela (só o
 *    robô não marca sem ela) — e é aqui que cada pessoa cadastra a sua (`sala.ts`).
 *  · **Visita** grava por `visita_marcar`, que recusa o horário em que a pessoa
 *    já tem reunião ou outra visita, e diz com o quê bateu.
 */
type Tipo = 'reuniao' | 'visita';

export type PessoaParaMarcar = { id: string; nome: string };

export function FolhaNovoCompromisso({
  aberta,
  usuarioId,
  pessoas,
  paraInicial,
  feriados,
  diaInicial,
  hoje,
  aoFechar,
  aoMarcar,
}: {
  aberta: boolean;
  /** `public.holidays`: com sábado e domingo, os dias em que nada se marca. */
  feriados: readonly string[];
  usuarioId: string;
  /** A agenda aberta na tela: é nela que a folha começa. Fora da lista, quem marca. */
  paraInicial: string;
  /**
   * Quem pode receber o compromisso: a própria pessoa e quem ela acompanha. Com
   * uma pessoa só (ou vazia), o campo "Para quem" nem aparece.
   */
  pessoas: readonly PessoaParaMarcar[];
  diaInicial: Dia;
  hoje: Dia;
  aoFechar: () => void;
  /** Gravou: a tela recarrega e vai até o dia marcado, na agenda de quem recebeu. */
  aoMarcar: (dia: Dia, donoId: string) => void;
}) {
  const ehCelular = useEhCelular();
  return (
    <Sheet open={aberta} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <SheetContent
        side={ehCelular ? 'bottom' : 'right'}
        className="sombra-base-forte max-h-[92dvh] overflow-y-auto pb-[calc(1rem+var(--area-segura-inferior))] max-md:rounded-t-xl sm:max-w-md md:max-h-none"
      >
        <SheetHeader>
          <SheetTitle>Novo compromisso</SheetTitle>
          <SheetDescription>Reunião na grade do robô, ou visita com dia e hora.</SheetDescription>
        </SheetHeader>
        {/* A `key` zera o formulário a cada abertura: começar com o parceiro — ou
            com a pessoa — da última vez é o jeito de marcar no lugar errado. */}
        {aberta ? (
          <Formulario
            key={`${diaInicial}-${paraInicial}`}
            usuarioId={usuarioId}
            pessoas={pessoas}
            paraInicial={pessoas.some((p) => p.id === paraInicial) ? paraInicial : usuarioId}
            feriados={feriados}
            diaInicial={diaInicial < hoje ? hoje : diaInicial}
            hoje={hoje}
            aoMarcar={aoMarcar}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

function Formulario({
  usuarioId,
  pessoas,
  paraInicial,
  feriados,
  diaInicial,
  hoje,
  aoMarcar,
}: {
  usuarioId: string;
  pessoas: readonly PessoaParaMarcar[];
  paraInicial: string;
  feriados: readonly string[];
  diaInicial: Dia;
  hoje: Dia;
  aoMarcar: (dia: Dia, donoId: string) => void;
}) {
  const id = useId();
  const [tipo, setTipo] = useState<Tipo>('reuniao');
  const [alvo, setAlvo] = useState<SugestaoDeAlvo | null>(null);
  const [dia, setDia] = useState<Dia>(diaInicial);
  const [para, setPara] = useState<string>(paraInicial);

  const escolheEquipe = pessoas.length > 1;
  // Sábado, domingo e feriado: bloqueados de vez. O banco recusa do mesmo jeito
  // (`app.eh_dia_util`); a tela só diz antes, para ninguém escolher parceiro e hora
  // num dia que não vai passar.
  const diaBloqueado = ehFimDeSemana(dia) || feriados.includes(dia);
  const outraPessoa = para === usuarioId ? null : (pessoas.find((p) => p.id === para) ?? null);

  return (
    <div className="flex flex-col gap-5 px-4 pb-4">
      <SeletorDeAba
        rotulo="Tipo de compromisso"
        ativo={tipo}
        aoTrocar={setTipo}
        itens={[
          { id: 'reuniao', rotulo: 'Reunião' },
          { id: 'visita', rotulo: 'Visita' },
        ]}
      />

      {escolheEquipe ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-para`} className="text-sm font-medium">
            Para quem
          </label>
          <Select value={para} onValueChange={setPara}>
            <SelectTrigger id={`${id}-para`} className="h-11 w-full md:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pessoas.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.id === usuarioId ? `Para mim (${p.nome})` : p.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {outraPessoa ? (
            <p
              role="status"
              className="flex items-start gap-2.5 rounded-lg bg-morno-fundo px-3 py-2.5 text-sm text-morno-texto"
            >
              <UsersRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Você está marcando na agenda de{' '}
                <span className="font-semibold">{outraPessoa.nome}</span>, e não na sua.{' '}
                {primeiroNome(outraPessoa.nome)} recebe o compromisso e um aviso no CRM
                {tipo === 'reuniao' ? ', além do e-mail de reunião marcada' : ''}.
              </span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-parceiro`} className="text-sm font-medium">
          Parceiro
        </label>
        {alvo ? (
          <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/45 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{alvo.nome}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[alvo.categoria, alvo.bairro, alvo.etapa].filter(Boolean).join(' · ') ||
                  'Sem categoria e sem bairro'}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="toque h-11 shrink-0 md:h-8"
              onClick={() => setAlvo(null)}
              aria-label="Trocar o parceiro"
            >
              <X aria-hidden="true" />
              Trocar
            </Button>
          </div>
        ) : (
          <CampoParceiro id={`${id}-parceiro`} usuarioId={usuarioId} aoEscolher={setAlvo} />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-dia`} className="text-sm font-medium">
          Dia
        </label>
        <Input
          id={`${id}-dia`}
          type="date"
          min={hoje}
          value={dia}
          onChange={(e) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setDia(e.target.value);
          }}
          className="h-11 md:h-9"
        />
        <p className="text-xs text-muted-foreground first-letter:uppercase">
          {rotuloDiaPorExtenso(dia)}
        </p>
        {diaBloqueado ? (
          <p role="alert" className="text-xs text-destructive-texto">
            {feriados.includes(dia) && !ehFimDeSemana(dia) ? 'É feriado. ' : ''}
            {recadoDoMotivo('dia_nao_util')}
          </p>
        ) : null}
      </div>

      {alvo === null || diaBloqueado ? null : tipo === 'reuniao' ? (
        <ParteDaReuniao
          key={`${alvo.id}-${dia}-${para}`}
          alvo={alvo}
          dia={dia}
          donoId={para}
          outraPessoa={outraPessoa}
          aoMarcar={aoMarcar}
        />
      ) : (
        <ParteDaVisita
          key={`${alvo.id}-${dia}-${para}`}
          alvo={alvo}
          dia={dia}
          donoId={para}
          outraPessoa={outraPessoa}
          aoMarcar={aoMarcar}
        />
      )}
    </div>
  );
}

function ParteDaReuniao({
  alvo,
  dia,
  donoId,
  outraPessoa,
  aoMarcar,
}: {
  alvo: SugestaoDeAlvo;
  dia: Dia;
  donoId: string;
  outraPessoa: PessoaParaMarcar | null;
  aoMarcar: (dia: Dia, donoId: string) => void;
}) {
  const id = useId();
  const [formato, setFormato] = useState<'online' | 'presencial'>('online');
  const [local, setLocal] = useState('');
  const [observacao, setObservacao] = useState('');
  const [escolhido, setEscolhido] = useState<HorarioLivre | null>(null);
  const [recusa, setRecusa] = useState<{ frase: string; alternativas: HorarioLivre[] } | null>(
    null,
  );
  const [gravando, setGravando] = useState(false);
  const dealId = alvo.dealId;

  // Os livres DE QUEM VAI RECEBER: a própria pessoa (sem `p_dono`) ou quem ela
  // escolheu — `reuniao_livres` só deixa gestor e admin lerem a grade de outra.
  const livres = useQuery({
    queryKey: ['agenda', 'livres', dia, outraPessoa ? donoId : null],
    queryFn: () => livresDoDia(dia, outraPessoa ? donoId : undefined),
    enabled: dealId !== null,
    staleTime: 30_000,
  });

  // A sala DE QUEM VAI RECEBER. É opcional: sem ela a reunião é marcada sem
  // link, e a folha só diz isso antes.
  const sala = useQuery({
    queryKey: ['agenda', 'sala', donoId],
    queryFn: () => lerSala(donoId),
    enabled: dealId !== null,
    staleTime: 60_000,
  });

  if (!dealId) {
    return (
      <p className="rounded-lg bg-muted/45 px-3 py-3 text-sm text-muted-foreground">
        Este parceiro não está em nenhum funil, e a reunião nasce do negócio. Abra a ficha e coloque
        ele no funil antes de marcar.{' '}
        <Link
          href={`/parceiros/${alvo.id}`}
          className="text-foreground underline underline-offset-2"
        >
          Abrir a ficha
        </Link>
      </p>
    );
  }

  // Recusa sem alternativa (sem sala, parceiro suprimido) não esvazia a grade:
  // os horários do dia continuam valendo, e dizer "nenhum horário livre" era mentira.
  const opcoes =
    recusa && recusa.alternativas.length > 0 ? recusa.alternativas : (livres.data ?? []);
  const deQuem = outraPessoa ? `de ${primeiroNome(outraPessoa.nome)}` : 'seus';

  async function marcar() {
    if (!escolhido || !dealId) return;
    if (formato === 'presencial' && local.trim() === '') {
      setRecusa({ frase: recadoDoMotivo('sem_lugar'), alternativas: opcoes });
      return;
    }
    setGravando(true);
    const r = await marcarReuniao({
      dealId,
      inicio: escolhido.inicio,
      formato,
      local: formato === 'presencial' ? local.trim() : null,
      observacao: observacao.trim() || null,
      donoId: outraPessoa ? donoId : null,
    });
    setGravando(false);
    if (r.ok) {
      toast.success(
        outraPessoa
          ? `Reunião marcada na agenda de ${outraPessoa.nome}, que recebeu um aviso.`
          : 'Reunião marcada na sua agenda.',
      );
      aoMarcar(diaDoInstante(escolhido.inicio), donoId);
      return;
    }
    setEscolhido(null);
    if (r.alternativas.length === 0) void livres.refetch();
    setRecusa({
      frase:
        r.alternativas.length > 0
          ? `${recadoDoMotivo(r.motivo)} Estes ainda estão livres:`
          : recadoDoMotivo(r.motivo),
      alternativas: r.alternativas,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SeletorDeAba
        rotulo="Formato da reunião"
        ativo={formato}
        aoTrocar={setFormato}
        itens={[
          { id: 'online', rotulo: 'On-line' },
          { id: 'presencial', rotulo: 'Presencial' },
        ]}
      />

      {formato === 'presencial' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-local`} className="text-sm font-medium">
            Endereço
          </label>
          <Input
            id={`${id}-local`}
            value={local}
            maxLength={300}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="Rua, número e bairro"
            className="h-11 md:h-9"
          />
        </div>
      ) : (
        <SalaDaReuniao
          donoId={donoId}
          outraPessoa={outraPessoa}
          sala={sala.data}
          falhou={sala.isError}
          aoSalvar={() => setRecusa(null)}
        />
      )}

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Horários livres {deQuem}</p>
        {recusa ? <p className="text-xs text-destructive-texto">{recusa.frase}</p> : null}
        {!recusa && livres.isPending ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            <Loader2 className="inline size-4 animate-spin" aria-hidden="true" /> Procurando
            horários…
          </p>
        ) : opcoes.length === 0 ? (
          <p className="rounded-lg bg-muted/45 px-3 py-3 text-sm text-muted-foreground">
            Nenhum horário livre neste dia. Domingo, feriado, dia cheio, dia de rota ou horário já
            ocupado não entram na grade. Escolha outro dia.
          </p>
        ) : (
          <div role="radiogroup" aria-label="Horários livres" className="flex flex-wrap gap-2">
            {opcoes.map((h) => {
              const ativo = escolhido?.inicio === h.inicio;
              return (
                <Button
                  key={h.inicio}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  variant="outline"
                  size="lg"
                  className={cn(
                    'toque h-11 md:h-9',
                    ativo && 'border-transparent bg-menta text-menta-tinta hover:bg-menta',
                  )}
                  onClick={() => setEscolhido(h)}
                  title={h.quandoPorExtenso}
                >
                  <span className="numerico">
                    {diaDoInstante(h.inicio) === dia
                      ? ''
                      : `${h.quandoPorExtenso.split(',')[0]} · `}
                    {faixaDoHorario(h)}
                  </span>
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-obs`} className="text-sm font-medium">
          Observação <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        <textarea
          id={`${id}-obs`}
          rows={2}
          maxLength={500}
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      </div>

      <Button
        size="lg"
        className="toque h-11 md:h-10"
        disabled={!escolhido || gravando}
        onClick={() => void marcar()}
      >
        {gravando ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Video aria-hidden="true" />
        )}
        {outraPessoa ? `Marcar reunião para ${primeiroNome(outraPessoa.nome)}` : 'Marcar reunião'}
      </Button>
    </div>
  );
}

/**
 * A sala da reunião on-line: a de quem vai receber o compromisso.
 *
 * Opcional. Na própria agenda, a pessoa cadastra e troca a sala aqui mesmo. Na de outra
 * pessoa a folha só mostra: o RLS deixa cada um escrever a própria linha, e a
 * sala é o link que o parceiro recebe — não é de quem marca.
 */
function SalaDaReuniao({
  donoId,
  outraPessoa,
  sala,
  falhou,
  aoSalvar,
}: {
  donoId: string;
  outraPessoa: PessoaParaMarcar | null;
  sala: SalaDaPessoa | undefined;
  falhou: boolean;
  aoSalvar: () => void;
}) {
  const id = useId();
  const clienteDeConsultas = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  if (falhou) {
    return (
      <p className="text-xs text-muted-foreground">
        Não deu para conferir a sala de reunião agora. Dá para marcar assim mesmo.
      </p>
    );
  }
  if (!sala) {
    return <p className="text-xs text-muted-foreground">Conferindo a sala de reunião…</p>;
  }

  if (outraPessoa) {
    const nome = primeiroNome(outraPessoa.nome);
    if (sala.propria) {
      return (
        <p className="truncate text-xs text-muted-foreground">
          Sala de {nome}: <span className="text-foreground">{sala.propria}</span>
        </p>
      );
    }
    if (sala.padrao) {
      return <p className="text-xs text-muted-foreground">{nome} usa a sala padrão da casa.</p>;
    }
    return (
      <p className="text-xs text-muted-foreground">
        {nome} não tem sala cadastrada. A reunião é marcada sem link, e {nome} combina a sala com o
        parceiro.
      </p>
    );
  }

  async function salvar() {
    const r = validarSala(texto);
    if (!r.ok) {
      setErro(r.recado);
      return;
    }
    setSalvando(true);
    const gravou = await salvarMinhaSala(donoId, r.url);
    setSalvando(false);
    if (!gravou.ok) {
      setErro('Não deu para salvar a sala. Tente de novo.');
      return;
    }
    await clienteDeConsultas.invalidateQueries({ queryKey: ['agenda', 'sala', donoId] });
    setEditando(false);
    setErro(null);
    toast.success('Sala de reunião salva. Ela vale para as próximas reuniões on-line.');
    aoSalvar();
  }

  if (!editando && sala.propria) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          Sua sala: <span className="text-foreground">{sala.propria}</span>
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="toque h-11 shrink-0 md:h-8"
          onClick={() => {
            setTexto(sala.propria ?? '');
            setEditando(true);
          }}
          aria-label="Trocar a sala de reunião"
        >
          <Pencil aria-hidden="true" />
          Trocar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-sala`} className="text-sm font-medium">
        Sua sala de reunião <span className="font-normal text-muted-foreground">(opcional)</span>
      </label>
      <div className="flex gap-2">
        <Input
          id={`${id}-sala`}
          type="url"
          inputMode="url"
          autoComplete="off"
          value={texto}
          maxLength={300}
          onChange={(e) => {
            setTexto(e.target.value);
            setErro(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void salvar();
          }}
          placeholder="https://meet.google.com/abc-defg-hij"
          aria-invalid={erro !== null}
          className="h-11 md:h-9"
        />
        <Button
          variant="outline"
          size="lg"
          className="toque h-11 shrink-0 md:h-9"
          disabled={salvando}
          onClick={() => void salvar()}
        >
          {salvando ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Salvar sala
        </Button>
      </div>
      {erro ? (
        <p role="alert" className="text-xs text-destructive-texto">
          {erro}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {sala.propria
          ? 'A troca vale para as próximas reuniões. As já marcadas ficam com a sala antiga.'
          : sala.padrao
            ? 'Sem a sua, vale a sala padrão da casa. Cole aqui o link permanente da sua sala, se tiver.'
            : 'Não é obrigatório. Com o link salvo (Google Meet, Zoom, Jitsi…), a reunião já nasce com o botão "Entrar na sala". Sem ele, a reunião é marcada do mesmo jeito e você combina a sala com o parceiro.'}
      </p>
    </div>
  );
}

function ParteDaVisita({
  alvo,
  dia,
  donoId,
  outraPessoa,
  aoMarcar,
}: {
  alvo: SugestaoDeAlvo;
  dia: Dia;
  donoId: string;
  outraPessoa: PessoaParaMarcar | null;
  aoMarcar: (dia: Dia, donoId: string) => void;
}) {
  const id = useId();
  const [hora, setHora] = useState('14:00');
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<{ frase: string; conflitos: ConflitoDeVisita[] } | null>(null);

  async function marcar() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
      setErro({ frase: 'Escolha a hora da visita.', conflitos: [] });
      return;
    }
    setGravando(true);
    const r = await marcarVisita({
      organizationId: alvo.id,
      dealId: alvo.dealId,
      // Hora de Natal, dita com o fuso: o aparelho pode estar noutro.
      inicio: `${dia}T${hora}:00-03:00`,
      donoId: outraPessoa ? donoId : null,
    });
    setGravando(false);
    if (r.ok) {
      toast.success(
        outraPessoa
          ? `Visita marcada na agenda de ${outraPessoa.nome}, que recebeu um aviso.`
          : 'Visita marcada na sua agenda.',
      );
      aoMarcar(dia, donoId);
      return;
    }
    setErro({
      frase:
        r.motivo === 'horario_ocupado'
          ? outraPessoa
            ? `${primeiroNome(outraPessoa.nome)} já tem compromisso nesse horário:`
            : 'Você já tem compromisso nesse horário:'
          : recadoDoMotivo(r.motivo),
      conflitos: r.conflitos,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-hora`} className="text-sm font-medium">
          Hora
        </label>
        <Input
          id={`${id}-hora`}
          type="time"
          step={300}
          value={hora}
          onChange={(e) => {
            setHora(e.target.value);
            setErro(null);
          }}
          className="h-11 md:h-9"
        />
        <p className="text-xs text-muted-foreground">
          Hora de Natal. A visita ocupa 45 minutos na agenda{' '}
          {outraPessoa ? `de ${primeiroNome(outraPessoa.nome)}` : 'sua'}, e não pode cair em cima de
          outra reunião ou visita, nem em sábado, domingo ou feriado.
        </p>
        {erro ? (
          <div className="text-xs text-destructive-texto">
            <p>{erro.frase}</p>
            {erro.conflitos.length > 0 ? (
              <ul className="mt-1 list-disc pl-4">
                {erro.conflitos.map((c) => (
                  <li key={`${c.inicio}-${c.titulo}`}>
                    <span className="numerico">{horaEmNatal(c.inicio)}</span> · {c.titulo}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <Button
        size="lg"
        className="toque h-11 md:h-10"
        disabled={gravando}
        onClick={() => void marcar()}
      >
        {gravando ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Footprints aria-hidden="true" />
        )}
        {outraPessoa ? `Marcar visita para ${primeiroNome(outraPessoa.nome)}` : 'Marcar visita'}
      </Button>
    </div>
  );
}

/** O botão do cabeçalho da Agenda. */
export function BotaoNovoCompromisso({ aoClicar }: { aoClicar: () => void }) {
  return (
    <Button size="lg" className="toque h-11 md:h-9" onClick={aoClicar}>
      <CalendarPlus aria-hidden="true" />
      Novo compromisso
    </Button>
  );
}
