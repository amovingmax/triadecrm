# Planilha-ponte (Dia 0 — 03/09/2026)

Instrumento de transição previsto no PRD §11.2 (Dia 0): a equipe registra aqui todo contato feito de **04 a 09/09**, até a importação para o CRM no D2. As colunas são exatamente as do mapeamento de importação (RF-BAS-07), então a planilha entra no CRM sem retrabalho.

Arquivos:
- `planilha-ponte-komune.xlsx` — aba **Contatos** (com listas suspensas), **Listas** (valores válidos) e **Instruções**.
- `planilha-ponte-komune.csv` — só o cabeçalho, `;` como separador, UTF-8 com BOM (abre certo no Excel pt-BR e no Google Sheets).

Regras (também estão na aba Instruções):
1. Uma linha por parceiro; novo toque = atualizar a linha, não duplicar.
2. Colunas com `*` são obrigatórias: `nome`, `tipo`, `categoria`, `whatsapp`, `origem`, `etapa`, `responsavel`, `ultimo_contato`, `resultado`, `proxima_acao`.
3. `origem` é obrigatória por LGPD (a abertura diz de onde veio o número).
4. "SAIR / não quero / remover" → `etapa = Opt-out` + `resultado = Pediu para parar`; ninguém volta a escrever.
5. Sem CPF, Pix ou dados bancários (ADR-09).

Listas de valores (fonte de verdade = `supabase/seed.sql` a partir do D1): categorias do Apêndice F (16 de fornecedores + 3 de produtores), origens de RF-BAS-10, etapas dos funis 1 e 3 (§5.3 / §5.5), resultados de RF-MET-06.
