# 09 — Dimensionamento do mercado de fornecedores e produtores de eventos em Natal/RN e Grande Natal

Pesquisa realizada em 03/09/2026 para o PRD do CRM de Captação KOMUNE. Escopo: Natal, Parnamirim, São Gonçalo do Amarante, Extremoz e Macaíba. Tudo o que está aqui foi extraído de páginas públicas acessadas nesta data (fontes na seção F). Nada foi inventado; quando não encontrei, está escrito "não encontrado".

## 0. Método, cobertura e limitações

**O que foi feito**

- 20 buscas na web (Google/WebSearch) + ~95 fetches de páginas de diretórios, notícias e sites de fornecedores.
- Fetch de todas as páginas de categoria do **Casamentos.com.br** em Natal (cerimonialista, espaço, buffet, fotografia, filmagem, decoração, música/DJ, bolo, doces, convites, carros, celebrante, beleza, bebidas/open bar, floristas, lembranças, animação, cabine de fotos) e as páginas estaduais (RN) para medir Grande Natal.
- Fetch de **Constance Zahn** (Natal), **Lápis de Noiva** (Natal), **Organizando Eventos** (18 categorias em Natal), **StarOfService** (10 categorias), **Telepesquisa**, **Solutudo** (base CNPJ), **Locadores de Brinquedos**, **Outgo** (eventos em Natal), **Tribuna do Norte** (calendário) e sites próprios (WSOM, Jôsy Buffet, Abracadabra, Z2 Eventos, Abrasel RN, Abrafesta, ABEOC).

**O que NÃO foi possível (e como fechar a lacuna)**

