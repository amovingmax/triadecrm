'use client';

import { BellOff, BellRing } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { estouNoApp } from '@/lib/auth/entrada-pelo-app';
import { EMPRESA } from '@/lib/empresa';
import { estaAtivo } from '@/lib/navegacao';
import { createClient } from '@/lib/supabase/client';

import { permissaoAtual } from './aviso-do-navegador';
import {
  adiarAte,
  assinaturaDoEstado,
  faixaDosAvisos,
  identificarNavegador,
  idDoAparelhoValido,
  lerUltimoRegistro,
  passosParaDesbloquear,
  precisaRegistrar,
  rotuloDoNavegador,
  type EstadoDoNavegador,
} from './avisos-da-equipe';
import { avisarDaPermissao } from './convite-de-avisos';
import { estaSilenciado, somEstaLigado, useFaixaAdiada } from './preferencias';
import { useAvisos } from './provedor-avisos';
import { destravarSom } from './som';
import { testarAvisoDesteComputador } from './testar-aviso';

/**
 * Os avisos deste computador (11/11/2026, só na Imova, módulo `avisosDaEquipe`).
 *
 * Pedido: "Instalar o app em toda a equipe ou, no mínimo, ligar a notificação do
 * navegador em cada computador." Duas coisas, montadas uma vez na casca:
 *
 * 1. **O registro.** Ao abrir o CRM, ao voltar para a aba e quando a permissão, o
 *    som ou o silêncio mudam, este navegador conta ao banco se avisa
 *    (`public.avisos_registrar_navegador`, migração 20261111202000): a permissão,
 *    o som, o silêncio, um rótulo como "Chrome no Mac" e um id sorteado aqui e
 *    guardado no próprio navegador. O mesmo estado vai no máximo uma vez por hora.
 *    É o que a gestão lê em Ajustes → Avisos. Dentro do app de celular não
 *    registra: lá o aviso é o do app.
 * 2. **A faixa.** No alto do conteúdo, só no computador, para quem recebe avisos:
 *    "Ligar avisos" quando o navegador ainda não perguntou, e o passo a passo para
 *    desbloquear quando a pessoa recusou. "Agora não" esconde por três dias. Fica
 *    fora da troca de tela (não reaparece animada a cada página) e não entra em
 *    Conversas, que ocupa a altura inteira da janela.
 *
 * Na Imova a faixa toma o lugar do convite da pilha de avisos, que saía de vez
 * no primeiro "Agora não".
 */
