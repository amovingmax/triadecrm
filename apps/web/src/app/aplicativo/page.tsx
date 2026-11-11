import type { Metadata } from 'next';

import { Email, Link, Lista, Secao } from '@/components/pagina-publica';
import { APLICATIVO } from '@/lib/aplicativo';

/**
 * A página de suporte do app de celular (`/aplicativo`), aberta sem login
 * (`ehRotaPublica`). É o link de suporte que a ficha da App Store pede: diz o que é o
 * app, quem pode usar e como falar com a KOMUNE.
 */

export const metadata: Metadata = {
  title: 'App Tríade: suporte',
  description: 'O app Tríade, das equipes da KOMUNE e da Imova: quem pode usar e como pedir ajuda.',
};

export default function Aplicativo() {
  const a = APLICATIVO;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <header className="border-b pb-6">
        <p className="text-sm font-medium text-muted-foreground">{a.desenvolvedora}</p>
        <h1 className="mt-1 font-heading text-2xl font-semibold sm:text-3xl">App {a.nome}</h1>
        <p className="mt-2 text-[15px] leading-7 text-muted-foreground">
          O sistema de atendimento das equipes da KOMUNE e da Imova Imobiliária, no celular.
        </p>
      </header>

      <Secao id="quem-pode-usar" titulo="Quem pode usar">
        <p>
          Só quem faz parte dessas equipes. Não há cadastro aberto: o administrador da sua equipe
          libera o seu e-mail, e você entra com a conta Google desse e-mail.
        </p>
      </Secao>

      <Secao id="duvidas" titulo="Dúvidas comuns">
        <Lista
          itens={[
            <>
              <strong>&ldquo;Não consigo entrar.&rdquo;</strong> Confira se escolheu a empresa certa
              na tela de login e se entrou com o e-mail que o administrador liberou.
            </>,
            <>
              <strong>&ldquo;Não recebo os avisos.&rdquo;</strong> Em Ajustes → Notificações →
              Tríade, deixe as notificações ligadas. Ao sair da conta no app, os avisos param.
            </>,
            <>
              <strong>&ldquo;Quero excluir meus dados.&rdquo;</strong> Veja o item 7 da{' '}
              <Link href="/aplicativo/privacidade#direitos">política de privacidade do app</Link>.
            </>,
          ]}
        />
      </Secao>

      <Secao id="contato" titulo="Fale com a gente">
        <p>
          Escreva para <Email endereco={a.email} />. Respondemos em dias úteis.
        </p>
      </Secao>

      <Secao id="privacidade" titulo="Privacidade">
        <p>
          <Link href="/aplicativo/privacidade">Política de privacidade do app {a.nome}</Link>
        </p>
      </Secao>
    </main>
  );
}
