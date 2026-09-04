import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

import { ROTULO_PAPEL, type AppRole } from '@/lib/auth/role';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * O que quem não é admin nem gestor vê ao abrir /admin.
 *
 * Não é uma tela de erro, e não deve parecer uma: a pessoa não errou nada, e a Admin
 * simplesmente não é o lugar dela (RF-ADM-01). Então a tela tem o mesmo cabeçalho das
 * outras, diz em uma frase o que existe aqui, por que não abre e o que fazer — e não
 * um alerta vermelho de "acesso negado" com o papel escrito como acusação.
 *
 * A regra de verdade continua sendo a RLS: mesmo que alguém chegasse a esta rota, as
 * políticas do Postgres não devolveriam uma linha sequer de `audit_log` ou
 * `allowed_users`. Esta tela é cortesia, não é a tranca.
 */
export function AreaRestrita({ papel }: { papel: AppRole }) {
  return (
    <section className="flex w-full max-w-2xl flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          Esta parte é de quem administra o CRM.
          <Badge variant="pilula" className="h-6 gap-1.5 px-2.5 text-[11px] font-normal">
            <ShieldCheck className="text-muted-foreground" aria-hidden="true" />
            você entra como {ROTULO_PAPEL[papel]}
          </Badge>
        </p>
      </header>

      <p className="max-w-prose text-sm leading-relaxed">
        Aqui ficam três coisas: quem tem acesso ao CRM e com que papel, os catálogos que o sistema
        usa para classificar e decidir (categorias, cidades, feriados, motivos de perda, desfechos e
        modelos de mensagem) e as ferramentas de LGPD: lista de supressão, registro de quem revelou
        telefone, auditoria e exportação dos dados de um parceiro.
      </p>

      <div className="h-px w-full bg-hairline" role="presentation" />

      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
        Nada disso muda o seu trabalho do dia: o que você registra continua valendo e aparecendo nas
        suas telas. Se precisar de alguma coisa daqui (tirar um acesso, incluir um feriado, atender
        a um pedido de titular), fale com Rafael, Luiz ou Matheus, que são os admins.
      </p>

      <div>
        <Button asChild className="toque h-11 md:h-9">
          <Link href="/meu-dia">Voltar para Meu dia</Link>
        </Button>
      </div>
    </section>
  );
}