export function AvisosDesteComputador({ usuarioId }: { usuarioId: string }) {
  const avisos = useAvisos();
  const ligada = EMPRESA.modulos.avisosDaEquipe && avisos.recebe;

  useRegistroDoNavegador({
    usuarioId,
    ligado: ligada,
    // Não entram na conta: o efeito lê o estado de verdade na hora. Estão aqui
    // para ele rodar de novo quando algum muda.
    permissao: avisos.permissao,
    somLigado: avisos.somLigado,
    silenciado: avisos.silenciado,
  });

  const noApp = useSyncExternalStore(nadaAssinar, lerNoApp, () => false);
  const computador = useSyncExternalStore(nadaAssinar, lerComputador, () => false);
  const [adiadaAte, adiar] = useFaixaAdiada(usuarioId);
  const agora = useAgora();
  const rota = usePathname();
  const [passosAbertos, setPassosAbertos] = useState(false);

  const faixa = faixaDosAvisos({
    ligada,
    noApp,
    computador,
    permissao: avisos.permissao,
    silenciado: avisos.silenciado,
    adiadaAte,
    agora,
  });
  if (faixa === null || estaAtivo(rota, '/conversas')) return null;

  function ligarAvisos() {
    destravarSom();
    void avisos.pedirPermissao().then((resultado) => {
      if (resultado !== 'liberada') {
        avisarDaPermissao(resultado);
        return;
      }
      toast.success('Avisos ligados neste computador.', {
        description:
          'Quando um cliente escrever, o aviso aparece mesmo com o CRM em outra aba ou minimizado.',
        action: {
          label: 'Testar',
          onClick: () => void testarAvisoDesteComputador(avisos.somLigado),
        },
        duration: 10_000,
      });
    });
  }

  const { navegador, sistema } =
    faixa === 'desbloquear'
      ? identificarNavegador(navigator.userAgent, navigator.maxTouchPoints)
      : { navegador: 'Navegador' as const, sistema: null };

  return (
    <section
      aria-label="Avisos deste computador"
      className="sombra-base mb-4 rounded-xl border border-hairline bg-card text-sm md:mb-6"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 pr-2 pl-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-menta text-menta-tinta">
          {faixa === 'ligar' ? (
            <BellRing className="size-4" aria-hidden="true" />
          ) : (
            <BellOff className="size-4" aria-hidden="true" />
          )}
        </span>
        <p className="min-w-0 flex-1 leading-snug">
          {faixa === 'ligar'
            ? 'Ligue os avisos deste computador para saber na hora quando um cliente escreve.'
            : 'O navegador bloqueou os avisos deste computador: mensagem nova só aparece com o CRM na frente.'}
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {faixa === 'ligar' ? (
            <Button size="sm" className="toque h-9" onClick={ligarAvisos}>
              Ligar avisos
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="toque h-9"
              aria-expanded={passosAbertos}
              aria-controls="passos-para-desbloquear"
              onClick={() => setPassosAbertos((aberto) => !aberto)}
            >
              Como desbloquear
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="toque h-9 text-muted-foreground"
            onClick={() => adiar(adiarAte(Date.now()))}
          >
            Agora não
          </Button>
        </div>
      </div>
      {faixa === 'desbloquear' && passosAbertos ? (
        <ol
          id="passos-para-desbloquear"
          className="flex list-decimal flex-col gap-1.5 border-t border-hairline py-3 pr-4 pl-[3.25rem] leading-snug text-muted-foreground marker:text-muted-foreground"
        >
          {passosParaDesbloquear(navegador, sistema).map((passo) => (
            <li key={passo}>{passo}</li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// O registro do navegador
// ---------------------------------------------------------------------------

/** O id deste navegador: um por navegador, e não por pessoa. */
const CHAVE_DO_APARELHO = 'komune.avisos.aparelho.v1';
/** O último registro de cada pessoa neste navegador. */
const CHAVE_DO_REGISTRO = 'komune.avisos.registro.v1';

/** Um id v4. `crypto.randomUUID` só existe em https; o sorteio, em qualquer página. */
function sortearId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * O id guardado, ou um novo. Sem armazenamento (aba anônima, bloqueio) não há
 * id que dure, e o navegador não é registrado: cada recarga viraria uma linha.
 */
function idDesteNavegador(): string | null {
  try {
    const guardado = window.localStorage.getItem(CHAVE_DO_APARELHO);
    if (idDoAparelhoValido(guardado)) return guardado;
    const novo = sortearId();
    window.localStorage.setItem(CHAVE_DO_APARELHO, novo);
    return window.localStorage.getItem(CHAVE_DO_APARELHO) === novo ? novo : null;
  } catch {
    return null;
  }
}

function lerRegistro(usuarioId: string) {
  try {
    return lerUltimoRegistro(window.localStorage.getItem(`${CHAVE_DO_REGISTRO}:${usuarioId}`));
  } catch {
    return null;
  }
}

function gravarRegistro(usuarioId: string, assinatura: string, em: number): void {
  try {
    window.localStorage.setItem(
      `${CHAVE_DO_REGISTRO}:${usuarioId}`,
      JSON.stringify({ assinatura, em }),
    );
  } catch {
    // Sem armazenamento, o próximo sinal vai de novo; o banco segura a repetição.
  }
}

/** Um registro por vez nesta aba. */
let registrando = false;

async function registrar(usuarioId: string): Promise<void> {
  if (registrando || estouNoApp(navigator.userAgent)) return;
  const aparelho = idDesteNavegador();
  if (!aparelho) return;

  const estado: EstadoDoNavegador = {
    permissao: permissaoAtual(),
    som: somEstaLigado(usuarioId),
    silenciado: estaSilenciado(usuarioId),
    rotulo: rotuloDoNavegador(navigator.userAgent, navigator.maxTouchPoints),
  };
  const assinatura = assinaturaDoEstado(estado);
  const agora = Date.now();
  if (!precisaRegistrar(lerRegistro(usuarioId), assinatura, agora)) return;

  registrando = true;
  try {
    // Anotado antes de saber se deu certo: se falhar (rede, banco sem a
    // migração), tenta de novo dali a uma hora ou quando o estado mudar, e não a
    // cada volta para a aba.
    gravarRegistro(usuarioId, assinatura, agora);
    await createClient().rpc('avisos_registrar_navegador', {
      p_aparelho: aparelho,
      p_permissao: estado.permissao,
      p_som: estado.som,
      p_silenciado: estado.silenciado,
      p_rotulo: estado.rotulo,
    });
  } catch {
    // O registro é para a gestão: falhar aqui não mexe em aviso nenhum.
  } finally {
    registrando = false;
  }
}

function useRegistroDoNavegador({
  usuarioId,
  ligado,
  permissao,
  somLigado,
  silenciado,
}: {
  usuarioId: string;
  ligado: boolean;
  permissao: string;
  somLigado: boolean;
  silenciado: boolean;
}) {
  useEffect(() => {
    if (!ligado) return;
    void registrar(usuarioId);
    const aoVoltar = () => {
      if (!document.hidden) void registrar(usuarioId);
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [ligado, usuarioId, permissao, somLigado, silenciado]);
}

// ---------------------------------------------------------------------------
// O que só o navegador sabe
// ---------------------------------------------------------------------------

const nadaAssinar = () => () => {};
const lerNoApp = () => estouNoApp(navigator.userAgent);
/** Computador = ponteiro fino, como em "Instalar o Tríade neste computador". */
const lerComputador = () => window.matchMedia('(pointer: fine)').matches;

/** O relógio da faixa: os três dias do "Agora não" acabam com a aba aberta. */
function useAgora(passoMs = 10 * 60_000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const relogio = window.setInterval(() => setAgora(Date.now()), passoMs);
    return () => window.clearInterval(relogio);
  }, [passoMs]);
  return agora;
}
