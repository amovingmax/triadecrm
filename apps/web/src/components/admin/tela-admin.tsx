'use client';

import { useCallback, useEffect, useState } from 'react';

import { ROTULO_PAPEL } from '@/lib/auth/role';
import { type Sessao } from '@/lib/auth/session';
import { Badge } from '@/components/ui/badge';

import { SeletorDeAba } from './abas';
import { PainelCatalogos } from './painel-catalogos';
import { PainelLgpd } from './painel-lgpd';
import { PainelPessoas } from './painel-pessoas';
import { ABAS, type Aba, type SecaoCatalogo, type SecaoLgpd } from './tipos';

/**
 * A tela de Admin (PRD §7.9).
 *
 * Três partes numa rota só, com aba e seção na URL por `replaceState`: o mesmo recurso
 * da lista de parceiros, e pela mesma razão — `/admin?aba=lgpd&secao=auditoria` é um
 * link que se manda no grupo quando alguém pergunta "quem mexeu nisso?", e voltar tem
 * de sair da Admin, não desfazer clique por clique de aba.
 *
 * Cada painel busca o que precisa quando é aberto: a Admin toca em dez tabelas, e
 * carregar as dez de uma vez faria a tela abrir devagar para mostrar, na maioria das
 * vezes, uma lista só.
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

  const descricao = ABAS.find((item) => item.id === aba)?.descricao ?? '';

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Admin</h1>
          <Badge variant="pilula" className="h-6 gap-1.5 px-2.5 text-[11px] font-normal">
            você entra como {ROTULO_PAPEL[sessao.papel]}
          </Badge>
        </div>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{descricao}</p>
      </header>

      <SeletorDeAba
        rotulo="Partes da administração"
        itens={ABAS.map((item) => ({ id: item.id, rotulo: item.rotulo }))}
        ativo={aba}
        aoTrocar={trocarAba}
      />

      {aba === 'pessoas' ? <PainelPessoas sessao={sessao} /> : null}
      {aba === 'catalogos' ? (
        <PainelCatalogos secao={catalogo} aoTrocarSecao={setCatalogo} />
      ) : null}
      {aba === 'lgpd' ? <PainelLgpd sessao={sessao} secao={lgpd} aoTrocarSecao={setLgpd} /> : null}
    </div>
  );
}
