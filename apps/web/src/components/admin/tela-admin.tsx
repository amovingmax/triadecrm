'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  Clock,
  Layers,
  Lock,
  MessageCircle,
  PhoneCall,
  Tag,
  Telescope,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { ROTULO_PAPEL } from '@/lib/auth/role';
import { type Sessao } from '@/lib/auth/session';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Chip } from '@/components/ui/chip';
import { FaixaDeslizante } from '@/components/ui/faixa-deslizante';

import { PainelCatalogos } from './painel-catalogos';
import { PainelLgpd } from './painel-lgpd';
import { PainelAtendimento } from './painel-atendimento';
import { PainelAvisos } from './painel-avisos';
import { PainelIntegracoes } from './painel-integracoes';
import { PainelLigacoes } from './painel-ligacoes';
import { PainelMercado } from './painel-mercado';
import { PainelPessoas } from './painel-pessoas';
import { PainelWhatsapp } from './painel-whatsapp';
import { ABAS_DA_EMPRESA, type Aba, type SecaoCatalogo, type SecaoLgpd } from './tipos';

/** O ícone de cada seção na coluna da esquerda (o mesmo desenho do protótipo). */
const ICONE_DA_ABA: Readonly<Record<Aba, LucideIcon>> = {
  pessoas: Users,
  avisos: Bell,
  atendimento: Clock,
  whatsapp: MessageCircle,
  ligacoes: PhoneCall,
  catalogos: Tag,
  integracoes: Layers,
  mercado: Telescope,
  lgpd: Lock,
};

/**
 * A tela de Ajustes (era "Admin"; PRD §7.9).
 *
 * Três partes numa rota só, com aba e seção na URL por `replaceState`: o mesmo recurso
 * da lista de parceiros, e pela mesma razão — `/admin?aba=lgpd&secao=auditoria` é um
 * link que se manda no grupo quando alguém pergunta "quem mexeu nisso?", e voltar tem
 * de sair de Ajustes, não desfazer clique por clique de aba.
 *
 * Cada painel busca o que precisa quando é aberto: Ajustes toca em dez tabelas, e
 * carregar as dez de uma vez faria a tela abrir devagar para mostrar, na maioria das
 * vezes, uma lista só.
 *
 * AS SEÇÕES (24/11/2026, protótipo responsivo da Imova). Eram nove abas numa faixa
 * só, e de 768 a 1024 px elas passavam da tela e a página inteira rolava de lado
 * (1.045 px numa tela de 768). Agora, do `lg` para cima, as seções ficam numa coluna
 * à esquerda, presa ao rolar, com ícone e nome; abaixo disso, numa linha de chips que
 * desliza DENTRO da tela. As duas são desenhadas e o CSS escolhe qual aparece: sem
 * decidir no cliente, a tela não pisca ao abrir.
 */
export function TelaAdmin({
  sessao,
  abaInicial,
  catalogoInicial,
  lgpdInicial,
}: {
  sessao: Sessao;
  abaInicial: Aba;
  catalogoInicial: SecaoCatalogo;
  lgpdInicial: SecaoLgpd;
}) {
  const [aba, setAba] = useState<Aba>(abaInicial);
  const [catalogo, setCatalogo] = useState<SecaoCatalogo>(catalogoInicial);
  const [lgpd, setLgpd] = useState<SecaoLgpd>(lgpdInicial);

  const secaoAtual = aba === 'catalogos' ? catalogo : aba === 'lgpd' ? lgpd : null;

  useEffect(() => {
    const busca = new URLSearchParams();
    busca.set('aba', aba);
    if (secaoAtual) busca.set('secao', secaoAtual);
    const alvo = `${window.location.pathname}?${busca.toString()}`;
    if (alvo !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', alvo);
    }
  }, [aba, secaoAtual]);

  const trocarAba = useCallback((nova: Aba) => setAba(nova), []);

  const descricao = ABAS_DA_EMPRESA.find((item) => item.id === aba)?.descricao ?? '';

  return (
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* "Ajustes", o mesmo nome do menu (era "Admin": o menu dizia uma coisa e a
              tela outra). */}
          <h1 className="font-heading text-[28px] leading-tight font-normal tracking-[-0.02em] md:text-[32px]">
            Ajustes
          </h1>
          <Badge variant="pilula" className="h-6 gap-1.5 px-2.5 text-[11px] font-normal">
            você entra como {ROTULO_PAPEL[sessao.papel]}
          </Badge>
        </div>
        {/* `90ch` e não `max-w-prose` (65ch): a descrição da aba é uma frase só, e
            em 65ch ela quebrava no meio ("...lista de / permitidos"). */}
        <p className="max-w-[90ch] text-sm text-muted-foreground">{descricao}</p>
      </header>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:items-start lg:gap-6">
        <nav aria-label="Seções dos ajustes" className="lg:sticky lg:top-[92px]">
          {/* Celular, tablet e notebook estreito: os chips deslizam dentro da tela, até a
              borda, e a seção escolhida fica à vista. */}
          <FaixaDeslizante rotulo="Seções dos ajustes" ativo={aba} sangria className="lg:hidden">
            {ABAS_DA_EMPRESA.map((item) => (
              <Chip key={item.id} ativo={item.id === aba} onClick={() => trocarAba(item.id)}>
                {item.rotulo}
              </Chip>
            ))}
          </FaixaDeslizante>

          {/* Do `lg` para cima: a coluna da esquerda, com ícone e nome. */}
          <ul className="hidden flex-col gap-0.5 lg:flex">
            {ABAS_DA_EMPRESA.map((item) => {
              const Icone = ICONE_DA_ABA[item.id];
              const ativa = item.id === aba;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={ativa ? 'true' : undefined}
                    onClick={() => trocarAba(item.id)}
                    className={cn(
                      'toque flex h-[42px] w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm transition-colors',
                      'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                      ativa
                        ? 'bg-card font-semibold text-foreground sombra-base'
                        : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icone
                      className={cn('size-4 shrink-0', ativa && 'text-menta-texto')}
                      aria-hidden="true"
                    />
                    <span className="truncate">{item.rotulo}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          {aba === 'pessoas' ? <PainelPessoas sessao={sessao} /> : null}
          {aba === 'avisos' ? <PainelAvisos /> : null}
          {aba === 'atendimento' ? (
            <PainelAtendimento podeEditar={sessao.papel === 'admin' || sessao.papel === 'gestor'} />
          ) : null}
          {aba === 'whatsapp' ? <PainelWhatsapp papel={sessao.papel} /> : null}
          {aba === 'ligacoes' ? (
            <PainelLigacoes podeEditar={sessao.papel === 'admin' || sessao.papel === 'gestor'} />
          ) : null}
          {aba === 'catalogos' ? (
            <PainelCatalogos
              secao={catalogo}
              aoTrocarSecao={setCatalogo}
              podeEsquecer={sessao.papel === 'admin' || sessao.papel === 'gestor'}
            />
          ) : null}
          {aba === 'integracoes' ? <PainelIntegracoes eu={sessao.id} /> : null}
          {aba === 'mercado' ? <PainelMercado /> : null}
          {aba === 'lgpd' ? (
            <PainelLgpd sessao={sessao} secao={lgpd} aoTrocarSecao={setLgpd} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