| Lacuna | Motivo | Como fechar (ação para a equipe) |
|---|---|---|
| Contagem de resultados no Google Maps por categoria | Sem acesso ao Maps por fetch | Rodar as buscas da seção A.2 no Maps (celular) e anotar "X resultados"; ~30 min de trabalho |
| Econodata / Casa dos Dados por CNAE em Natal | Páginas por cidade exigem login/JS; o número **1.257 empresas CNAE 8230 em Natal** citado na reunião não pôde ser reverificado, mas é coerente com a base Solutudo (944 em "organização de festas e eventos") | Exportar do Econodata (conta já usada pela equipe) os CNAEs 8230-0/01, 8230-0/02, 5620-1/02, 7739-0/03, 7729-2/02, 7420-0/01, 5911-1/99, 9001-9/99, 9329-8/99, 8011-1/01 filtrando Natal/Parnamirim/SGA/Extremoz/Macaíba |
| Instagram, Facebook, Sympla, GetNinjas (perfis) e Zankyou | Bloqueados por robots/JS/login | Scraper próprio (Rafael já validou com Claude Code) ou levantamento manual; GetNinjas não expõe lista pública de profissionais em Natal |
| Sites da M3TA e Gideon | DNS/SSL inacessíveis pelo proxy | Confirmar por Instagram/WhatsApp |
| Feiras de noivas 2026 em Natal ("Expo Noivas Natal", "Casar Natal") | Nenhuma notícia/site localizado nas fontes acessíveis | Buscar no Instagram (#feiradenoivasnatal) e com cerimonialistas; ver seção C |
| Grupos de WhatsApp/Facebook de fornecedores | Não indexados publicamente | Pedir convite aos cerimonialistas-parceiros (Triunfal, Alfa, Infinity, Sonhos, Z2) — ver seção C |

**Aviso sobre frescor dos dados**: o Organizando Eventos e parte da Telepesquisa contêm anúncios antigos (telefones com 8 dígitos = cadastro anterior a 2016). Esses nomes valem como "semente" para localizar o fornecedor no Instagram/Maps, não como contato final. Casamentos.com.br, StarOfService, Locadores de Brinquedos, Solutudo e sites próprios estão mais atuais.

---

## A. Dimensionamento por categoria

### A.1 Contagens brutas por fonte (Natal, salvo indicação)

| Fonte | Categoria | Contagem observada |
|---|---|---|
| Casamentos.com.br | Cerimonialistas | **42** em Natal (53 no RN; +1 Macaíba, +1 SGA, +1 Parnamirim) |
| Casamentos.com.br | Espaços para casamento | **43** em Natal (77 no RN; Parnamirim 8, Extremoz 2, Macaíba 1). Subtipos em Natal: salões 18, hotéis 6, restaurantes 7, chácaras 4 |
| Casamentos.com.br | Buffet | **13** (20 no RN; +1 Parnamirim) |
| Casamentos.com.br | Fotógrafos | **55** (74 no RN; Parnamirim 5, Mossoró 6) |
| Casamentos.com.br | Filmagem | **16** |
| Casamentos.com.br | Decoração | **13** (+3 Parnamirim) |
| Casamentos.com.br | Música (bandas, músicos, DJs) | **39** (filtro "DJ" no RN: 8) |
| Casamentos.com.br | Bolo / Doces | 3 / **14** |
| Casamentos.com.br | Convites / Lembranças | 9 / 8 |
| Casamentos.com.br | Bebidas-open bar | 5 (+1 no interior) |
| Casamentos.com.br | Celebrantes / Beleza noiva | 7 / 7 |
| Casamentos.com.br | Floristas / Carros / Animação / Cabine de fotos | 4 (+1 Macaíba) / 3 / 4 / 5 |
| Casamentos.com.br | Tendas | categoria existe, **0** em Natal (404) |
| Constance Zahn | "Fornecedores em Natal" | **66** — atenção: a maioria é fornecedor nacional (SP/RJ/ES) marcado para destination wedding (ex.: Casa Fasano, Ostensa, Verde Musgo); poucos são locais |
| Lápis de Noiva | Natal | 13 (papelaria, lembranças, Rosania Amaral, Sonhos Cerimonial, Sérgio Silvestre) |
| Organizando Eventos | Total Natal | **202 anúncios**; alimentação 42, animação 36, estruturas/equipamentos 34, organização/produção 28, música ao vivo 21, foto/vídeo 18, profissionais 18, som/luz/DJ 17, decoração 15, espaços 11, bebidas 4, veículos 1; páginas temáticas (com sobreposição): brinquedos infláveis 56, som e luz 56, tendas 52, buffet infantil a domicílio 51, recreadores 34 |
| StarOfService | Natal | fotógrafos de casamento **57**, buffet **50**, locação de utensílios p/ festas **50**, organizadores corporativos **43**, DJs **18**, bandas/música casamento 13, organizadores de festas 10, cerimonialistas 7, decoradores 4, locação de espaços 4, buffet volante 4 |
| Telepesquisa | Natal | cerimonial 20, buffet 17, salão de festas 14, buffet infantil 3, aluguel de brinquedos 3 |
| Locadores de Brinquedos | Natal | **9** locadoras com WhatsApp |
| Solutudo (base CNPJ) | Natal | "Organização de festas e eventos" **944 empresas**; "Buffet" **181**; "Aluguel de salões de festa" **85** |
| Econodata (citado na reunião) | Natal | **1.257 empresas CNAE 8230** (não reverificado) |
| GetNinjas | Natal | 29 subcategorias de eventos; não expõe contagem nem nomes |

### A.2 Estimativa do universo por categoria (Natal + Grande Natal)

Método de triangulação: (1) maior contagem em diretório único; (2) união entre diretórios — a sobreposição é baixa (ex.: fotógrafos: 55 no Casamentos.com.br e 57 no StarOfService com quase nenhum nome repetido nos 20 primeiros), então a união costuma ser 1,5–2x a maior lista; (3) base CNPJ como teto (inclui MEI e inativos). "Ativos localizáveis" = fornecedores com presença pública (site, Instagram, diretório ou telefone) que a KOMUNE consegue prospectar.

| Grupo | Categoria | Nomes reais já levantados | Estimativa de ativos localizáveis | Teto (CNPJ/diretório) | Método / fonte |
|---|---|---|---|---|---|
| A&B | Buffet adulto / casamento / corporativo | ~45 | **80–120** | 181 CNPJ (Solutudo) | Casamentos 13 + Telepesquisa 17 + StarOfService 50 + Org.Eventos 42, baixa sobreposição |
| A&B | Buffet infantil / casa de festas infantil | ~12 | **25–40** | 51 anúncios (Org.Eventos, misto) | Sites próprios + Telepesquisa + StarOfService |
| A&B | Churrasqueiro / espetinhos | ~11 | **30–60** | — (muito informal) | Org.Eventos alimentação/profissionais |
| A&B | Doces, bolos e confeitaria | ~25 | **60–100** | — (MEI/informal) | Casamentos 17 + Org.Eventos |
| A&B | Bar, drinks, bartenders | ~8 | **15–25** | — | Casamentos 5 + Org.Eventos 4 |
| A&B | Chopp (chopeira/barril) | 3 | **8–15** | — | Sites de delivery de chopp; Oktos |
| A&B | Food truck | 0 nomes (2 páginas coletivas) | **15–30** | — | Facebook "Food Truck Natal"/"Natal Food Park"; festival com apoio da prefeitura |
| Infra | Som e iluminação (locação) | ~12 | **30–50** | 56 anúncios (misto) | Org.Eventos + Casamentos (Helisom, Top Light) |
| Infra | Tendas, estruturas, palcos, pisos | ~10 | **20–35** | 52 anúncios (misto) | Org.Eventos tendas/estruturas |
| Infra | Mobiliário, mesas/cadeiras, louças, utensílios | ~25 | **40–60** | 50 (StarOfService) | StarOfService + Org.Eventos |
| Infra | Geradores | 1 | **5–10** | — | Apenas i9 Produções cita geradores; lacuna real de oferta |
| Infra | Painel de LED, projeção, audiovisual | 4 | **8–15** | — | New Vision, Alug-Equipamentos, WSOM, LMP |
| Infra | Banheiros químicos | 3–4 | **5–8** | — | Potiban, Paraibano, WC Vip |
| Serviços | Fotografia | ~110 | **120–180** | — | Casamentos 55 + StarOfService 57 (quase sem sobreposição) + Org.Eventos |
| Serviços | Filmagem / vídeo | ~20 | **30–50** | — | Casamentos 16 + Org.Eventos |
| Serviços | Decoração e flores | ~35 | **40–70** | — | Casamentos 13+4+3 + Org.Eventos 15 + StarOfService |
| Serviços | DJs | ~25 | **40–80** | — | StarOfService 18 + Casamentos 6 + Org.Eventos 6 (nomes distintos) |
| Serviços | Bandas, músicos, cantores | ~55 | **60–100** | — | Casamentos 33 + Org.Eventos 21 + StarOfService 13 |
| Serviços | Cerimonialistas / assessoria | ~65 | **80–120** | 944 CNPJ "org. de festas" (inclui tudo) | Casamentos 42 + Telepesquisa 20 + Org.Eventos + StarOfService |
| Serviços | Celebrantes | 7 | **10–15** | — | Casamentos |
| Serviços | Beleza (noiva/debutante) | 7 | **30–60** | — | Casamentos 7; universo real muito maior (salões) |
| Serviços | Convites, papelaria, lembranças | ~22 | **30–50** | — | Casamentos 17 + Lápis de Noiva |
| Serviços | Transporte, transfer, carros | 4 | **10–20** | — | Casamentos 3 + RCerimonial; receptivos turísticos não levantados |
| Serviços | Segurança para eventos | 1 | **8–15** | — | Aast Safety Labor; empresas de segurança privada com braço de eventos |
| Serviços | Garçons, recepcionistas, staff | 3 | agências **5–10**; freelancers centenas | — | Org.Eventos profissionais; GetNinjas tem categoria sem nomes |
| Serviços | Cabine de fotos / 360 | 5 | **6–10** | — | Casamentos |
| Locais | Salões e casas de recepção | ~45 | **60–80** | 85 CNPJ (Solutudo) | Casamentos 18 salões + Telepesquisa 14 + Org.Eventos 11 |
| Locais | Chácaras, sítios, fazendas | 6 | **15–25** | — | Casamentos 4 + Fazendinha Recanto Natureza + Flor do Campo (Macaíba) |
| Locais | Hotéis e pousadas com eventos | 8 | **15–25** | — | Casamentos 6 + 2 Extremoz |
| Locais | Restaurantes/bares para eventos | 7 | **20–40** | — | Casamentos 7; Abrasel RN como canal |
| Locais | Espaços de praia / beach clubs | ~7 | **15–25** | — | Cottô, Wyndham Pitangui, Genipabu Praia, Reserva Eventos, Vila do Mar, Bello Mare, Majestic |
| Recreação | Recreadores / animadores | ~9 | **25–40** | 34 anúncios (misto) | Org.Eventos recreadores |
| Recreação | Locação de brinquedos / infláveis | ~28 | **40–70** | 56 anúncios (misto) | Locadores de Brinquedos 9 + Org.Eventos + Telepesquisa |
| Recreação | Mágicos, personagens, shows | 6 | **15–30** | — | Org.Eventos animação + Casamentos animação |
| Produtores | Produtoras de eventos / organizadores | ~30 | **60–100** | 944–1.257 CNPJ | StarOfService corporativo 43 + Org.Eventos 28 + Solutudo |
| Produtores | Empresas de formatura | 5 | **6–10** | — | Z2, Gideon, Best Story, CB Formaturas, M3TA (a confirmar) |

**Leitura**: o universo de fornecedores ativos e localizáveis na Grande Natal fica entre **~1.100 e ~1.700**; o universo CNPJ (incluindo MEI e inativos) passa de 2.000 (1.257 CNAE 8230 + 181 buffets + 85 salões + demais CNAEs). Uma lista-alvo de 300 corresponde a 18–27% do universo localizável — factível em 15 dias com scraper + rota presencial. Cerimonialistas (80–120) e produtoras (60–100) somam 140–220 alvos possíveis para a meta de 60.

---

## B. Lista-semente de fornecedores reais por categoria

Formato: Nome — dados públicos (bairro/contato/nota) — fonte. Telefones vêm dos diretórios citados (dados públicos); os com 8 dígitos são antigos e precisam de confirmação. "CB" = Casamentos.com.br; "OE" = Organizando Eventos; "SOS" = StarOfService; "TP" = Telepesquisa; "LB" = Locadores de Brinquedos.

### B.1 Alimentos & Bebidas

**Buffet adulto / casamento / corporativo (CB: 13; TP: 17; SOS: 50)**
1. Nilson Buffet — 4,9 (9 aval.), a partir de R$180, 100–1.000 convidados — CB
2. Engenho Culinário — CB
3. Petisqueria Natal — a partir de R$70, 30–1.000 convidados — CB
4. Anne Vieira Buffet e Eventos — Capim Macio, (84) 99645-6054 — CB + TP
5. Senhor Festa — Candelária — CB + OE
6. Papilas Gourmet — CB
7. Le Petit Buffet — 4,9 (3) — CB
8. Daiana Buffet e Recepções — 4,6 (1) — CB
9. Jôsy Buffet — Tirol Office, Av. Afonso Pena 1.206; WhatsApp (84) 3663-5857; @josybuffetnatal; casamentos, infantil, corporativo — site próprio + CB + SOS
10. Buffet Causa Nossa Alegria — 4,9 (2) — CB
11. Dallas Buffet & Decoração — 4,2 (6) — CB
12. Neuma Leão Buffet e Decoração — Morro Branco, (84) 3234-4824; 4,7 (7) — CB + TP
13. Marileide Maison Buffet / Marileide Recepções — Candelária, (84) 3217-7012 — TP + CB
14. Safari Buffet — Lagoa Nova, (84) 3206-4212 — TP
15. Mousse Buffet — (84) 3206-8428 — TP
16. Sabor de Festa — (84) 3222-1382 — TP
17. Ed Buffet — (84) 99866-8333 — TP
18. Buffet Marcelino Junior — (84) 98819-3005 — TP
19. Eliana Festas & Eventos — Nova Parnamirim, (84) 3208-2348 — TP + SOS
20. Império Festas e Gráficas — Alecrim, (84) 98830-1655; 4,4 — TP
21. Patricia Moura Eventos — SOS
22. Alfinin Serviços de Alimentação para Eventos (Bufê) — Capim Macio, (84) 3206-2828 — Solutudo
23. Ambrósia Buffet Recepções — Candelária, (84) 98606-9581 — Solutudo
24. Best Platter Gourmet — Barro Vermelho, (84) 99992-1308 — Solutudo
25. Dom C V Eventos e Buffet — Lagoa Nova, (84) 99407-9770 — Solutudo
26. Lu Lima Tortas e Buffet — (84) 98877-5275 — OE
27. Sergio Myrria Personal Cook / "Serviços de Buffet, Eventos e Personal Chef" — SOS

**Buffet infantil / casas de festas infantis**
1. Abracadabra Festas — Av. Romualdo Galvão 619, Tirol; (84) 99133-5463 — site próprio
2. Sapekas Play — buffet infantil (site inacessível no fetch; localizado na busca) — busca Google
3. Jôsy Buffet (linha infantil) — ver acima
4. Mulekada Buffet Infantil — Dix-Sept Rosado — Solutudo
5. Floresta Encantada — SOS
6. Umpa Lumpa Buffet Infantil — SOS
7. Croco Kids — Petrópolis, (84) 2010-2040 — TP
8. Divirta Kids — Praia Shopping, (84) 9952-3077 — OE
9. Castelo Forte Festas — Pajuçara, (84) 99143-6258 / WhatsApp (84) 98730-2102; 4,6 — TP
10. Happy Fest — Felipe Camarão, (84) 98621-9653 — TP
11. Espaço Mix Buffet Infantil — (84) 98819-5103 — OE
12. Glamout Buffet e Recepções — Rua Tasso de Macedo 139, (84) 98751-1387 — OE
13. Aninha Festas Infantis; Oficina de Festas — SOS

**Churrasqueiros / espetinhos**
1. Sérgio Melo Churrasqueiro — CB
2. Espetto & Grill Churrasco Buffet — 4,9 (3); (84) 99650-9784 — CB + OE
3. Lakarne Churrascos — (84) 8750-3971 — OE
4. Gibbor Grill — Rocas, (84) 8701-0296 — OE
5. Nupalito buffet de espetinhos — (84) 3661-4448 — OE
6. Buffet du Rei (Grupo o Rei do Espetinho) — (84) 9973-6963 — OE
7. Branco Churrasqueiro — Guarapés — OE
8. Churrascos S/A — Rua Fabio Rino 1088, (84) 99993-7321 — OE
9. churrascosnatal — (84) 98180-3427 — OE
10. WR Churrasco — SOS
11. O Chef Eventos — Ponta Negra — OE

**Doces, bolos e confeitaria (CB doces 14, bolo 3)**
1. Anbee Doceria — 5,0 (10) — CB
2. Dulce Doces — 4,7 (5) — CB
3. Trovo Eventos — a partir de R$650 — CB
4. Valéria Docinhos; BrigadeLu; Drier Cakes; Doces Divas; Pedacinhos de Amor; Alfajores Don Jesus — CB
5. Mariah Doces e Bem Casados; Bruna Perazzo Confeitaria; Suzi Gourmet; Doces Encanto; Padaria Vovó Tonha — CB
6. Confeitaria Sandra Santos — a partir de R$500; Felipe Gomes Cake Designer — 5,0 (1); Bolo Fake Natal RN — CB (bolo)
7. Amanda Canuto Doces Finos; Docinhos e Cia; Encantos de Festa; Laíze Cupcakes; Debora Doces e Salgados — OE
8. JR Doces e Salgados — Cidade Nova, (84) 99976-4366 — TP
9. Vovó Isa Biscoitos Artesanais — Lagoa Nova, (84) 98606-0207 — Solutudo

**Bar, drinks, bartenders (CB 5; OE 4)**
1. Bar Service Coquetéis / Caipifrutas — 5,0 (2); (84) 3201-0796 — CB + OE
2. AJ Fast Drinks — CB
3. Oito Coquetéis — (84) 3608-0698 — CB + OE
4. Sandros Coquetéis — CB
5. Planeta Drinks — CB
6. Natal Cocktails (serviço de barman) — Av. Prof. Olavo Montenegro 2843; (84) 99126-1802 — OE
7. Kaipdrinks — Lagoa Azul, (84) 9927-8243 — OE

**Chopp**
1. Chopp Express (delivery Natal) — site próprio (busca)
2. Barril de Chopp Natal (Brahma, Heineken) — site próprio (busca)
3. Cervejaria Oktos Natal/RN — Facebook (busca)
(Não encontrei mais nomes; universo real inclui distribuidoras Ambev/Heineken e cervejarias artesanais locais — levantar no Maps.)

**Food truck**
- Páginas coletivas: "Food Truck Natal" e "Natal Food Park" (Facebook); "Festival Food Truck na Estrada" com apoio da Prefeitura do Natal (notícia oficial). Nomes individuais não encontrados — usar as páginas coletivas como canal (seção C).

### B.2 Infraestrutura

**Som e iluminação / DJ com estrutura**
1. WSOM Natal — desde 1994; 4,9 (100+ aval.); WhatsApp (84) 98897-8074 / (84) 98803-9969; @wsomnatal; som, luz, projeção, estruturas, DJ — site próprio + OE
2. DJ Zone Natal RN — Cidade da Esperança, (84) 8729-9090; iluminação, laser, LED — OE
3. NatalSom Sonorização — (84) 9975-5618 — OE
4. Agência DJs Party Produções e Eventos — (84) 9911-4453; DJ, som, iluminação, palco — OE
5. i9 Produções & Eventos — Av. Nascimento de Castro 1245, (84) 4141-3203; palcos, tendas, som, luz, geradores — OE
6. Helisom Som & Luz — CB (animação)
7. Top Light Som e Luz — CB (decoração)
8. Alug-Equipamentos para Eventos — (84) 9418-2000 / (84) 3086-4953 — OE
9. LMP Audiovisual; Showtime — SOS
10. Neon Som & Luz; DJ Bola Som Iluminação Imagem e Estruturas — CB (perfis RN)

**Tendas, estruturas, palcos**
1. Multi Tendas Locações — @multitendas — Instagram (busca)
2. Tenda Gazebo Flash — Av. Praia de Pirangi 2278, (84) 9930-0780 — OE + SOS
3. MG Tendas Brasil — Cidade Alta — OE
4. MG Tendas e Eventos — Av. Paulistana 1897 — OE
5. Estrutura FDL — (84) 3643-3693 / (84) 98888-3981; tendas, palcos, pisos — OE
6. Cobrindovc — (84) 98802-6207 — OE
7. Trovão Eventos — arquibancadas, tendas — OE
8. Adriano Locações — (84) 8845-6434; tendas, mesas, cadeiras — OE
9. L & D Locações — Alecrim, (84) 98133-3570 — OE
10. i9 Produções & Eventos — ver acima

**Mobiliário, mesas/cadeiras, louças, utensílios (SOS: 50)**
1. Mesas e Festas — (84) 99902-9509 — OE
2. Encanto Decorações (locação de mobília) — (84) 9999-7062 — OE
3. Anima Mix Festas Infantis — Rua Santo Apolo 594, (84) 98762-7891; mesas, toalhas, tendas — OE + SOS
4. Mult Festas; Lojão das Festas; Casa das Festas; Brasil Festas; Armazém das Festas; Natal Festas; Mundi Store Festas; JM Locadoras Festas; Vanda Festas; Sinara Festas; CK Buffet e Locações; Monjadin Festas — SOS
5. Felicitá Acervo e Decor — CB (decoração/acervo)
6. Mundo das Festas Ltda — Capim Macio, (84) 3214-5680 — Solutudo

**Geradores**
1. i9 Produções & Eventos — único fornecedor local encontrado citando geradores — OE
(Lacuna de oferta confirmada; buscar locadoras de máquinas no Maps: "locação de gerador Natal".)

**Painel de LED, projeção, audiovisual**
1. New Vision Projetores — Av. Coronel Estevam 1480 sala 20, (84) 3222-5394 — OE
2. Alug-Equipamentos para Eventos — datashow, telão, som — OE
3. WSOM — telões, projeção — site próprio
4. LMP Audiovisual — SOS
(Painel de LED específico: nenhum fornecedor local nomeado — lacuna.)

**Banheiros químicos**
1. Potiban Banheiros Químicos — Av. Romualdo Galvão, (84) 99143-4333 — OE
2. Banheiro Químico Paraibano — (84) 3211-0844 — OE
3. WC Vip Alliance Rental / wcvip.com.br — (84) 3208-4789 / (84) 99409-2222 — OE

### B.3 Prestadores de serviço

**Fotografia (CB 55; SOS 57)** — top por avaliações:
1. Costa Prado Fotografia — 4,9 (17), a partir de R$2.200 — CB
2. Junior Barreto Photographer — 5,0 (9), R$5.000 — CB
3. Wellington Fugisse — 5,0 (9), R$2.000 — CB
4. Su Lopes Fotografia — 5,0 (8), R$4.550 — CB
5. Renato Silva — 5,0 (8), R$2.000 — CB
6. Jonathan Enns Photography — 5,0 (6), R$2.500 — CB
7. Rafael Tavares — 4,8 (6), R$2.000 — CB
8. Alex Oliveira Photo — 5,0 (5), R$2.199 — CB
9. Camilla Bandeira — 5,0 (4), R$6.500 — CB
10. Paulo Dantas Fotografia — 5,0 (3), R$2.900 — CB
11. Soll Caetano Fotografia — 5,0 (4); Lessandro Augusto — 5,0 (3); Case Creative Studio — 4,0 (4) — SOS
12. Outros CB: Vittor, Eliabe Macedo, Bons Ventos, Studio 3, Segundo Produções, Ideia Fotografia, Fafá Nobre, Wagner Lima, Nayara Lima, Nadja Alves, Alex Costa, Nielcio Silva, Roberto Cabral, Diego Marcel, Roberto Barreto, Yure Richard, Augusto Souza, Manoel Paulo, Fabiano de Lima, May Galdêncio, Haziel Ribeiro, Douglas Lima, Rony Holanda, Fotografia Vital, Fátima Melo, Anderson Barreto, Estúdio V, Lucas Herculano, Diogo Martins, Ag Bacellar, Ygor Leonardo, Thiago Morais, Neemias Amaral, Fabio Mathews, Case Studio, Studio Kinsley Santos, Paulo Carvalho, Lira Fotógrafo, Jotta, Yuliana Lourenço, Everton César, Estúdio RN Fotos
13. Sérgio Silvestre Fotografia (destination) — Lápis de Noiva; Heart Fotografia, Arco e Flash — Constance Zahn (verificar se locais)

**Filmagem (CB 16)**
1. RL Short Films — 5,0 (12), R$2.500 — CB
2. Robert Emerson Videomaker — 5,0 (5), R$1.500 — CB
3. Dinda Vídeos — 4,9 (2), R$2.000 — CB
4. FCD Filmes; Vancoll Studios; Yu Videoart; Luma Figueiredo Storymaker; M&M Imagens; Wed Pocket Filmes; Paulo Luz Filmes; Dynamo Wedding; Jônatas Dumaresq Filmes; Oliver Films; Criativo Weddings; Publi Wedding; Disse Sim — CB
5. Filmart Filmagem de Eventos — Rua Tuiuti, (84) 3231-2956; Phvídeo Produções; Jalves Produções — OE
6. Take Art Films — 4,0 (1) — SOS

**Decoração e flores**
1. Goettems Decor — 5,0 (34) — CB
2. Vitória Produções — 4,9 (10); (84) 99822-5846 — CB + TP
3. Decorações Ricardo Lima — 4,9 (4) — CB
4. Alice Souza Decorações / Arte Buquê — 5,0 (1) / 4,9 (4) — CB
5. Havia Uma Vez Eventos — 4,8 (3) — CB + SOS
6. Gomes Jr - Art Paisagismo — 4,9 (2); Art Paisagismo Decorações (Barro Vermelho) — CB + OE
7. Rei Decor; Felicitá Acervo e Decor; Designer Brasil Eventos; Design Decorações — CB
8. Hemilly Flores Natal — 4,5 (15); Ymburana Arte Floral — 5,0 (9); Floricultura Capricho — 5,0 (2); La Florisé — 5,0 (1); Flori Estúdio de Flores (Macaíba) — CB floristas
9. Anny Caroline Designer Floral — 5,0 (4), Parnamirim; Jez Flores e Decorações — a partir de R$3.620, Parnamirim; Rosa Festas Decorações — Parnamirim — CB
10. Conto de Fadas Festas e Eventos — (84) 3234-3786; Provençal Natal; P&G Ateliê de Festas Infantis — OE
11. Arte Floral Decorações e Eventos; Eva Barreto Decorações Florais; Gabriel Siqueira — SOS

**DJs**
1. DJ Mário Souza — 4,9 (3), R$450 — CB
2. Ricardo Klaus — R$1.500 — CB
3. DJ Nato (sociais e corporativos) — R$900 — CB
4. DJ Pietro Eventos — CB (perfil RN)
5. Lucas Nascimento — 5,0 (2) — SOS
6. DJ Lourenço; DJ Masceno; DJ Lisbert; DJ Jair de Natal; Adriano Santos; DJ Rocha; Loup; DJ KLP; DJ Allysson; Isaac A. Medina; DJ Eweraldo Costa; DJ Patrick; DJ Anjinho; DJ Lobo Mau; DJ Bruno Cocao — SOS
7. DJ Done — (84) 99993-3831; DJ Sidney Sheldon; DJ Jair — OE
8. Daniel Leal, Leandro Matsuda, Rodrigo Mantega — Constance Zahn (provavelmente nacionais; verificar)

**Bandas, músicos e cantores (CB 39)**
1. Carmem Pradella — 5,0 (47), R$1.500; Tirol, (84) 99921-2464 — CB + OE
2. Diego Araújo Violinista — 5,0 (9), R$500 — CB
3. Banda Carpe Diem — 5,0 (4), R$3.500 — CB
4. Banda Luminari — 5,0 (4), R$850 — CB + OE
5. Jurandy do Sax — 4,9 (3); Elegance Sax — 5,0 (3); Master Sax — CB
6. Wendell & Nanda — 5,0 (3), R$3.000; Banda Easy — 5,0 (1); Grupo Alfa; Artmusicalis — 5,0 (3) — CB
7. Agência Cantata; Royal Música Eventos; Sonare Musical; Equipe Clarin Triunfal; Samara Alves; Mariana Roots; Bruno Cirino; Véu & Melodia; Harmonium; Denimel; Grupo Melisma; Grupo Acordes (Parnamirim) — CB
8. Orquestra Los Manos; Orquestra Diamante; Orquestra Elegance; Chamaz Pop; Banda Help 4 Five; Banda 3Passos; Musikantabile; Quarteto Solemnis; Allan Moraes; Adyson dos Teclados; Duo Voz & Violão — OE
9. Trio Elo; Heli Medeiros — SOS

**Cerimonialistas / assessoria** — ver seção D (lista completa).

**Celebrantes (CB 7)**
1. Thiago Cepeda — 5,0 (321), R$1.299 (Premium)
2. Rosania Amaral Celebrante — 5,0 (140), R$2.500 (Premium) — CB + Lápis de Noiva
3. Celebrante Diego Pinheiro — 5,0 (8), R$1.500
4. Ritualize Amor — 5,0 (4); Valentin Tuscany; Cepeda Eventos; Padre Jailson Rodrigues

**Beleza (CB 7)**: Sinval de Souza — 4,4 (3); Samantha Sales — 5,0 (2); Juli Galvão Makeup — 4,8; Le Calafange Makeup and Hair — 5,0 (1); Luiza Costa Maquiagem; Ateliê Loiana Rodrigues; Ma.maquiando; Cecília Souto Makeup (SOS).

**Convites, papelaria e lembranças**: ND Artes e Print — 4,8 (25); Ateliê Sonho de Amor — 5,0 (8); Decidi Casar — 4,9 (12); Santaluzz; Pardal Agência Criativa; Arte, Papel e Amor; Amari Papelaria; Nana Mimos; Artte Criações; Oh Lala Mimos; Divino Casamento; GK Aromas; Agroborges; Pipa Candles; Fabi Aromas; Dary Bordados; Flor do Mato (CB); Kida Studio; M de Maria Lembranças; Porcelanas Beni; Traço Afetivo; Hall Identidade Visual; Santo de Casa Design; Pashmina Wedding; Ateliê Tálita Lessa (Lápis de Noiva).

**Transporte / transfer / carros**: Case de Kombi — a partir de R$400; Xavier Transfer; Natal Glamour (CB); RCerimonial Transportes de Luxo — (84) 98889-1999, rcerimonial.com.br (OE). Transfer executivo/receptivo: não levantado — lacuna.

**Segurança para eventos**: Aast Safety Labor — (84) 3608-0957 (OE). Demais: não encontrados — lacuna.

**Garçons, recepcionistas, staff**: Bárbara Oliveira (recepcionista) — (84) 9919-5208; Daniele Maia — (84) 99607-5539; D&R Eventos e Produções (recepção/ações promocionais) — (84) 99607-5539; Paiva Park & Valet (manobristas) — (84) 98852-3040 (OE). Garçom freelancer: nenhum nome público — canal GetNinjas/grupos.

**Cabine de fotos**: Um Dois Três Xis Cabine — 5,0 (5), (84) 98701-0216; Flor de Cacto — 5,0 (3), R$750; Cabine Photo Style — 5,0 (2); Cápsula do Tempo — R$1.499; Xis Cabine 360 (CB).

### B.4 Locais

**Salões e casas de recepção (CB 18 salões; TP 14; Solutudo 85 CNPJ)**
1. Macamirim Eventos — 4,9 (64), a partir de R$6.900, 2–1.000 convidados — CB
2. Império Recepções — 4,8 (9), R$55/pessoa, 80–180; Potengi, (84) 98808-8201 — CB + Solutudo
3. Grupo Eden Recepções — 4,9 (8), R$80/pessoa, 30–300; Candelária, (84) 3217-6010 — CB + Solutudo
4. Solar Imperial Recepções — 5,0 (3), R$62/pessoa, 80–250 — CB
5. Lima Recepções; Rios Recepções (Potengi, (84) 3662-1972 / WhatsApp (84) 98875-5575); Xanana; Grupo Átrios; Maranata; Victoria Gimenes (Pajuçara, (84) 98833-2880); Aliança Recepções (Neópolis, (84) 98737-4901); Celebration Recepções (5,0 SOS); Mona's; La Mouette; Spaço Guinza; Chaplin Recepções; Green House; Casa Nuestra; Espaço Mansão Sul; Garden Espaço para Eventos (@gardennatal); Espaço Vip (Felipe Camarão); Natal Tropical Eventos; Porto da Graça — CB
6. Vivier Recepções — Candelária, (84) 3207-3283; Imperial Recepções — Lagoa Nova, (84) 3231-5196; Gerbera Recepções — Lagoa Nova, (84) 3206-1574 (também Parnamirim, 5,0 (2) CB); Paradise Recepções — Potengi/Igapó, (84) 99981-4661; Vagalume Festas — Lagoa Nova, (84) 3301-7072; Prime Recepções; Espaço Realize; Espaço Florecer; Prática Eventos — TP
7. Dreams Recepções — Tirol, (84) 99642-3545; Lumiere Recepções — Igapó, (84) 3214-2907; Atrevida Espaço para Festas — Lagoa Nova, (84) 99984-3997; Ruth Recepções — Quintas; Espaço Flor de Bali — Petrópolis, (84) 99408-3341; Espaço Prainha Shows e Eventos — Cidade Alta; Frisson Eventos — Ribeira — Solutudo
8. 3652 Natal — (84) 98896-3020; Estação Ponta Negra Eventos — (84) 99614-4048; San Valle Eventos — (84) 3207-3550; Shalom Hospedagem e Eventos — Ponta Negra — OE
9. Parnamirim: Art's Recepções — 4,8 (19); Refúgio dos Sabiás — 5,0 (5); Luxor Recepções — 5,0 (2); Bouganville Recepções — 5,0 (2); Embaixada Hall; Bodega da Terra — a partir de R$10.000, 30–80 — CB

**Chácaras, sítios, fazendas**: Chácara Alvorada — 4,8 (10); Casa Rio Doce — a partir de R$1.800, 1–300; Chácara Paraíso; Chácara Faheina (CB); Fazendinha Recanto Natureza (OE/SOS); Flor do Campo Recepções — Macaíba; Por Amor Recepções — Extremoz, 4,6 (18), a partir de R$2.600, 2–500 (CB RN).

**Hotéis e pousadas**: Wish Natal — a partir de R$320, 30–300; Imirá Plaza — 4,9 (2); Vila do Mar — 4,7 (8); Arituba Park Hotel — 4,6 (1); Quality Suites Natal; Bello Mare; Hotel Majestic Ponta Negra Beach (CB); Wyndham Natal Pitangui Praia — Extremoz, a partir de R$500, 200–250; Genipabu Praia Pousada — Extremoz, a partir de R$160, 20–100 (CB).

**Restaurantes para eventos**: Tábua de Carne — 5,0 (11), R$68/pessoa, 20–500; View Rooftop — R$189,90, 60–100; Nau Frutos do Mar — 4,9 (2); Sal e Brasa — 4,7 (3); Fogo & Chama — 5,0 (1); Bife Bar; Mangai Lagoa Nova (CB); Restaurante Oriente — (84) 9441-8667 (OE).

**Espaços de praia / beach club**: Cottô Beach House — Parnamirim (CB); Reserva Eventos | Casamentos na Praia — @espacoreservaeventos (Instagram, busca); Wyndham Pitangui e Genipabu Praia Pousada — Extremoz; Vila do Mar, Bello Mare, Majestic Ponta Negra — Natal (CB). A página "casamentos na praia" do CB para Natal devolve resultados nacionais — categoria mal coberta pelo concorrente.

### B.5 Recreação infantil

**Recreadores / animadores (OE 34)**: Hora do Lazer Recreação — Candelária, (84) 99927-2577; Turma X Entretenimento (Tio Xulê) — (84) 99964-7723 / (84) 3608-0696; Agito Produções — (84) 8856-8426; Pinote Kids Animadores — (84) 98891-1013; Divirta Kids — (84) 9952-3077; Objetivo Eventos — (84) 99943-2767; Anima Mix Festas Infantis — (84) 98762-7891; Pequeninos; Ateliê Melana — (84) 99989-1313 (OE).

**Locação de brinquedos / infláveis (LB 9; OE 56; TP 3)**
1. Brinkolândia Festas — Pitimbu/Parque das Colinas, WhatsApp (84) 98701-9052; infláveis, futebol de sabão — LB + OE
2. Algodão Mágico — Alecrim, (84) 99852-1371 — LB
3. Dila Festas — Redinha, (84) 99623-9645 — LB
4. Festa Feliz Locação de Brinquedos — Monte Castelo, (84) 99814-9081 — LB
5. Giz & Risq Mais Diversão — Pitimbu, (84) 98801-2030 — LB
6. Brincadeira de Criança (brinquedos + estações gourmet) — Pajuçara, (84) 99946-9867 — LB
7. Animafesta Locações — Potengi, (84) 98851-9847 — LB
8. Carrossel Brinquedos — Passagem de Areia, (84) 99461-7126 — LB
9. Brinquedos Só Alegria — Bela Parnamirim, (84) 98869-0031 — LB
10. Feliz Niver Festas — Nazaré, (84) 98867-5192; 4,9 — TP
11. Robinho Locações — Nova Esperança, (84) 99686-0623 — TP
12. Hebron Diversões — Orquídeas, (84) 8824-0856; Pintando o 7 — (84) 99832-3901; Natal Fest Brink — (84) 8853-2920; Brinque Mais — (84) 8811-8771; T&O Locação — Vila Naval; Adonai Park — (84) 8803-1178; Happy Mix — Lagoa Nova, (84) 99950-0153; Gan Brinquedos — (84) 99705-3031; Brinquedos & Cia — Av. Amintas Barros 4048, (84) 3086-7059; Kids Festa — (84) 98823-6699; Smile Kids; Magia das Festas — (84) 9433-6983; Pula-Pula Mix; Espaço Mix — (84) 98819-5103; Locação de Fliperama — (84) 99424-0327 — OE

**Mágicos, personagens, shows**: Mágico Cleyton — (84) 99859-4033; Mágico Hórus; Tom Oliver Mágica e Ilusão (OE); Hillary Hilton Drag Queen — a partir de R$450; Anima Produções e Eventos (dança) — 4,6 (1); Maytelier Studio de Dança (CB).

---

## C. Canais de captação em massa

| Canal | Status verificado | Uso recomendado |
|---|---|---|
| **Casamentos.com.br** (Natal: 42 cerimonialistas, 43 espaços, 55 fotógrafos, 39 músicos, 16 filmagem, 14 doces, 13 buffets, 13 decoração, 9 convites, 8 lembranças, 7 celebrantes, 7 beleza, 5 bebidas, 5 cabines, 4 floristas, 3 carros, 3 bolos, 4 animação) | Páginas públicas com nome, nota, nº de avaliações, preço "a partir de", capacidade; URLs previsíveis `/{categoria}/rio-grande-do-norte/natal` e `--2` para página 2 | Scraper para pré-cadastro (fonte principal para Serviços e Locais). Argumento de pitch: esses fornecedores já pagam mensalidade lá |
| **Organizando Eventos** (202 anúncios em Natal, 18 categorias, telefone público) | Acessível; dados parcialmente antigos | Semente para Infra, A&B e Recreação (categorias ausentes do Casamentos.com.br); confirmar telefone antes do disparo |
| **StarOfService** (buffet 50, fotógrafos 57, utensílios 50, corporativo 43, DJs 18) | Acessível; só nomes (sem contato) | Cruzar nomes com Instagram/Maps |
| **Locadores de Brinquedos** (9 em Natal com WhatsApp) | Acessível | Disparo direto (Recreação) |
| **Telepesquisa / Solutudo** (base CNPJ: 944 org. de eventos, 181 buffets, 85 salões) | Acessível; Solutudo traz razão social + telefone + bairro | Complemento para Locais e Buffet; Solutudo serve como proxy gratuito da Econodata |
| **GetNinjas** | Não expõe lista pública em Natal (só formulário de pedido) | Só via scraper autenticado ou postando pedidos como "cliente" — baixa prioridade |
| **Constance Zahn** (66 em Natal) | A maioria é fornecedor nacional de destination wedding | Filtrar os poucos locais; baixo rendimento |
| **Abrasel RN** — Rua Palestina 99, Ponta Negra Center sala 215; (84) 99829-0030 (relacionamento) / (84) 99811-8565 (comunicação); @abraselnorn | Confirmado | Parceria para captar restaurantes, bares, buffets e food service (grupo A&B). Também vincula ao Salão Abrasel |
| **Fecomércio-RN** | Citada pela prefeitura como parceira do "Natal em Natal" | Porta para eventos institucionais e associados do comércio |
| **Abrafesta** (Associação Brasileira de Eventos) | Sede em SP; **sem núcleo RN** no site; portal associe.se.abrafesta.com.br | Verificar associados com CNPJ em Natal (lista não pública) |
| **ABEOC Brasil / ABEOC-RN** | ABEOC Brasil confirmada; página de regionais retornou 403; **ABEOC-RN não confirmada** (0 resultados na Tribuna do Norte) | Confirmar por Instagram; se existir, é o canal para produtoras corporativas |
| **Sindeventos-RN** | **Não encontrado** | Verificar se existe sindicato patronal de eventos no RN (Fecomércio pode indicar) |
| **Feiras de noivas 2026 em Natal** ("Expo Noivas Natal", "Casar Natal") | **Não localizadas** em Tribuna do Norte, sites dedicados ou Sympla/Outgo | Confirmar no Instagram; alternativa: organizar "café de fornecedores KOMUNE" com os cerimonialistas top (Triunfal 89 aval., Alfa 58, Infinity 41) |
| **Grupos de WhatsApp/Facebook** | Não indexáveis. Páginas coletivas encontradas: "Food Truck Natal", "Natal Food Park", "Paradise Recepções" (Facebook) | Pedir entrada via cerimonialistas e casas de recepção; cada cerimonialista tem sua rede de 20–40 fornecedores recorrentes — captar 5 cerimonialistas dá acesso indireto a 100+ fornecedores |
| **Outgo** (plataforma de ingressos ativa em Natal) | Lista eventos em Natal com datas (Quintas Meu Amor, Sambinha na Laje, Dusouto 20 anos, Festival Ribeira Boêmia, Festival Mungunzá, Hallowilde, BT do bem, Vértice @ Garden Gastrobar) | Fonte de produtores de eventos recorrentes (Sympla é JS e não rendeu lista) |
| **Cidade Carnatal / Clap Entretenimento, Vybbe, RB Entretenimento; Evenyx (ingressos)** | Confirmado (Tribuna, 27/08/2026) | Fornecedores de estrutura do Carnatal (4–6/12) são os maiores de infra da cidade — prospectar via organizadores |

---

## D. Produtores, cerimonialistas e empresas de formatura

### D.1 Empresas de formatura
| Empresa | Dados públicos | Fonte |
|---|---|---|
| **Z2 Eventos e Cerimonial** | Fundada em jul/2007 por Zorenna Dantas; Rua Gustavo Guedes 1857, Capim Macio; (84) 3346-1506; WhatsApp (84) 99438-7681; @z2eventos; formaturas (UnP, Estácio), casamentos, corporativo; no CB: a partir de R$3.000, 100–500+ convidados | site próprio + CB |
| **Gideon Formaturas e Eventos** | Village dos Mares / Rua José Seabra; (84) 3213-5400 e (84) 8836-8908 (antigo); fotos e filmagens de formatura | OE (site inacessível) |
| **M3TA** | Citada na reunião; **não localizada** em nenhuma fonte acessível (site fora do ar no proxy; 0 notícias) | confirmar por Instagram |
| **Best Story Formaturas** | (84) 99944-9374 | TP |
| **CB Formaturas** | Perfil de fotografia em Natal (orçamento sob consulta) | CB |

### D.2 Cerimonialistas / assessorias (alvo: 30 dos 60 produtores)
Ordenados por prova social (nº de avaliações no Casamentos.com.br):
1. Triunfal Cerimonial e Eventos — 4,9 (89), a partir de R$4.300; Shopping Lagoa Center, (84) 99990-8786 — CB + OE + SOS
2. Alfa Cerimonial e Assessoria — 4,9 (58), R$2.000 — CB
3. Infinity Cerimonial e Assessoria — 5,0 (41), R$1.300 — CB
4. Cerimonial Odineide Melo — 4,6 (8), R$1.000 — CB
5. Sonhos Cerimonial & Eventos — 4,9 (7), R$2.500; Prudente de Morais, (84) 9922-0177 — CB + OE + Lápis de Noiva
6. MS Cerimonial e Eventos — 4,9 (6), R$2.000 — CB
7. Chris Cerimonial & Assessoria — 4,9 (6), R$1.300 — CB
8. Grupo Feeling — 4,8 (4), R$1.000 — CB
9. LD Cerimonial & Eventos — 5,0 (3), R$1.500 — CB
10. Ativa Cerimoniais / Ativa Assessoria e Cerimonial — 5,0 (2), R$2.000; Candelária, (84) 3231-0998 — CB + TP
11. Haydée Cerimonial & Eventos — 5,0 (1), R$1.897; Barro Vermelho, (84) 3222-9773 — CB + TP
12. Paulo Capistrano Cerimonial — 5,0 (1), R$1.800 — CB
13. Perez Assessoria — 5,0 (1) — CB
14. Motta's; ND Assessoria e Cerimonial; Daiane Schwantz; Nina Kreimer; L&E Assessoria e Gestão em Eventos; Labelle Cerimonial; Catarine Nogueira Cerimonial; GMC Cerimonial e Eventos; Raquel Araújo Cerimonial; Weslley Avelino Cerimonial; Larissa Duarte Gestão de Eventos; Plano Cerimonial & Eventos (Candelária, (84) 3234-5963); Amor In Eventos; Dreams Cerimonial e Assessoria; M&J Cerimonial e Eventos; Vilage Cerimonial e Assessoria — CB
15. Accord Cerimonial e Eventos — Cidade Satélite, (84) 3218-2906 / (84) 99102-2340; Lyris Cerimonial — (84) 8721-1080; RKM Cerimonial — Senador Salgado Filho; TG Eventos; Aliança Cerimonial e Assessoria — (84) 3089-0091; Prosperar Assessoria & Cerimonial; M&R Eventos — Capim Macio, (84) 98135-0565; Samuel Lima Assessoria; Raissa Arruda Cerimonialista — Capim Macio, (84) 99960-8780; N&E Cerimoniais — OE
16. Celebrations Cerimonial e Eventos — Capim Macio, (84) 3219-0532; Cerimonial Haryne Azevedo — (84) 99951-5701; Elite Eventos — (84) 98787-9285; MKM Eventos — Ponta Negra, (84) 3222-0202; Fest Design; Flor de Bali; Nossa Promoções e Eventos — Neópolis; MS Promoções — Cidade Alta — TP
17. Cerimoniais.com e Assessoria de Eventos — Capim Macio, (84) 3206-2015; HC Assessoria & Eventos — Tirol, (84) 99894-3984 — Solutudo
18. Grande Natal: Felice Assessoria e Cerimonial — Macaíba, 5,0 (7), R$2.500; Geis Abreu Cerimonial — SGA, 4,8 (1), R$1.000; Bárbara Mendes Gestão de Eventos — Parnamirim; Nobre's Cerimonial & Assessoria — CB RN
19. Innova Marketing e Eventos — (84) 99973-9773 — OE + SOS; Nobre Cerimonial e Assessoria — SOS

### D.3 Produtoras de eventos e organizadores (alvo: 20–25 dos 60)
- **Carnatal 35 (4–6/12/2026)**: Clap Entretenimento, Vybbe e RB Entretenimento (organização); Evenyx (ingressos). Histórico: Destaque Promoções e Eventos (Wikipedia).
- **i9 Produções & Eventos** — Av. Nascimento de Castro 1245, (84) 4141-3203 — palcos, tendas, som, geradores (OE)
- **Agito Produções** — (84) 8856-8426 (OE); **Espaço ZR Produções e Eventos** — Rua Potengi 393, (84) 99634-1773 / (84) 3033-1933 (OE); **D&R Eventos e Produções** — (84) 99607-5539 (OE/SOS)
- StarOfService (corporativo): Status Produções; AE Mkt Promotion; Estratégias Eventos e Serviços; Innova Eventos; Mega Eventos; M&S Festas e Eventos; Versailles Recepções e Eventos; Erika Alves; Pipa Eventos
- Solutudo (CNPJ, Natal): Idearte Entretenimento — Candelária, (84) 99414-0366; Loop Cria Entretenimento — Ponta Negra, (84) 3025-2526; Frisson Eventos — Ribeira, (84) 98144-9896; Casei Marketing e Eventos — Lagoa Nova, (84) 3204-6500; Morais Eventos — Lagoa Nova, (84) 99811-3010; Maré Produções e Eventos — Lagoa Nova; LM Produções e Serviços — Bom Pastor, (84) 3223-2192; RPD Serviços e Entretenimento — Tirol, (84) 99406-0049; MG Promoções e Eventos — Candelária, (84) 99200-4666; Pos-Doc Eventos — Tirol, (84) 99972-7739; Agência Rocas — (84) 3222-1198; HF Entretenimento — Lagoa Nova; Espaço Prainha Shows e Eventos — Cidade Alta
- JB Comunicações — Lagoa Nova, (84) 99102-4602; 4,9 (TP)
- Organizadores de eventos recorrentes em Natal (Outgo, set–nov/2026): Quintas Meu Amor e Sambinha na Laje (5/9), Dusouto 20 anos (19/9), Trilha para Além do Código (1/10), BT do bem (11/10), Hallowilde (16/10), Festival Ribeira Boêmia (7/11), Festival Mungunzá (19/11), Circo Razzani, Vértice @ Garden Gastrobar — produtores não nomeados na página; identificar pelo Instagram do evento.
- Sympla: página de Natal é renderizada em JS ("Nada por aqui ainda" no fetch) — extrair organizadores via scraper autenticado.

---

## E. Recomendação de metas por categoria e prioridade

Critérios: (1) **déficit de oferta na KOMUNE** (hoje ~2 fornecedores publicados → tudo é déficit; priorizo o que os eventos próprios da KOMUNE consomem: som, buffet/churrasco, bebidas/chopp, tendas, locais, DJ, foto); (2) **facilidade de captação** (contato público, concentração geográfica, hábito digital); (3) **vantagem competitiva** (categorias sem marketplace hoje — infra, recreação, A&B informal — são "oceano azul"; categorias fortes no Casamentos.com.br já pagam mensalidade e respondem ao pitch "sem mensalidade, paga só quando fecha"); (4) **calendário** (formaturas nov/dez, Carnatal 4–6/12, réveillon, alta temporada dez–fev).

Proposta que respeita os grupos da reunião (A&B 30, Infra 30, Serviços 20, Locais 10, Recreação 10 = 100 cadastros) e entrega **15 categorias com ≥5 fornecedores** (meta ≥14), com lista-alvo de 300 (~3 alvos por cadastro):

| # | Categoria (grupo) | Alvos no CRM | Meta cadastro | Prioridade | Por quê / de onde tirar |
|---|---|---|---|---|---|
| 1 | Buffet adulto/corporativo (A&B) | 24 | 8 | **P1** | Universo 80–120; 27 nomes já listados; demanda de formaturas e corporativo |
| 2 | Churrasqueiro, espetinho, food truck (A&B) | 15 | 5 | **P1** | Eventos próprios (churrasco, tênis); sem marketplace; 11 nomes + páginas coletivas |
| 3 | Bar, drinks, chopp (A&B) | 18 | 6 | **P1** | 10 nomes; Abrasel RN como canal; alta demanda em réveillon/Carnatal |
| 4 | Doces, bolos, confeitaria (A&B) | 15 | 5 | P2 | 25 nomes; ticket baixo, mas volume alto e fácil cadastro |
| 5 | Buffet infantil / casa de festas infantil (A&B) | 18 | 6 | P2 | 13 nomes; puxa o público de recreação |
| 6 | Som, iluminação e DJ com estrutura (Infra) | 27 | 9 | **P1** | WSOM (4,9/100+) como fundador-âncora; 12 nomes; ausente no Casamentos.com.br |
| 7 | Tendas, estruturas, palcos (Infra) | 21 | 7 | **P1** | 10 nomes; Carnatal/réveillon; Multi Tendas, Estrutura FDL |
| 8 | Mobiliário, louças, utensílios (Infra) | 21 | 7 | **P1** | 25 nomes (StarOfService 50); cada evento precisa |
| 9 | Audiovisual/LED, geradores, banheiros químicos (Infra) | 21 | 7 | P2 | Déficit real (1 gerador, 0 painel de LED nomeado); quem entrar primeiro domina; Potiban/WC Vip fáceis |
| 10 | Fotografia e vídeo (Serviços) | 18 | 6 | **P1** | Maior oferta da cidade (120–180); dados ricos no CB; pitch "sem mensalidade" |
| 11 | DJs, bandas e músicos (Serviços) | 18 | 6 | P2 | 80 nomes; Carmem Pradella (47 aval.), Diego Araújo, Carpe Diem como âncoras |
| 12 | Decoração e flores (Serviços) | 15 | 5 | P2 | Goettems (34 aval.), Vitória Produções, Hemilly Flores; Parnamirim tem 3 |
| 13 | Outros serviços: celebrante, beleza, convites, transfer, segurança, staff (Serviços) | 9 | 3 | P3 | Thiago Cepeda (321 aval.) e Rosania Amaral (140) valem como prova social; segurança/transfer/staff são lacunas a preencher depois |
| 14 | Locais: salões, chácaras, hotéis, restaurantes, praia (Locais) | 30 | 10 | **P1** | 60+ nomes com telefone; Macamirim (64 aval.), Império, Eden, Solar Imperial, Art's (Parnamirim); espaços de praia mal cobertos pelo CB |
| 15 | Recreadores e animadores (Recreação) | 15 | 5 | P2 | 9 nomes com WhatsApp; sem marketplace concorrente |
| 16 | Locação de brinquedos e infláveis (Recreação) | 15 | 5 | P2 | 28 nomes, 9 com WhatsApp verificado; captação rápida por telefone |
| | **Total fornecedores** | **300** | **100** | | |
| 17 | Cerimonialistas/assessorias (Produtores) | 30 | 15 | **P1** | 65 nomes; 42 no CB com preço e nota; cada um abre sua rede de fornecedores; modelo "cerimonialista é sócio" (3% + 5%) |
| 18 | Empresas de formatura (Produtores) | 8 | 4 | **P1** (urgente: formaturas nov/dez) | Z2, Gideon, Best Story, CB Formaturas, M3TA + 3 a descobrir |
| 19 | Produtoras corporativas/shows e organizadores recorrentes (Produtores) | 22 | 11 | P2 | 30 nomes (i9, Innova, Status, Idearte, Loop Cria, Frisson, Casei…); organizadores do Outgo/Sympla |
| | **Total produtores** | **60** | **30** | | |

**Sequência sugerida para os 15 dias (rota presencial à tarde, ~4 visitas/dia/pessoa)**
- Dias 1–5 (P1): som/luz (WSOM, DJ Zone, i9), tendas/mobiliário (Multi Tendas, Estrutura FDL, Mesas e Festas), buffets e churrasqueiros com nota (Nilson, Jôsy, Espetto & Grill), locais (Macamirim, Império, Eden, Solar Imperial, Rios, Vivier, Gerbera, Art's), cerimonialistas âncora (Triunfal, Alfa, Infinity, Sonhos, Z2) e formaturas (Z2, Gideon).
- Dias 6–10 (P1+P2): fotografia/vídeo (Costa Prado, Junior Barreto, RL Short Films), bar/chopp (Bar Service, Oito Coquetéis, Chopp Express), recreação/brinquedos (Brinkolândia, Algodão Mágico, Hora do Lazer, Turma X), doces (Anbee, Dulce).
- Dias 11–15 (P2+P3): AV/geradores/banheiros, DJs e bandas, decoração, produtoras corporativas, "outros serviços".

**Geografia**: os bairros que mais aparecem são Candelária, Capim Macio, Lagoa Nova, Tirol, Ponta Negra, Potengi/Igapó (Zona Norte), Pitimbu e Pajuçara; em Parnamirim, Nova Parnamirim. Montar rotas por esses clusters.

**Calendário para priorização**
- **Formaturas**: pico tradicional em nov/dez (colações de fim de ano) e jul; empresas de formatura fecham fornecedores com 60–90 dias de antecedência → prospectar em setembro.
- **Carnatal 35**: 4 a 6/12/2026, Cidade Carnatal (Arena das Dunas); organização Clap Entretenimento, Vybbe e RB Entretenimento; Anitta, Ivete Sangalo, Bell Marques, Cláudia Leitte, Léo Santana, Wesley Safadão etc. — pico de demanda por som, estruturas, segurança, bares.
- **Natal em Natal / Réveillon**: edição 2025 durou de 25/12/2025 a 31/01/2026 com R$ 15 mi (público+privado); para 2026 a prefeitura avalia cortar os shows do Natal em Natal e manter só o grande show do Réveillon, com programação nos bairros e diálogo com Fecomércio-RN (Tribuna, 31/07/2026).
- **Eventos recorrentes set–nov/2026 (Outgo)**: 5/9, 19/9, 1/10, 11/10, 16/10, 7/11, 19/11 — bons para oferecer o "1 lead real em 30 dias" aos fundadores.
- **Feiras de noivas 2026**: não localizadas — verificar antes de contar com elas.

---

## F. Fontes (URLs acessadas em 03/09/2026)

**Casamentos.com.br (Natal/RN)**
- https://www.casamentos.com.br/cerimonialista/rio-grande-do-norte/natal e /natal--2 ; https://www.casamentos.com.br/cerimonialista/rio-grande-do-norte
- https://www.casamentos.com.br/espaco-casamento/rio-grande-do-norte/natal ; /rio-grande-do-norte ; /rio-grande-do-norte/parnamirim
- https://www.casamentos.com.br/salao-casamento/rio-grande-do-norte/natal ; https://www.casamentos.com.br/hotel-casamento/rio-grande-do-norte/natal ; https://www.casamentos.com.br/chacara-casamento/rio-grande-do-norte/natal ; https://www.casamentos.com.br/restaurante-casamento/rio-grande-do-norte
- https://www.casamentos.com.br/buffet-casamento/rio-grande-do-norte/natal ; /rio-grande-do-norte
- https://www.casamentos.com.br/fotografo-casamento/rio-grande-do-norte/natal ; /natal--2 ; /rio-grande-do-norte
- https://www.casamentos.com.br/filmagem-casamento/rio-grande-do-norte/natal
- https://www.casamentos.com.br/decoracao-casamento/rio-grande-do-norte/natal ; /parnamirim
- https://www.casamentos.com.br/musica-de-casamento/rio-grande-do-norte/natal ; /natal--2 ; https://www.casamentos.com.br/musica-de-casamento/dj-para-casamento/rio-grande-do-norte
- https://www.casamentos.com.br/bolo-casamento/rio-grande-do-norte/natal ; https://www.casamentos.com.br/doces-casamento/rio-grande-do-norte/natal
- https://www.casamentos.com.br/convites-de-casamento/rio-grande-do-norte/natal ; https://www.casamentos.com.br/lembrancas-de-casamento/rio-grande-do-norte/natal
- https://www.casamentos.com.br/carros-casamento/rio-grande-do-norte/natal ; https://www.casamentos.com.br/celebrante/rio-grande-do-norte/natal ; https://www.casamentos.com.br/beleza-noivas/rio-grande-do-norte/natal
- https://www.casamentos.com.br/bebidas-casamento/rio-grande-do-norte/natal ; https://www.casamentos.com.br/florista-casamento/rio-grande-do-norte/natal ; https://www.casamentos.com.br/animacao-festa/rio-grande-do-norte ; https://www.casamentos.com.br/cabine-de-fotos/rio-grande-do-norte/natal ; https://www.casamentos.com.br/casamentos-na-praia/rio-grande-do-norte/natal
- https://www.casamentos.com.br/cerimonialista/z2-eventos-e-cerimonial--e288813

**Outros diretórios**
- https://www.constancezahn.com/fornecedores/brasil/rn/natal/
- https://lapisdenoiva.com/local/rio-grande-do-norte/natal/
- https://www.zankyou.com.br/espacos-saloes-festa-casamento/cidade/natal (bloqueado por robots)
- https://www.organizandoeventos.com.br/RN/Natal/ (+ alimentacao.htm, Bebidas.htm, estruturas-e-equipamentos.htm, organizacao-e-producao.htm, animacao.htm, decoracao.htm, Filmagem-e-Fotografia-em-Eventos.htm, musica-ao-vivo.htm, profissionais.htm, som-luz-e-imagem.htm, veiculos.htm, espaco-para-eventos.htm, aluguel-de-som-e-luz.htm, Aluguel-de-tendas.htm, aluguel-de-brinquedos-inflaveis.htm, buffet-infantil-a-domicilio.htm, recreadores-infantis.htm)
- https://www.starofservice.com.br/dir/rio-grande-do-norte/natal/natal (+ servico-de-buffet, dj, fotografia-de-casamento, decoracao-de-casamentos, organizacao-de-casamentos, locacao-de-utensilios-para-festas, locacao-de-espacos-para-eventos, show-de-musica-para-casamentos, organizacao-de-eventos-corporativos, organizacao-de-festas, buffet-volante)
- https://telepesquisa.com/rn/empresas/l/salao-de-festas/natal ; /a/buffet-infantil/natal ; /a/cerimonial/natal ; /a/organizacao-de-eventos/natal ; /a/buffet/natal ; /a/aluguel-de-brinquedos/natal
- https://www.solutudo.com.br/empresas/rn/natal/aluguel+de+saloes+de+festa ; /buffet ; /organizacao+de+festas+e+eventos ; /decoracao+de+festas
- https://locadoresdebrinquedos.com.br/brinquedos/natal
- https://www.getninjas.com.br/eventos/rn/natal ; https://www.getninjas.com.br/eventos/animacao-de-festas/recreacao-infantil/rn/natal
- https://www.econodata.com.br/lista-empresas/RIO-GRANDE-DO-NORTE/NATAL (sem dados por cidade sem login)

**Sites de fornecedores e associações**
- https://www.wsomnatal.com/ ; https://www.wsomnatal.com/2023/10/dj-natal-rn.html
- https://josybuffet.com.br/infantil ; https://www.abracadabrafestas.com.br/
- https://www.z2eventos.com.br/
- https://rn.abrasel.com.br/ ; https://abrafesta.com.br/ ; https://abeoc.org.br/
- https://formatura.com.br/
- https://choppexpress.com.br/delivery/natal/ ; https://barrildechopp.com.br/natal/ ; https://www.facebook.com/cervejariaoktosnatal/ ; https://www.facebook.com/foodtrucknatal/ ; https://www.facebook.com/natalfoodpark/ ; https://www.instagram.com/multitendas/ ; https://www.instagram.com/gardennatal/ ; https://www.instagram.com/espacoreservaeventos/ (localizados na busca; não abertos)

**Calendário e notícias**
- https://tribunadonorte.com.br/natal/carnatal-35-anuncia-retorno-de-anitta-e-amplia-cidade-carnatal-para-alem-da-folia-confira-a-programacao/ (27/08/2026)
- https://tribunadonorte.com.br/viver/carnatal-35-anos-tem-lancamento-marcado-para-quinta-feira-27-na-arena-das-dunas/ (26/08/2026)
- https://tribunadonorte.com.br/natal/prefeitura-avalia-acabar-com-shows-do-natal-em-natal-paulinho-quer-fortalecer-programacao-nos-bairros/ (31/07/2026)
- https://pt.wikipedia.org/wiki/Carnatal ; https://en.wikipedia.org/wiki/Carnatal
- https://outgo.com.br/ ; https://outgo.com.br/natal
- https://www.sympla.com.br/eventos/natal-rn (JS; sem lista no fetch)
- https://www.natal.rn.gov.br/news/post2/31847 (Festival Food Truck na Estrada; bloqueado no fetch, localizado na busca)
