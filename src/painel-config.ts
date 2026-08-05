import { Modal, Notice, PluginSettingTab, Setting, setIcon, type App } from "obsidian";
import { abrirAcordeao, criarAcordeao } from "./acordeao";
import {
	CORES,
	botaoResolvido,
	botoesDoGrupo,
	criarBotaoSalvo,
	criarGrupo,
	criarDashboard,
	criarMudancaPropriedade,
	criarQuadrante,
	dashboardAtivo,
	dashboardQueUsaNota,
	duplicarBotao,
	duplicarBotaoSalvo,
	duplicarQuadrante,
	ehControle,
	ehHex,
	removerBotaoSalvo,
	removerGrupo,
	trocarBotaoSalvo,
	usarBotaoSalvo,
	usosDoBotaoSalvo,
	type BotaoSalvo,
	type GrupoBotoes,
	limitarColunas,
	limitarLargura,
	limitarLarguraQuadrante,
	limparOpcoes,
	mover,
	removerDashboard,
	type Botao,
	type DadosDashHome,
	type Dashboard,
	type MudancaPropriedade,
	type OperacaoPropriedade,
	type Quadrante,
	type TipoAcao,
	type TipoCampo,
	type TipoValorPropriedade,
} from "./dados";
import { estiloAtivo, resolverEstilo, type EstiloQuadrante, type PosicaoBarra } from "./estilo";
import {
	FAIXAS,
	quemDefine,
	resolverEstiloBotao,
	type AlinhamentoBotao,
	type ArranjoBotoes,
	type Camada,
	type CorLetraBotao,
	type EstiloBotao,
	type FormaBotao,
	type PinturaBotao,
} from "./estilo-botao";
import { paletasDoCustomize, type PaletaExterna } from "./paleta";
import type DashCardsPlugin from "./main";
import { renderizarDashboard } from "./render";
import {
	ModalEscolherBase,
	ModalEscolherComando,
	ModalEscolherIcone,
	ModalEscolherNota,
	ModalEscolherPasta,
	ModalEscolherPropriedade,
	valoresDaPropriedade,
} from "./seletores";

/**
 * O painel onde o dashboard é montado — sem escrever uma linha de YAML.
 *
 * ── Layout ───────────────────────────────────────────────────────────────────────────────
 *
 * Duas colunas: à esquerda a montagem (quadrantes expansíveis, cada um com seus botões), à direita
 * a miniatura, que é o MESMO `renderizarDashboard` usado na nota, só que em escala reduzida e com
 * os botões inertes. Preview que não usa o código do resultado real acaba divergindo dele.
 *
 * ── Por que o redesenho é sempre total ───────────────────────────────────────────────────
 *
 * Toda mudança chama `atualizar()`, que redesenha o painel inteiro. É mais trabalho de CPU do que
 * mexer só no nó que mudou, mas remove a classe inteira de bugs em que a tela mostra um estado e o
 * data.json guarda outro. Num painel de configurações, que abre por segundos e não por horas, essa
 * troca vale a pena.
 */
/**
 * O que os editores de ação sabem configurar: a parte comum entre um `Botao` de quadrante e um
 * `BotaoSalvo` da biblioteca.
 *
 * Existe para que os dois usem os MESMOS editores (destino, propriedades, criar nota). Duplicá-los
 * faria uma opção nova valer só num dos lados — e o molde é justamente o lugar onde ela configura
 * uma vez para usar em todos.
 */
type Configuravel = Pick<Botao, "texto" | "tipo" | "destino" | "propriedades" | "criar">;

/**
 * As duas telas do painel.
 *
 * "dashboards" é a montagem: quadrantes, grade, notas e a aparência do CARD. "botoes" é a
 * biblioteca: os botões pré-configurados e a aparência de botão (global e a de cada botão salvo).
 *
 * A divisão é por assunto, não por conveniência de código: montar o layout e configurar um botão
 * reutilizável são trabalhos que acontecem em momentos diferentes, e num painel só cada um esconde
 * o outro. A camada do MEIO (aparência dos botões de um quadrante específico) fica na tela de
 * dashboards de propósito — é uma sobreposição daquele card, e só faz sentido ao lado dele.
 */
type Tela = "dashboards" | "botoes";

export class PainelConfigDashCards extends PluginSettingTab {
	// O estado de aberto/fechado dos acordeões vive no módulo `acordeao.ts`, não aqui — ver o
	// comentário de `abertos` lá.

	constructor(app: App, private plugin: DashCardsPlugin) {
		super(app, plugin);
	}

	/** Timer do salvamento adiado dos campos de texto (ver `salvarDigitacao`). */
	private timerDigitacao: number | null = null;

	/** Paletas do plugin Customize. Lidas do disco uma vez por abertura do painel. */
	private paletas: PaletaExterna[] = [];
	private leuPaletas = false;

	/**
	 * A tela aberta. Fica na INSTÂNCIA (e não no data.json) de propósito: é estado de navegação, não
	 * configuração dela — gravar no disco faria o painel reabrir dias depois na tela em que ela por
	 * acaso parou, em vez de na montagem, que é o começo natural.
	 */
	private tela: Tela = "dashboards";

	display(): void {
		this.atualizar();

		// Ler o data.json do Customize toca o disco: fica fora do caminho de desenho, e só
		// redesenha se houver paleta para mostrar. Assim `atualizar()` continua síncrono.
		if (!this.leuPaletas) {
			this.leuPaletas = true;
			void paletasDoCustomize(this.app).then((paletas) => {
				if (paletas.length === 0) return;
				this.paletas = paletas;
				this.atualizar();
			});
		}
	}

	hide(): void {
		// Sair das configurações com uma digitação pendente não pode perdê-la.
		this.descarregarDigitacao();
	}

	/** Salva, regrava a nota do dashboard e redesenha o painel (miniatura incluída). */
	private async aplicar(): Promise<void> {
		this.cancelarDigitacao();
		await this.plugin.salvar();
		this.atualizar();
	}

	/**
	 * Salvamento adiado, para campos de texto E SLIDERS.
	 *
	 * Escrever no vault a cada tecla é errado por dois motivos: gera uma escrita de arquivo por
	 * caractere, e transforma qualquer falha numa enxurrada de notificações — foi exatamente o que
	 * aconteceu com o bug de caixa do nome da nota. Meio segundo depois da última tecla é o
	 * suficiente para parecer instantâneo e escrever uma vez só.
	 *
	 * ── Por que os sliders também usam isto ──────────────────────────────────────────────
	 *
	 * Um slider chamava `aplicar()` no `onChange`, e `aplicar()` redesenha o painel inteiro —
	 * ou seja, DESTRÓI E RECRIA o próprio slider que está sendo arrastado, a cada pixel. O
	 * arrasto era interrompido no primeiro movimento e o valor parava onde estava: a usuária
	 * arrastava a largura e "não mudava nada".
	 *
	 * A miniatura, essa sim, atualiza a cada movimento: ela é memória, não disco, e é redesenhada
	 * sozinha sem tocar nos controles.
	 */
	private salvarDigitacao(): void {
		this.atualizarPreview();
		this.cancelarDigitacao();
		this.timerDigitacao = window.setTimeout(() => {
			this.timerDigitacao = null;
			void this.plugin.salvar();
		}, 500);
	}

	private cancelarDigitacao(): void {
		if (this.timerDigitacao === null) return;
		window.clearTimeout(this.timerDigitacao);
		this.timerDigitacao = null;
	}

	/** Executa agora o salvamento pendente, se houver. */
	private descarregarDigitacao(): void {
		if (this.timerDigitacao === null) return;
		this.cancelarDigitacao();
		void this.plugin.salvar();
	}

	private atualizar(trocouDeTela = false): void {
		const { containerEl } = this;

		// Guarda e devolve o scroll. Sem isto, cada clique (trocar cor, reordenar, abrir um
		// quadrante) joga o painel de volta para o topo e a usuária tem que se reencontrar na
		// lista — o redesenho total é conveniente para o código, mas quem paga o preço é ela.
		//
		// Na TROCA DE TELA, não: as duas têm alturas e conteúdos diferentes, e devolver a posição de
		// uma na outra a deixaria no meio de uma lista que ela nunca rolou. Tela nova começa no topo.
		const rolagem = this.acharRolagem();
		const posicao = trocouDeTela ? 0 : (rolagem?.scrollTop ?? 0);

		containerEl.empty();
		containerEl.addClass("dash-home-config");

		const dados = this.plugin.dados;
		const dashboard = dashboardAtivo(dados);

		this.desenharAbas(containerEl);

		if (this.tela === "botoes") {
			// Sem a coluna da miniatura: ela mostra o dashboard montado, e um botão salvo não está
			// nele — não reagiria ao que ela edita aqui. A largura inteira vai para os controles.
			this.desenharTelaBotoes(containerEl, dados);
		} else {
			this.desenharBarraDashboards(containerEl, dashboard);

			const colunas = containerEl.createDiv({ cls: "dash-home-config-colunas" });
			const esquerda = colunas.createDiv({ cls: "dash-home-config-montagem" });
			const direita = colunas.createDiv({ cls: "dash-home-config-preview" });

			this.desenharMontagem(esquerda, dashboard);
			this.desenharPreview(direita, dashboard);
		}

		if (rolagem && (posicao > 0 || trocouDeTela)) {
			// Depois do layout: o conteúdo acabou de ser recriado e a altura só é conhecida agora.
			// Sem o requestAnimationFrame o scrollTop é cortado para a altura antiga (menor).
			window.requestAnimationFrame(() => {
				rolagem.scrollTop = posicao;
			});
		}
	}

	/**
	 * As duas telas do painel, como abas no topo.
	 *
	 * `<button>` de verdade (e não uma div com onclick): dá foco por teclado, Enter/Espaço e leitura
	 * de tela sem uma linha de JS — o mesmo princípio do cabeçalho do acordeão e da chavinha da s23.
	 */
	private desenharAbas(el: HTMLElement): void {
		const barra = el.createDiv({ cls: "dash-home-config-abas", attr: { role: "tablist" } });

		const aba = (tela: Tela, titulo: string, icone: string, descricao: string) => {
			const ativa = this.tela === tela;
			const botao = barra.createEl("button", {
				cls: "dash-home-config-aba",
				attr: { role: "tab", "aria-selected": String(ativa), title: descricao },
			});
			botao.toggleClass("is-ativa", ativa);
			setIcon(botao.createSpan({ cls: "dash-home-config-aba-icone" }), icone);
			botao.createSpan({ text: titulo });

			botao.addEventListener("click", () => {
				if (this.tela === tela) return;
				// Uma digitação pendente é gravada ANTES de trocar: o redesenho descarta os campos, e
				// o texto que ela acabou de digitar sumiria com eles.
				this.descarregarDigitacao();
				this.tela = tela;
				this.atualizar(true);
			});
		};

		aba("dashboards", "Dashboards", "layout-grid", "Montar os dashboards: quadrantes, grade e aparência dos cards");
		aba("botoes", "Botões", "mouse-pointer-click", "Os botões pré-configurados e a aparência dos botões");
	}

	/**
	 * A tela de botões: a biblioteca e a aparência de botão.
	 *
	 * A aparência GLOBAL mora aqui (e não na tela de dashboards) porque é aparência de botão — foi o
	 * pedido dela. Continua sendo global de verdade: vale para todo botão de todo dashboard, e não
	 * só para os salvos.
	 */
	private desenharTelaBotoes(el: HTMLElement, dados: DadosDashHome): void {
		this.desenharBiblioteca(el, dados);

		const secaoAparencia = criarAcordeao(el, {
			chave: "secao:aparencia-botoes-global",
			titulo: "Aparência dos botões",
			descricao:
				"A base de todo botão do vault. Um botão salvo pode ter a sua, e um quadrante pode " +
				"sobrepor a dos botões dele.",
		});

		secaoAparencia.sePreenchido((corpo) => {
			this.desenharEstiloBotao(corpo, {
				alvo: (dados.estiloBotaoGlobal ??= {}),
				camada: "global",
				global: dados.estiloBotaoGlobal,
				doQuadrante: undefined,
				doBotao: undefined,
			});
		});

		// O tamanho dos botões é do dashboard inteiro (uma classe no contêiner, não uma variável de
		// botão), mas é tamanho de BOTÃO — pela regra dela, o controle vem para cá.
		const secaoTamanho = criarAcordeao(el, {
			chave: "secao:tamanho-botoes",
			titulo: "Tamanho dos botões",
			descricao: "Vale para o dashboard inteiro.",
		});

		secaoTamanho.sePreenchido((corpo) => {
			new Setting(corpo)
				.setName("Tamanho")
				.setDesc("Cada botão ainda pode ter o seu tamanho de letra.")
				.addDropdown((drop) => {
					drop.addOption("pequeno", "Pequeno");
					drop.addOption("medio", "Médio");
					drop.addOption("grande", "Grande");
					drop.setValue(dados.tamanhoBotao);
					drop.onChange(async (valor) => {
						dados.tamanhoBotao = valor as typeof dados.tamanhoBotao;
						await this.aplicar();
					});
				});
		});
	}

	/**
	 * O elemento que realmente rola. O Obsidian coloca o conteúdo das configurações dentro de um
	 * `.vertical-tab-content`, que é quem tem o overflow — `containerEl` em si não rola. Se essa
	 * estrutura mudar, caímos no próprio containerEl em vez de quebrar.
	 */
	private acharRolagem(): HTMLElement | null {
		const proprio = this.containerEl;
		if (proprio.scrollHeight > proprio.clientHeight) return proprio;
		return proprio.closest<HTMLElement>(".vertical-tab-content") ?? null;
	}

	// ── Barra superior: escolher/criar/renomear dashboard ────────────────────────────────

	private desenharBarraDashboards(el: HTMLElement, dashboard: Dashboard): void {
		const dados = this.plugin.dados;

		new Setting(el)
			.setName("Dashboard")
			.setDesc("Qual dashboard você está montando. Cada um vira uma nota do vault.")
			.addDropdown((drop) => {
				for (const d of dados.dashboards) drop.addOption(d.id, d.nome);
				drop.setValue(dashboard.id);
				drop.onChange(async (valor) => {
					dados.dashboardAtivoId = valor;
					// Só troca o que o painel exibe — não mexe em nota nenhuma, então não precisa
					// do `aplicar()` completo; basta persistir a escolha e redesenhar.
					await this.plugin.salvarSemGerar();
					this.atualizar();
				});
			})
			.addButton((botao) =>
				botao
					.setIcon("plus")
					.setTooltip("Novo dashboard")
					.onClick(async () => {
						const novo = criarDashboard(dados, "Novo dashboard");
						dados.dashboardAtivoId = novo.id;
						await this.aplicar();
					}),
			)
			.addButton((botao) =>
				botao
					.setIcon("trash-2")
					.setTooltip("Excluir este dashboard (a nota não é apagada)")
					.setWarning()
					.onClick(async () => {
						if (!removerDashboard(dados, dashboard.id)) {
							new Notice("Este é o único dashboard — não dá para excluir.");
							return;
						}
						new Notice("Dashboard excluído. A nota continua no vault.");
						await this.plugin.salvarSemGerar();
						this.atualizar();
					}),
			);

		// ── Dois acordeões, na ordem que a usuária pediu (sessão 19) ─────────────────────────
		//
		// 1. "Nome e notas": a identidade da predefinição — o que ela é e onde é escrita.
		// 2. "Grade e largura": a forma do dashboard.
		//
		// Ambos nascem ABERTOS: são o começo da montagem, e chegar num painel todo fechado
		// esconderia justamente o que se configura primeiro.
		const secaoIdentidade = criarAcordeao(el, {
			chave: `${dashboard.id}:identidade-dashboard`,
			titulo: "Nome e notas",
			descricao: "Como esta predefinição se chama e em quais notas ela é escrita.",
			abertoPorPadrao: true,
		});

		secaoIdentidade.sePreenchido((corpo) => {
			new Setting(corpo)
				.setName("Nome")
				.setDesc("Só o nome do dashboard nas configurações — não muda a nota.")
				.addText((texto) =>
					texto.setValue(dashboard.nome).onChange((valor) => {
						dashboard.nome = valor;
						// Sem redesenhar: o campo tem foco e um redesenho a cada tecla o perderia.
						this.salvarDigitacao();
					}),
				);

			this.desenharNotas(corpo, dashboard);
		});

		const secaoGrade = criarAcordeao(el, {
			chave: `${dashboard.id}:grade`,
			titulo: "Grade e largura",
			descricao: "A forma do dashboard: em quantas colunas divide e quanto ocupa na nota.",
			abertoPorPadrao: true,
		});

		// A linha divisória embaixo deste grupo, pedida pela usuária: ele fecha o bloco do
		// dashboard em si, e o que vem depois (Quadrantes, Aparência) é outro assunto.
		secaoGrade.secao.addClass("dash-home-acordeao-fim-de-grupo");

		secaoGrade.sePreenchido((corpo) => this.desenharGrade(corpo, dashboard));
	}

	/** Grade e largura — o segundo acordeão do topo. */
	private desenharGrade(el: HTMLElement, dashboard: Dashboard): void {
		new Setting(el)
			.setName("Grade")
			.setDesc(
				"A base do layout: em quantas colunas a largura é dividida. Cada quadrante escolhe " +
					"quantas dessas colunas ocupa. Com 6, dá para misturar tamanhos na mesma linha " +
					"(1 + 3 + 2, por exemplo).",
			)
			.addSlider((slider) =>
				slider
					.setLimits(1, 6, 1)
					.setValue(limitarColunas(dashboard.colunas))
					.setDynamicTooltip()
					.onChange((valor) => {
						dashboard.colunas = limitarColunas(valor);
						// Reduzir as colunas pode deixar larguras maiores que a grade, o que criaria
						// colunas implícitas e desfaria o layout. Renormalizamos aqui, e não só na
						// carga, senão o dashboard fica quebrado até o próximo reinício.
						for (const quad of dashboard.quadrantes) {
							quad.largura = limitarLarguraQuadrante(quad.largura, dashboard.colunas);
						}
						// Adiado, não `aplicar()`: redesenhar destruiria este slider durante o arrasto.
						this.salvarDigitacao();
					}),
			);

		const larguraNumerica = typeof dashboard.largura === "number";

		new Setting(el)
			.setName("Largura")
			.setDesc("Quanto o dashboard ocupa na nota. A largura de leitura do Obsidian é o padrão.")
			.addDropdown((drop) => {
				drop.addOption("leitura", "Largura de leitura");
				drop.addOption("total", "Largura total");
				drop.addOption("px", "Largura fixa (px)");
				drop.setValue(larguraNumerica ? "px" : (dashboard.largura as string));
				drop.onChange(async (valor) => {
					// Ao entrar em "px" começa em 900: um valor já utilizável, em vez de 0.
					dashboard.largura = valor === "px" ? 900 : limitarLargura(valor);
					await this.aplicar();
				});
			});

		if (larguraNumerica) {
			new Setting(el)
				.setName("Largura em pixels")
				.setDesc("O dashboard nunca passa da largura disponível, mesmo que o valor seja maior.")
				.addSlider((slider) =>
					slider
						// Teto de 1600: acima disso não há tela onde a diferença apareça, e um valor
						// maior que a janela só confunde (parece que a configuração não funcionou).
						.setLimits(400, 1600, 20)
						.setValue(dashboard.largura as number)
						.setDynamicTooltip()
						.onChange((valor) => {
							dashboard.largura = limitarLargura(valor);
							this.salvarDigitacao();
						}),
				);
		}
	}

	// ── Coluna esquerda: quadrantes e botões ─────────────────────────────────────────────

	private desenharMontagem(el: HTMLElement, dashboard: Dashboard): void {
		// Dois acordeões irmãos, no estilo do painel do My Tasks: "Quadrantes" (com um acordeão
		// por quadrante dentro) e "Aparência". Sem moldura em volta — só a linha divisória e o
		// recuo do conteúdo dão a leitura de hierarquia.
		// O resumo diz "3 quadrantes", e não só "3": um número solto ao lado de um título obriga a
		// adivinhar do que ele é. Custa duas palavras e poupa a dúvida.
		const total = dashboard.quadrantes.length;
		const secaoQuadrantes = criarAcordeao(el, {
			chave: `${dashboard.id}:quadrantes`,
			titulo: "Quadrantes",
			resumo: total === 0 ? "nenhum" : total === 1 ? "1 quadrante" : `${total} quadrantes`,
			abertoPorPadrao: true,
		});

		secaoQuadrantes.sePreenchido((corpo) => {
			if (dashboard.quadrantes.length === 0) {
				corpo.createDiv({
					cls: "dash-home-config-vazio",
					text: "Nenhum quadrante ainda. Crie o primeiro abaixo.",
				});
			}

			dashboard.quadrantes.forEach((quadrante, indice) => {
				this.desenharQuadrante(corpo, dashboard, quadrante, indice);
			});

			new Setting(corpo).addButton((botao) =>
				botao
					.setButtonText("+ Novo quadrante")
					.setCta()
					.onClick(async () => {
						const novo = criarQuadrante(dashboard, "Novo quadrante");
						// Nasce aberto, pronto para ser preenchido, em vez de fechado no fim da lista.
						abrirAcordeao(`${novo.id}:quadrante`);
						abrirAcordeao(`${novo.id}:conteudo`);
						await this.aplicar();
					}),
			);
		});

		// O mesmo botão no CABEÇALHO da seção, e não só no fim da lista: com dez quadrantes, chegar
		// ao "+ Novo" exigia rolar por todos eles. O acordeão ignora cliques em `-acoes`, então o
		// botão não abre/fecha a seção ao ser usado.
		const acoesQuadrantes = secaoQuadrantes.cabecalho.createDiv({ cls: "dash-home-acordeao-acoes" });
		this.botaoIcone(acoesQuadrantes, "plus", "Novo quadrante", true, async () => {
			const novo = criarQuadrante(dashboard, "Novo quadrante");
			abrirAcordeao(`${dashboard.id}:quadrantes`);
			abrirAcordeao(`${novo.id}:quadrante`);
			abrirAcordeao(`${novo.id}:conteudo`);
			await this.aplicar();
		});

		const dados = this.plugin.dados;

		// A biblioteca e a aparência de BOTÃO vivem na outra tela — aqui é a montagem do dashboard.
		const secaoAparencia = criarAcordeao(el, {
			chave: "secao:aparencia",
			titulo: "Aparência dos cards",
			descricao: "Vale para todos os quadrantes; cada um pode sobrescrever.",
		});

		secaoAparencia.sePreenchido((corpo) => this.desenharAparencia(corpo, dados));
	}

	/**
	 * A biblioteca de botões pré-configurados, compartilhada por todos os dashboards.
	 *
	 * Existe para que montar um card não exija reescolher ícone, ação e propriedades a cada vez: ela
	 * cadastra aqui uma vez e, no quadrante, só seleciona da lista.
	 *
	 * Nasce FECHADA, ao contrário de "Quadrantes": a biblioteca é preparação, não o trabalho do dia
	 * a dia. Abrir sozinha empurraria os quadrantes — o que ela realmente veio montar — para baixo.
	 */
	private desenharBiblioteca(el: HTMLElement, dados: DadosDashHome): void {
		const salvos = dados.botoesSalvos ?? [];

		const secao = criarAcordeao(el, {
			chave: "secao:biblioteca",
			titulo: "Botões salvos",
			descricao: "Todo botão do vault é criado aqui. Nos cards, você só escolhe qual usar.",
			resumo: salvos.length === 0 ? "nenhum" : salvos.length === 1 ? "1 botão" : `${salvos.length} botões`,
		});

		secao.sePreenchido((corpo) => {
			if (salvos.length === 0) {
				corpo.createDiv({
					cls: "dash-home-config-vazio",
					text: "Nenhum botão salvo ainda. Os que você cadastrar aqui ficam disponíveis em todos os dashboards.",
				});
			}

			// Um acordeão por grupo, na ordem que ela definiu, e "Sem grupo" por último — ele é o
			// resto, não uma categoria; primeiro na lista, empurraria os grupos dela para baixo.
			for (const grupo of dados.gruposBotoes ?? []) {
				this.desenharGrupo(corpo, dados, grupo);
			}

			const semGrupo = botoesDoGrupo(dados, undefined);
			if (semGrupo.length > 0) {
				// Só aparece quando há algo dentro: um "Sem grupo" vazio permanente seria ruído.
				const secaoSem = criarAcordeao(corpo, {
					chave: "grupo:sem-grupo",
					titulo: "Sem grupo",
					resumo: semGrupo.length === 1 ? "1 botão" : `${semGrupo.length} botões`,
					aninhado: true,
					abertoPorPadrao: true,
				});
				secaoSem.sePreenchido((dentro) => {
					for (const salvo of semGrupo) this.desenharBotaoSalvo(dentro, dados, salvo, semGrupo);
				});
			}

			const acoesRodape = new Setting(corpo);
			acoesRodape.addButton((b) =>
				b
					.setButtonText("+ Novo botão salvo")
					.setCta()
					.onClick(async () => {
						const novo = criarBotaoSalvo(dados, "Novo botão salvo");
						abrirAcordeao(`${novo.id}:salvo`);
						await this.aplicar();
					}),
			);
			acoesRodape.addButton((b) =>
				b
					.setButtonText("+ Novo grupo")
					.setTooltip("Uma gaveta para organizar os botões salvos")
					.onClick(async () => {
						const novo = criarGrupo(dados, "Novo grupo");
						abrirAcordeao(`grupo:${novo.id}`);
						await this.aplicar();
					}),
			);
		});

		// Os mesmos botões no cabeçalho, pelo motivo do "+ Novo quadrante": com a lista longa,
		// chegar ao botão do fim exigiria rolar por todos os moldes.
		const acoes = secao.cabecalho.createDiv({ cls: "dash-home-acordeao-acoes" });
		this.botaoIcone(acoes, "folder-plus", "Novo grupo", true, async () => {
			const novo = criarGrupo(dados, "Novo grupo");
			abrirAcordeao("secao:biblioteca");
			abrirAcordeao(`grupo:${novo.id}`);
			await this.aplicar();
		});
		this.botaoIcone(acoes, "plus", "Novo botão salvo", true, async () => {
			const novo = criarBotaoSalvo(dados, "Novo botão salvo");
			abrirAcordeao("secao:biblioteca");
			abrirAcordeao(`${novo.id}:salvo`);
			await this.aplicar();
		});
	}

	/** Um grupo da biblioteca: nome, ícone, os botões dele — e o botão de criar já dentro dele. */
	private desenharGrupo(el: HTMLElement, dados: DadosDashHome, grupo: GrupoBotoes): void {
		const doGrupo = botoesDoGrupo(dados, grupo.id);
		const indice = dados.gruposBotoes.indexOf(grupo);

		const secao = criarAcordeao(el, {
			chave: `grupo:${grupo.id}`,
			titulo: grupo.nome || "Sem nome",
			resumo: doGrupo.length === 0 ? "vazio" : doGrupo.length === 1 ? "1 botão" : `${doGrupo.length} botões`,
			aninhado: true,
		});

		const acoes = secao.cabecalho.createDiv({ cls: "dash-home-acordeao-acoes" });
		this.botaoIcone(acoes, "chevron-up", "Subir", indice > 0, async () => {
			mover(dados.gruposBotoes, indice, -1);
			await this.aplicar();
		});
		this.botaoIcone(acoes, "chevron-down", "Descer", indice < dados.gruposBotoes.length - 1, async () => {
			mover(dados.gruposBotoes, indice, 1);
			await this.aplicar();
		});
		this.botaoIcone(acoes, "plus", "Novo botão neste grupo", true, async () => {
			const novo = criarBotaoSalvo(dados, "Novo botão salvo", grupo.id);
			abrirAcordeao(`grupo:${grupo.id}`);
			abrirAcordeao(`${novo.id}:salvo`);
			await this.aplicar();
		});
		this.botaoIcone(acoes, "trash-2", "Excluir grupo", true, async () => {
			// Excluir o grupo NÃO apaga os botões — mas ela precisa saber disso antes de clicar,
			// senão a confirmação parece ameaçar os botões que ela montou.
			if (doGrupo.length > 0) {
				const ok = await confirmar(
					this.app,
					`Excluir o grupo "${grupo.nome || "sem nome"}"?`,
					`Os ${doGrupo.length === 1 ? "1 botão" : `${doGrupo.length} botões`} dele não são apagados: voltam para "Sem grupo".`,
				);
				if (!ok) return;
			}
			removerGrupo(dados, grupo.id);
			await this.aplicar();
		});

		secao.sePreenchido((corpo) => {
			const cabecalho = new Setting(corpo).setClass("dash-home-config-botao-topo");
			cabecalho.addText((texto) =>
				texto
					.setPlaceholder("Nome do grupo")
					.setValue(grupo.nome)
					.onChange((valor) => {
						grupo.nome = valor;
						this.salvarDigitacao();
					}),
			);
			cabecalho.addButton((b) => {
				if (grupo.icone) b.setIcon(grupo.icone);
				else b.setButtonText("Ícone");
				b.setTooltip("Ícone do grupo (só na lista; não vai para o dashboard)");
				b.onClick(() => {
					new ModalEscolherIcone(this.app, grupo.nome, grupo.icone, async (icone) => {
						grupo.icone = icone;
						await this.aplicar();
					}).open();
				});
			});

			if (doGrupo.length === 0) {
				corpo.createDiv({
					cls: "dash-home-config-vazio",
					text: "Nenhum botão neste grupo. Use o + no cabeçalho, ou mude o grupo de um botão existente.",
				});
				return;
			}

			for (const salvo of doGrupo) this.desenharBotaoSalvo(corpo, dados, salvo, doGrupo);
		});
	}

	/**
	 * Um molde da biblioteca: nome, ícone, ação — e quantos botões dependem dele.
	 *
	 * `irmaos` é a lista do GRUPO em que ele está sendo desenhado, não a lista global: é ela que
	 * define o que "subir" e "descer" significam aqui. Mover pelo índice global faria o botão pular
	 * para dentro de outro grupo — ou trocar de lugar com um botão que ela nem está vendo.
	 */
	private desenharBotaoSalvo(
		el: HTMLElement,
		dados: DadosDashHome,
		salvo: BotaoSalvo,
		irmaos: BotaoSalvo[],
	): void {
		const usos = usosDoBotaoSalvo(dados, salvo.id);
		const posicao = irmaos.indexOf(salvo);

		const secao = criarAcordeao(el, {
			chave: `${salvo.id}:salvo`,
			titulo: salvo.texto || "Sem nome",
			// O número de usos vai no resumo porque é o que muda o peso de editar este molde: mexer
			// num usado em oito lugares muda oito cards de uma vez, e ela precisa saber disso ANTES.
			resumo: usos === 0 ? "não usado" : usos === 1 ? "em 1 card" : `em ${usos} cards`,
			aninhado: true,
		});

		const acoes = secao.cabecalho.createDiv({ cls: "dash-home-acordeao-acoes" });
		this.botaoIcone(acoes, "chevron-up", "Subir", posicao > 0, async () => {
			// A ordem vive na lista GLOBAL, mas o movimento é entre os vizinhos de grupo: troca de
			// posição com o irmão de cima, seja qual for a distância deles na lista global.
			trocarNaLista(dados.botoesSalvos, salvo, irmaos[posicao - 1]);
			await this.aplicar();
		});
		this.botaoIcone(acoes, "chevron-down", "Descer", posicao < irmaos.length - 1, async () => {
			trocarNaLista(dados.botoesSalvos, salvo, irmaos[posicao + 1]);
			await this.aplicar();
		});
		this.botaoIcone(acoes, "copy", "Duplicar", true, async () => {
			const copia = duplicarBotaoSalvo(dados, salvo.id);
			if (copia) abrirAcordeao(`${copia.id}:salvo`);
			await this.aplicar();
		});
		this.botaoIcone(acoes, "trash-2", "Excluir", true, async () => {
			// Excluir um molde usado mexe em cards de outros dashboards — que ela pode nem estar
			// vendo agora. Por isso a confirmação diz o número, e o que vai acontecer com eles.
			if (usos > 0) {
				const ok = await confirmar(
					this.app,
					`Excluir "${salvo.texto || "sem nome"}"?`,
					`Ele é usado em ${usos === 1 ? "1 card" : `${usos} cards`}. Esses botões continuam funcionando, mas deixam de ser atualizados por aqui.`,
				);
				if (!ok) return;
			}
			removerBotaoSalvo(dados, salvo.id);
			await this.aplicar();
		});

		secao.sePreenchido((corpo) => {
			const topo = new Setting(corpo).setClass("dash-home-config-botao-topo");
			topo.addText((texto) =>
				texto
					.setPlaceholder("Nome do botão")
					.setValue(salvo.texto)
					.onChange((valor) => {
						salvo.texto = valor;
						this.salvarDigitacao();
					}),
			);
			topo.addButton((b) => {
				if (salvo.icone) b.setIcon(salvo.icone);
				else b.setButtonText("Ícone");
				b.setTooltip("Escolher ícone");
				b.onClick(() => {
					new ModalEscolherIcone(this.app, salvo.texto, salvo.icone, async (icone) => {
						salvo.icone = icone;
						await this.aplicar();
					}).open();
				});
			});

			// Em qual gaveta ele fica. Dropdown (e não texto livre) porque o grupo é cadastrado à
			// parte: digitar um nome criaria um grupo fantasma que não existe na lista.
			new Setting(corpo)
				.setName("Grupo")
				.setDesc("Só organiza a lista daqui — não muda nada no dashboard.")
				.addDropdown((drop) => {
					drop.addOption("", "Sem grupo");
					for (const g of dados.gruposBotoes ?? []) drop.addOption(g.id, g.nome || "Sem nome");
					drop.setValue(salvo.grupoId ?? "");
					drop.onChange(async (valor) => {
						if (valor) salvo.grupoId = valor;
						else delete salvo.grupoId;
						// O botão vai mudar de lugar na tela: abre o grupo de destino, senão ele
						// "sumiria" dentro de um acordeão fechado.
						abrirAcordeao(valor ? `grupo:${valor}` : "grupo:sem-grupo");
						await this.aplicar();
					});
				});

			// Os MESMOS editores do botão de quadrante — ver o comentário de `Configuravel`.
			this.desenharDestino(corpo, salvo);
			if (salvo.tipo === "propriedade") this.desenharPropriedades(corpo, salvo);
			if (salvo.tipo === "criar") this.desenharCriarNota(corpo, salvo);

			// A aparência do molde é a TERCEIRA camada da herança, igual à de um botão comum: o que
			// não for definido aqui continua vindo do quadrante em que o botão for usado. É o que
			// permite o mesmo molde ficar bem num card azul e num verde.
			const secaoEstilo = criarAcordeao(corpo, {
				chave: `${salvo.id}:salvo-estilo`,
				titulo: "Aparência deste botão",
				descricao: "O que não for definido aqui segue o global — e um quadrante ainda pode sobrepor.",
				aninhado: true,
			});

			secaoEstilo.sePreenchido((dentro) => {
				this.desenharCorDoBotao(dentro, salvo);

				this.desenharEstiloBotao(dentro, {
					alvo: (salvo.estilo ??= {}),
					camada: "botao",
					global: dados.estiloBotaoGlobal,
					// Sem camada de quadrante: um molde não mora em quadrante nenhum — ele vale para
					// todos. Passar a de um quadrante qualquer faria o painel mostrar como "herdado"
					// um valor que só valeria naquele card.
					doQuadrante: undefined,
					doBotao: salvo.estilo,
				});

				new Setting(dentro).addButton((b) =>
					b
						.setButtonText("Voltar ao padrão")
						.setTooltip("Descarta os ajustes deste botão salvo — ele volta a seguir o global e o quadrante")
						.onClick(async () => {
							salvo.estilo = {};
							await this.aplicar();
						}),
				);
			});

			if (usos > 0) {
				corpo.createDiv({
					cls: "dash-home-config-vazio",
					text: `Alterações aqui valem para ${usos === 1 ? "o card que usa" : `os ${usos} cards que usam`} este botão.`,
				});
			}
		});
	}

	/**
	 * A aparência dos CARDS — o que vale para todos os quadrantes, salvo o que cada um sobrescrever.
	 *
	 * A parte de BOTÃO saiu daqui (foi para a tela "Botões", a pedido dela): esta seção agora trata
	 * só do card em si. Continua em dois acordeões, pelo motivo de sempre — uma parede de controles
	 * obriga a ler todos para achar um.
	 */
	private desenharAparencia(el: HTMLElement, dados: DadosDashHome): void {
		const secaoCard = criarAcordeao(el, {
			chave: "aparencia:card",
			titulo: "O que aparece no card",
			aninhado: true,
			abertoPorPadrao: true,
		});
		secaoCard.sePreenchido((corpo) => this.desenharAparenciaCard(corpo, dados));

		const secaoMoldura = criarAcordeao(el, {
			chave: "aparencia:moldura",
			titulo: "Moldura e espaçamento",
			descricao: "A barra colorida, os cantos e o respiro interno de cada card.",
			aninhado: true,
		});
		secaoMoldura.sePreenchido((corpo) => this.desenharAparenciaMoldura(corpo, dados));
	}

	/** O que o card MOSTRA, antes de como ele é desenhado. */
	private desenharAparenciaCard(el: HTMLElement, dados: DadosDashHome): void {
		new Setting(el)
			.setName("Mostrar títulos dos quadrantes")
			.setDesc("Desligue para cards só com os botões, sem o nome em cima.")
			.addToggle((toggle) =>
				toggle.setValue(dados.mostrarTitulos).onChange(async (valor) => {
					dados.mostrarTitulos = valor;
					await this.aplicar();
				}),
			);
	}

	/** A moldura do card: barra colorida, arredondamento, espaçamento, fundo. */
	private desenharAparenciaMoldura(el: HTMLElement, dados: DadosDashHome): void {
		// A herança (global → quadrante) segue a mesma lógica do estilo de callout do Customize.
		const global = dados.estiloGlobal;

		// Quantos quadrantes têm posição própria — eles ignoram esta configuração global, e sem
		// aviso a usuária mexe aqui e "não acontece nada" (o bug da sessão 11).
		//
		// `estiloAtivo` é essencial aqui: um quadrante que voltou a herdar ainda GUARDA uma
		// posição de barra, mas não a aplica. Contá-lo faria o aviso apontar quadrantes que na
		// verdade obedecem ao global — o mesmo tipo de mentira que o aviso existe para evitar.
		const comBarraPropria = this.plugin.dados.dashboards.flatMap((d) =>
			d.quadrantes.filter(
				(q) => estiloAtivo(q.personalizaEstilo, q.estilo)?.posicaoBarra !== undefined,
			),
		);

		const barraGlobal = new Setting(el)
			.setName("Barra colorida")
			.addDropdown((drop) => {
				drop.addOption("topo", "No topo");
				drop.addOption("esquerda", "À esquerda");
				drop.addOption("direita", "À direita");
				drop.addOption("baixo", "Embaixo");
				drop.addOption("volta", "Em volta (borda inteira)");
				drop.addOption("nenhuma", "Sem barra");
				drop.setValue(global.posicaoBarra ?? "topo");
				drop.onChange(async (valor) => {
					global.posicaoBarra = valor as PosicaoBarra;
					await this.aplicar();
				});
			});

		if (comBarraPropria.length > 0) {
			barraGlobal.setDesc(
				`${comBarraPropria.length} quadrante(s) têm barra própria e ignoram esta escolha.`,
			);
			barraGlobal.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Fazer todos herdarem daqui")
					.onClick(async () => {
						// Só a barra, e não a flag inteira: o quadrante pode ter personalizado
						// arredondamento e espaçamento também, e desligar tudo aqui apagaria
						// escolhas que este botão não promete tocar.
						for (const quad of comBarraPropria) {
							if (quad.estilo) delete quad.estilo.posicaoBarra;
						}
						new Notice("Todos os quadrantes voltaram a herdar a barra do global.");
						await this.aplicar();
					}),
			);
		}

		const efetivo = resolverEstilo(global, {});

		this.controleGlobal(el, "Espessura da barra", 1, 12, efetivo.espessuraBarra, (v) => {
			global.espessuraBarra = v;
		});
		this.controleGlobal(el, "Arredondamento", 0, 28, efetivo.radius, (v) => {
			global.radius = v;
		});
		this.controleGlobal(el, "Espaçamento interno", 4, 32, efetivo.padding, (v) => {
			global.padding = v;
		});
		this.controleGlobal(el, "Tamanho do ícone", 10, 32, efetivo.tamanhoIcone, (v) => {
			global.tamanhoIcone = v;
		});

		new Setting(el)
			.setName("Fundo colorido")
			.setDesc("Tinge o fundo dos cards com a cor de cada quadrante.")
			.addSlider((slider) =>
				slider
					.setLimits(0, 40, 5)
					.setValue(Math.round(efetivo.intensidadeFundo * 100))
					.setDynamicTooltip()
					.onChange((valor) => {
						global.intensidadeFundo = valor / 100;
						this.salvarDigitacao();
					}),
			);

		// Toggle pode usar `aplicar()`: é um clique único, não um arrasto — não há controle sendo
		// manipulado quando o redesenho acontece.
		new Setting(el).setName("Título na cor do quadrante").addToggle((toggle) =>
			toggle.setValue(efetivo.tituloColorido).onChange(async (valor) => {
				global.tituloColorido = valor;
				await this.aplicar();
			}),
		);
	}

	/** Slider do estilo global. Sempre tem valor (cai no padrão de fábrica), então não tem "herdar". */
	private controleGlobal(
		el: HTMLElement,
		nome: string,
		min: number,
		max: number,
		valor: number,
		definir: (v: number) => void,
	): void {
		new Setting(el).setName(nome).addSlider((slider) =>
			slider
				.setLimits(min, max, 1)
				.setValue(valor)
				.setDynamicTooltip()
				.onChange((v) => {
					definir(v);
					this.salvarDigitacao();
				}),
		);
	}

	private desenharQuadrante(
		el: HTMLElement,
		dashboard: Dashboard,
		quadrante: Quadrante,
		indice: number,
	): void {
		const ehMarkdown = quadrante.conteudo === "markdown";
		const ehSeparador = quadrante.conteudo === "separador";

		const secao = criarAcordeao(el, {
			chave: `${quadrante.id}:quadrante`,
			// Um separador raramente tem título; mostrar o texto dele (ou o tipo) evita uma lista
			// de "(sem título)" indistinguíveis.
			titulo:
				quadrante.titulo ||
				(ehSeparador ? quadrante.separador?.texto?.trim() || "Separador" : "(sem título)"),
			resumo: ehSeparador
				? "separador"
				: ehMarkdown
					? "conteúdo livre"
					: `${quadrante.conteudo === "ambos" ? "texto + " : ""}${quadrante.botoes.length} ${quadrante.botoes.length === 1 ? "botão" : "botões"}`,
			aninhado: true,
		});

		// Subir/descer/excluir vivem no cabeçalho. O acordeão ignora cliques dentro de
		// `.dash-home-acordeao-acoes`, então eles não abrem/fecham a seção.
		const acoes = secao.cabecalho.createDiv({ cls: "dash-home-acordeao-acoes" });
		this.botaoIcone(acoes, "chevron-up", "Subir", indice > 0, async () => {
			mover(dashboard.quadrantes, indice, -1);
			await this.aplicar();
		});
		this.botaoIcone(acoes, "chevron-down", "Descer", indice < dashboard.quadrantes.length - 1, async () => {
			mover(dashboard.quadrantes, indice, 1);
			await this.aplicar();
		});
		this.botaoIcone(acoes, "copy", "Duplicar quadrante", true, async () => {
			const copia = duplicarQuadrante(dashboard, indice);
			// A cópia nasce aberta, como o quadrante novo: quem duplica vai editar a diferença.
			if (copia) {
				abrirAcordeao(`${copia.id}:quadrante`);
				abrirAcordeao(`${copia.id}:conteudo`);
			}
			await this.aplicar();
		});
		this.botaoIcone(acoes, "trash-2", "Excluir quadrante", true, async () => {
			dashboard.quadrantes.splice(indice, 1);
			await this.aplicar();
		});

		secao.sePreenchido((corpo) => {
			// Dentro do quadrante, quatro acordeões aninhados. Sem eles um quadrante aberto vira uma
			// parede de ~12 controles.
			//
			// A ORDEM é a que a usuária pediu (sessão 19): título/ícone/largura → cor e aparência →
			// conteúdo → aparência dos botões. Ou seja, do que o quadrante É para o que ele MOSTRA —
			// e a aparência dos botões vem logo depois dos botões que ela estiliza.

			const secaoIdentidade = criarAcordeao(corpo, {
				chave: `${quadrante.id}:identidade`,
				titulo: "Título, ícone e largura",
				aninhado: true,
			});

			secaoIdentidade.sePreenchido((corpoIdentidade) => {
				new Setting(corpoIdentidade).setName("Título").addText((texto) =>
					texto.setValue(quadrante.titulo).onChange((valor) => {
						quadrante.titulo = valor;
						this.salvarDigitacao();
					}),
				);

				new Setting(corpoIdentidade)
					.setName("Ícone")
					.setDesc(quadrante.icone ? semPrefixo(quadrante.icone) : "Nenhum")
					.addButton((botao) => {
						if (quadrante.icone) botao.setIcon(quadrante.icone);
						else botao.setButtonText("Escolher");
						botao.setTooltip("Escolher ícone");
						botao.onClick(() => {
							new ModalEscolherIcone(this.app, quadrante.titulo, quadrante.icone, async (icone) => {
								quadrante.icone = icone;
								await this.aplicar();
							}).open();
						});
					});

				this.desenharLargura(corpoIdentidade, dashboard, quadrante);
			});

			const secaoAparencia = criarAcordeao(corpo, {
				chave: `${quadrante.id}:aparencia`,
				titulo: "Cor e aparência",
				aninhado: true,
			});

			secaoAparencia.sePreenchido((corpoAparencia) => {
				this.desenharSeletorDeCor(corpoAparencia, quadrante);
				this.desenharEstilo(corpoAparencia, quadrante);
			});

			const secaoConteudo = criarAcordeao(corpo, {
				chave: `${quadrante.id}:conteudo`,
				// O título diz o que a seção contém. O separador caía no `else` e virava "Botões",
			// num quadrante que não tem botão nenhum — daí ele entrar junto com o markdown.
			titulo:
				ehMarkdown || ehSeparador
					? "Conteúdo"
					: quadrante.conteudo === "ambos"
						? "Texto e botões"
						: "Botões",
				aninhado: true,
				abertoPorPadrao: true,
			});

			secaoConteudo.sePreenchido((corpoConteudo) => {
				new Setting(corpoConteudo)
					.setName("Tipo de conteúdo")
					.setDesc("Botões, texto livre, os dois juntos, ou um separador entre linhas.")
					.addDropdown((drop) => {
						drop.addOption("botoes", "Botões");
						drop.addOption("markdown", "Conteúdo livre");
						drop.addOption("ambos", "Texto + botões");
						drop.addOption("separador", "Separador / espaço");
						drop.setValue(quadrante.conteudo ?? "botoes");
						drop.onChange(async (valor) => {
							// Os botões NÃO são apagados ao trocar de tipo (nem o markdown): voltar
							// atrás tem que devolver o que existia. O que não é do tipo atual
							// simplesmente não é renderizado.
							quadrante.conteudo =
								valor === "botoes" ? undefined : (valor as "markdown" | "separador" | "ambos");
							await this.aplicar();
						});
					});

				if (quadrante.conteudo === "separador") {
					this.desenharSeparador(corpoConteudo, quadrante);
					return;
				}

				// Em "ambos" os dois editores aparecem, na mesma ordem em que o quadrante é
				// desenhado: primeiro o texto, depois os botões.
				if (ehMarkdown || quadrante.conteudo === "ambos") {
					this.desenharEditorMarkdown(corpoConteudo, quadrante);
				}

				if (ehMarkdown) return;

				if (quadrante.conteudo === "ambos") {
					// Um cabeçalho para separar as duas metades: sem ele o botão de adicionar
					// apareceria logo abaixo do campo de texto, sem dizer que começou outra coisa.
					corpoConteudo.createEl("h4", { text: "Botões" });
				}

				const salvos = this.plugin.dados.botoesSalvos ?? [];

				if (quadrante.botoes.length === 0) {
					// O estado vazio é um convite a agir, então diz o que fazer — e o que fazer mudou:
					// não se cria botão aqui, escolhe-se um da tela "Botões".
					corpoConteudo.createDiv({
						cls: "dash-home-config-vazio",
						text:
							salvos.length === 0
								? "Nenhum botão ainda. Cadastre um na tela “Botões” e depois escolha-o aqui."
								: "Nenhum botão ainda. Use “Adicionar botão” para escolher um dos salvos.",
					});
				}
				quadrante.botoes.forEach((botao, i) => {
					this.desenharBotao(corpoConteudo, quadrante, botao, i);
				});
				const acoesLista = new Setting(corpoConteudo);

				// O ÚNICO jeito de pôr um botão num card: escolher um salvo. Era o que ela pediu —
				// "nunca vai existir a possibilidade de eu criar um novo botão na parte do dashboard".
				acoesLista.addButton((botao) =>
					botao
						.setButtonText("Adicionar botão")
						.setCta()
						.setTooltip(
							salvos.length === 0
								? "Cadastre botões na tela “Botões”"
								: "Escolher um dos botões já configurados",
						)
						.onClick(() => {
							if (salvos.length === 0) {
								// Leva para onde o botão é criado, em vez de só avisar que não há nenhum.
								new Notice("Nenhum botão salvo ainda. Cadastre um aqui e depois escolha-o no card.");
								this.tela = "botoes";
								abrirAcordeao("secao:biblioteca");
								this.atualizar(true);
								return;
							}
							new ModalEscolherBotaoSalvo(
								this.app,
								salvos,
								async (salvo) => {
									usarBotaoSalvo(quadrante, salvo);
									await this.aplicar();
								},
								this.plugin.dados.gruposBotoes,
							).open();
						}),
				);

			// Não há mais "+ Novo botão" nem "Duplicar o último": o quadrante NÃO cria botão
				// próprio (decisão dela, s28). Todo botão vem da biblioteca, e é lá que se edita —
				// um segundo lugar de criar botão era exatamente o que fazia a mesma coisa existir em
				// dois formatos diferentes.
			});

			// A aparência dos botões deste quadrante. Em acordeão próprio, e não dentro de "Cor e
			// aparência", porque somados seriam ~18 controles numa seção só — a mesma razão que
			// levou os três acordeões aninhados a existirem (sessão 4).
			// Só para quadrante de botões: num de markdown ou separador não há botão para estilizar.
			if (!ehMarkdown && quadrante.conteudo !== "separador") {
				const secaoBotoes = criarAcordeao(corpo, {
					chave: `${quadrante.id}:aparencia-botoes`,
					titulo: "Aparência dos botões",
					aninhado: true,
				});

				secaoBotoes.sePreenchido((corpoBotoes) => {
					// Mesma chave "herdar ou personalizar" da aparência do quadrante, pelo mesmo
					// motivo — aqui são ainda MAIS controles herdados aparecendo sem fazer nada.
					const personalizaBotao = quadrante.personalizaEstiloBotao === true;

					new Setting(corpoBotoes)
						.setName("Aparência dos botões")
						.setDesc(
							personalizaBotao
								? "Os botões deste quadrante têm aparência própria; cada botão ainda pode ter a sua."
								: "Os botões deste quadrante seguem a aparência global.",
						)
						.addDropdown((drop) => {
							drop.addOption("herdar", "Herdar do global");
							drop.addOption("personalizar", "Personalizar");
							drop.setValue(personalizaBotao ? "personalizar" : "herdar");
							drop.onChange(async (valor) => {
								const querPersonalizar = valor === "personalizar";
								quadrante.personalizaEstiloBotao = querPersonalizar ? true : undefined;

								// Nasce igual ao que já herdava — nada muda de aparência no clique.
								// `cor` e `tamanhoFonte` ficam de fora: o padrão de fábrica deles é
								// `undefined` porque o valor real vem de outro lugar (a cor do
								// quadrante; o dropdown de tamanho), e fixá-los aqui desligaria esses
								// controles em silêncio — a armadilha nº 9 do doc.
								if (querPersonalizar && !this.temEstiloProprio(quadrante.estiloBotao)) {
									const { cor, tamanhoFonte, ...resto } = resolverEstiloBotao(
										this.plugin.dados.estiloBotaoGlobal,
										undefined,
										undefined,
									);
									quadrante.estiloBotao = resto;
								}
								await this.aplicar();
							});
						});

					if (!personalizaBotao) return;

					corpoBotoes.createDiv({
						cls: "dash-home-config-nota",
						text: "Vale para os botões deste quadrante; cada botão ainda pode ter o seu.",
					});

					this.desenharEstiloBotao(corpoBotoes, {
						alvo: (quadrante.estiloBotao ??= {}),
						camada: "quadrante",
						global: this.plugin.dados.estiloBotaoGlobal,
						doQuadrante: quadrante.estiloBotao,
						doBotao: undefined,
					});

					new Setting(corpoBotoes)
						.addButton((b) =>
							b
								.setButtonText("Voltar a herdar")
								.setTooltip("Segue o global de novo; os ajustes ficam guardados")
								.onClick(async () => {
									quadrante.personalizaEstiloBotao = undefined;
									await this.aplicar();
								}),
						)
						.addButton((b) =>
							b
								.setButtonText("Limpar os ajustes")
								.setTooltip("Descarta os ajustes de botão deste quadrante")
								.setWarning()
								.onClick(async () => {
									quadrante.estiloBotao = {};
									quadrante.personalizaEstiloBotao = undefined;
									new Notice("Aparência dos botões limpa. Eles voltaram a seguir o global.");
									await this.aplicar();
								}),
						);
				});
			}
		});
	}

	/**
	 * Os controles do separador — a "linha divisória entre uma linha e outra" que a usuária pediu,
	 * também servindo como respiro (só espaço) ou título de seção (só texto).
	 */
	private desenharSeparador(el: HTMLElement, quadrante: Quadrante): void {
		const cfg = (quadrante.separador ??= {});

		new Setting(el)
			.setName("Texto")
			.setDesc("Opcional. Vira um título de seção ao lado da linha.")
			.addText((texto) =>
				texto
					.setPlaceholder("Ex.: Trabalho")
					.setValue(cfg.texto ?? "")
					.onChange((valor) => {
						cfg.texto = valor;
						this.salvarDigitacao();
					}),
			);

		new Setting(el)
			.setName("Linha divisória")
			.setDesc("Desligue para ter só um espaço em branco entre as linhas.")
			.addToggle((toggle) =>
				toggle.setValue(cfg.linha !== false).onChange(async (valor) => {
					cfg.linha = valor;
					await this.aplicar();
				}),
			);

		new Setting(el)
			.setName("Espaço")
			.setDesc("Respiro acima e abaixo, em pixels.")
			.addSlider((slider) =>
				slider
					.setLimits(0, 48, 2)
					.setValue(cfg.espaco ?? 8)
					.setDynamicTooltip()
					.onChange((valor) => {
						cfg.espaco = valor;
						this.salvarDigitacao();
					}),
			);

		el.createDiv({
			cls: "dash-home-config-vazio",
			text: "O separador ocupa sempre a linha inteira.",
		});
	}

	/**
	 * O editor do quadrante de conteúdo livre.
	 *
	 * É markdown puro, renderizado pelo Obsidian — então aceita tudo que uma nota aceita. Os
	 * botões de inserir existem porque a usuária não quer decorar sintaxe: ela escolhe a nota
	 * numa lista e o `![[...]]` é escrito por nós.
	 */
	private desenharEditorMarkdown(el: HTMLElement, quadrante: Quadrante): void {
		el.createDiv({
			cls: "dash-home-config-vazio",
			text: "Aceita o mesmo que uma nota: texto, embeds, Bases, Dataview, callouts.",
		});

		const area = el.createEl("textarea", { cls: "dash-home-config-markdown" });
		area.value = quadrante.markdown ?? "";
		area.rows = 8;
		area.placeholder = "Escreva aqui, ou use os botões abaixo para inserir uma nota ou Base.";
		area.addEventListener("input", () => {
			quadrante.markdown = area.value;
			this.salvarDigitacao();
		});

		/** Insere no cursor (ou no fim), sem redesenhar — redesenhar tiraria o foco do textarea. */
		const inserir = (texto: string) => {
			const inicio = area.selectionStart ?? area.value.length;
			const fim = area.selectionEnd ?? area.value.length;
			const antes = area.value.slice(0, inicio);
			const depois = area.value.slice(fim);
			// Quebra de linha antes, se já houver conteúdo e não estivermos no início de uma linha:
			// um embed colado no fim de um parágrafo não é renderizado como bloco.
			const separador = antes.length > 0 && !antes.endsWith("\n") ? "\n" : "";
			area.value = `${antes}${separador}${texto}\n${depois}`;
			quadrante.markdown = area.value;
			const cursor = (antes + separador + texto).length + 1;
			area.setSelectionRange(cursor, cursor);
			area.focus();
			this.salvarDigitacao();
		};

		new Setting(el)
			.setName("Inserir")
			.addButton((botao) =>
				botao
					.setButtonText("Nota")
					.setTooltip("Embutir uma nota do vault")
					.onClick(() => {
						new ModalEscolherNota(this.app, (caminho) => {
							inserir(`![[${caminho.replace(/\.md$/i, "")}]]`);
						}).open();
					}),
			)
			.addButton((botao) =>
				botao
					.setButtonText("Base")
					.setTooltip("Embutir uma Base do vault")
					.onClick(() => {
						new ModalEscolherBase(this.app, (caminho) => {
							inserir(`![[${caminho}]]`);
						}).open();
					}),
			)
			.addButton((botao) =>
				botao
					.setButtonText("Título")
					.setTooltip("Inserir um título")
					.onClick(() => inserir("## Título")),
			);
	}

	/**
	 * Quantas colunas o quadrante ocupa. Só aparece quando o dashboard tem mais de uma coluna —
	 * num grid de coluna única a escolha não teria efeito nenhum.
	 */
	private desenharLargura(el: HTMLElement, dashboard: Dashboard, quadrante: Quadrante): void {
		if (dashboard.colunas <= 1) return;

		// O separador é sempre linha inteira; oferecer largura aqui seria um controle sem efeito.
		// O mapa continua sendo desenhado, porque ele ajuda a posicionar o separador entre linhas.
		if (quadrante.conteudo === "separador") {
			this.desenharMapaDeLinhas(el, dashboard, quadrante);
			return;
		}

		// ── Duas versões erradas antes desta ─────────────────────────────────────────────────
		//
		// 1. "Quantas colunas ocupa", sem feedback: obrigava a usuária a fazer a conta de cabeça,
		//    e escolher um valor que não divide a grade embaralhava as linhas silenciosamente.
		// 2. "Quantos quadrantes lado a lado": consertava a conta, mas ASSUMIA que todos os
		//    quadrantes da linha têm o mesmo tamanho. Numa grade de 6 ficava impossível montar
		//    1+3+2 — exatamente o tipo de linha que a grade de 6 existe para permitir.
		//
		// A pergunta certa é a da versão 1 (é o quadrante que decide o próprio tamanho, não a
		// linha), mas com o RESULTADO à mostra: quanto da largura isso representa e como a linha
		// está sendo montada. A usuária escolhe direto, sem calcular e sem adivinhar.
		const total = dashboard.colunas;
		const atual = quadrante.largura === "cheio" ? total : (quadrante.largura ?? 1);

		new Setting(el)
			.setName("Largura do quadrante")
			.setDesc(`Quantas das ${total} colunas da grade este quadrante ocupa.`)
			.addDropdown((drop) => {
				for (let n = 1; n <= total; n++) {
					// A fração ajuda a enxergar o tamanho sem contar colunas: "3 de 6 (metade)".
					const rotulo =
						n === total
							? `${n} de ${total} (linha inteira)`
							: `${n} de ${total}${fracaoLegivel(n, total)}`;
					drop.addOption(String(n), rotulo);
				}
				drop.setValue(String(atual));
				drop.onChange(async (valor) => {
					quadrante.largura = limitarLarguraQuadrante(Number(valor), total);
					await this.aplicar();
				});
			});

		// O mapa das linhas: mostra como os quadrantes estão se agrupando de fato, incluindo o
		// espaço que sobra. É o que transforma "por que ficou assim?" em algo visível.
		this.desenharMapaDeLinhas(el, dashboard, quadrante);
	}

	/**
	 * Desenha as linhas do dashboard como faixas proporcionais, destacando o quadrante em edição.
	 *
	 * O CSS Grid preenche buracos com o próximo item que couber, então uma linha que não fecha
	 * não fica visivelmente "pela metade": ela puxa um quadrante da linha seguinte. Sem este mapa,
	 * a usuária só descobre o resultado depois de salvar e olhar a nota — foi assim que ela
	 * encontrou o bug de "2 em cima, 3 embaixo" virando "3 em cima".
	 */
	private desenharMapaDeLinhas(el: HTMLElement, dashboard: Dashboard, emEdicao: Quadrante): void {
		const total = dashboard.colunas;
		const linhas = agruparEmLinhas(dashboard.quadrantes, total);

		const mapa = el.createDiv({ cls: "dash-home-config-mapa" });
		mapa.createDiv({ cls: "dash-home-config-mapa-titulo", text: "Como as linhas ficam:" });

		for (const linha of linhas) {
			const faixa = mapa.createDiv({ cls: "dash-home-config-mapa-linha" });
			let ocupado = 0;

			for (const item of linha) {
				ocupado += item.fatia;
				const celula = faixa.createDiv({ cls: "dash-home-config-mapa-celula" });
				celula.style.setProperty("flex-grow", String(item.fatia));
				celula.toggleClass("is-editando", item.quadrante === emEdicao);
				celula.setText(item.quadrante.titulo || "sem título");
				celula.setAttribute("title", `${item.quadrante.titulo || "sem título"} — ${item.fatia} de ${total}`);
			}

			// A sobra é informação, não erro: a última linha quase sempre está incompleta porque
			// o dashboard ainda está sendo montado.
			if (ocupado < total) {
				const sobra = faixa.createDiv({ cls: "dash-home-config-mapa-sobra" });
				sobra.style.setProperty("flex-grow", String(total - ocupado));
				sobra.setText(`vazio (${total - ocupado})`);
			}
		}
	}


	/**
	 * A cor do quadrante: swatches clicáveis em vez de dropdown.
	 *
	 * Três fontes, na ordem: as cores do tema (que acompanham claro/escuro), as paletas que ela
	 * montou no plugin Customize, e um seletor livre. A paleta só aparece se o Customize estiver
	 * instalado — ver `paleta.ts`.
	 */
	private desenharSeletorDeCor(el: HTMLElement, quadrante: Quadrante): void {
		this.seletorDeCor(el, {
			nome: "Cor",
			rotuloPadrao: "Padrão do tema",
			valor: quadrante.cor,
			definir: (v) => {
				quadrante.cor = v;
			},
		});
	}

	/** A cor SÓ deste botão. Sem ela, o botão usa a cor do quadrante — como sempre foi. */
	private desenharCorDoBotao(el: HTMLElement, botao: { estilo?: EstiloBotao }): void {
		const estilo = (botao.estilo ??= {});
		this.seletorDeCor(el, {
			nome: "Cor do botão",
			rotuloPadrao: "Herdar a cor do quadrante",
			valor: estilo.cor,
			definir: (v) => {
				estilo.cor = v;
			},
		});
	}

	/**
	 * O seletor de cor: swatches do tema, paletas do Customize e um picker livre.
	 *
	 * Genérico sobre onde a cor mora (quadrante ou botão) porque as duas telas oferecem exatamente
	 * as mesmas cores — e a usuária espera escolher a cor de um botão do mesmo jeito que escolhe a
	 * de um quadrante.
	 */
	private seletorDeCor(
		el: HTMLElement,
		opcoes: {
			nome: string;
			/** O que o swatch "sem cor" significa nesta tela — no botão é "herdar do quadrante". */
			rotuloPadrao: string;
			valor: string | undefined;
			definir: (v: string | undefined) => void;
		},
	): void {
		const setting = new Setting(el).setName(opcoes.nome).setClass("dash-home-config-cores");

		const faixa = setting.controlEl.createDiv({ cls: "dash-home-swatches" });

		const swatch = (faixaEl: HTMLElement, valor: string | undefined, rotulo: string, css: string) => {
			const b = faixaEl.createEl("button", { cls: "dash-home-swatch" });
			b.setAttribute("aria-label", rotulo);
			b.setAttribute("title", rotulo);
			b.style.setProperty("--swatch", css);
			b.toggleClass("is-ativo", (opcoes.valor ?? "").toLowerCase() === (valor ?? "").toLowerCase());
			b.addEventListener("click", async () => {
				opcoes.definir(valor);
				await this.aplicar();
			});
		};

		swatch(faixa, undefined, opcoes.rotuloPadrao, "var(--interactive-accent)");
		for (const nome of Object.keys(CORES)) {
			swatch(faixa, nome, nome.charAt(0).toUpperCase() + nome.slice(1), CORES[nome]);
		}

		// Cor livre: o input nativo é o caminho mais direto e já traz o seletor do sistema.
		setting.addColorPicker((picker) => {
			picker.setValue(ehHex(opcoes.valor) ? (opcoes.valor as string) : "#4263eb");
			picker.onChange(async (valor) => {
				opcoes.definir(valor);
				// Sem redesenhar durante o arrasto do seletor: fecharia o próprio picker.
				this.salvarDigitacao();
			});
		});

		// As paletas do Customize, se houver. Carregadas uma vez e guardadas — ver `atualizar()`.
		for (const paleta of this.paletas) {
			const linha = new Setting(el).setName(paleta.nome).setClass("dash-home-config-cores");
			linha.nameEl.addClass("dash-home-config-paleta-nome");
			const faixaPaleta = linha.controlEl.createDiv({ cls: "dash-home-swatches" });
			for (const hex of paleta.cores) {
				swatch(faixaPaleta, hex, hex, hex);
			}
		}
	}

	/**
	 * A aparência do quadrante. Cada controle mexe só no estilo DESTE quadrante; o que ele não
	 * define herda do estilo global (seção "Aparência", mais abaixo no painel).
	 *
	 * ── Por que os controles ficam escondidos atrás de "Herdar / Personalizar" ───────────────
	 *
	 * Pedido dela, e a razão é boa: um quadrante que herda mostrava OITO controles dizendo
	 * "Herdando do global", nenhum dos quais fazia nada até ser mexido. A informação certa era
	 * "este quadrante segue o global" — uma linha, não oito.
	 *
	 * A escolha é uma CHAVE separada dos valores (`personalizaEstilo`), e não a ausência deles:
	 * assim voltar para "herdar" preserva os ajustes, e personalizar de novo os devolve. Perder
	 * uma configuração inteira por um clique foi o erro da sessão 13, em outra roupa.
	 */
	private desenharEstilo(el: HTMLElement, quadrante: Quadrante): void {
		const personaliza = quadrante.personalizaEstilo === true;

		new Setting(el)
			.setName("Aparência do quadrante")
			.setDesc(
				personaliza
					? "Este quadrante tem aparência própria e ignora a configuração global."
					: "Este quadrante segue a aparência global (seção “Aparência”, no fim do painel).",
			)
			.addDropdown((drop) => {
				drop.addOption("herdar", "Herdar do global");
				drop.addOption("personalizar", "Personalizar");
				drop.setValue(personaliza ? "personalizar" : "herdar");
				drop.onChange(async (valor) => {
					const querPersonalizar = valor === "personalizar";
					// `undefined` e não `false` ao herdar: é o estado neutro do modelo, e mantém o
					// data.json limpo de chaves que só dizem "o padrão".
					quadrante.personalizaEstilo = querPersonalizar ? true : undefined;

					// Ao personalizar pela primeira vez, os controles nascem com os valores que o
					// quadrante JÁ herdava — escolha dela. Assim nada muda de aparência no clique:
					// ela ajusta só o que quer diferente, em vez de reconstruir tudo do zero.
					if (querPersonalizar && !this.temEstiloProprio(quadrante.estilo)) {
						quadrante.estilo = { ...resolverEstilo(this.plugin.dados.estiloGlobal, {}) };
					}
					await this.aplicar();
				});
			});

		// Herdando: nada mais a mostrar. Os ajustes dela (se houver) continuam guardados em
		// `quadrante.estilo`, adormecidos — `estiloAtivo()` é quem os mantém fora do render.
		if (!personaliza) return;

		const estilo = (quadrante.estilo ??= {});
		// O que vale quando este quadrante NÃO define nada — é o valor que os controles mostram
		// como "herdando". Resolver com o estilo do quadrante junto mostraria o valor próprio,
		// que é justamente o que a palavra "herdando" nega.
		const efetivo = resolverEstilo(this.plugin.dados.estiloGlobal, {});

		const nomeBarra: Record<string, string> = {
			topo: "No topo",
			esquerda: "À esquerda",
			direita: "À direita",
			baixo: "Embaixo",
			volta: "Em volta (borda inteira)",
			nenhuma: "Sem barra",
		};

		new Setting(el)
			.setName("Barra colorida")
			.setDesc(
				estilo.posicaoBarra === undefined
					? `Herdando do global (${nomeBarra[efetivo.posicaoBarra] ?? efetivo.posicaoBarra}).`
					: "Este quadrante tem barra própria e ignora a configuração global.",
			)
			.addDropdown((drop) => {
				drop.addOption("", `Herdar do global (${nomeBarra[efetivo.posicaoBarra] ?? ""})`);
				for (const [chave, rotulo] of Object.entries(nomeBarra)) {
					drop.addOption(chave, rotulo);
				}
				drop.setValue(estilo.posicaoBarra ?? "");
				drop.onChange(async (valor) => {
					estilo.posicaoBarra = (valor || undefined) as PosicaoBarra | undefined;
					await this.aplicar();
				});
			});

		this.controleNumero(el, "Espessura da barra", efetivo.espessuraBarra, 1, 12, estilo.espessuraBarra, (v) => {
			estilo.espessuraBarra = v;
		});

		this.controleNumero(el, "Arredondamento", efetivo.radius, 0, 28, estilo.radius, (v) => {
			estilo.radius = v;
		});

		this.controleNumero(el, "Espaçamento interno", efetivo.padding, 4, 32, estilo.padding, (v) => {
			estilo.padding = v;
		});

		this.controleNumero(el, "Tamanho do ícone", efetivo.tamanhoIcone, 10, 32, estilo.tamanhoIcone, (v) => {
			estilo.tamanhoIcone = v;
		});

		new Setting(el)
			.setName("Fundo colorido")
			.setDesc("Tinge o fundo do card com a cor escolhida.")
			.addSlider((slider) =>
				slider
					.setLimits(0, 40, 5)
					.setValue(Math.round((estilo.intensidadeFundo ?? efetivo.intensidadeFundo) * 100))
					.setDynamicTooltip()
					.onChange((valor) => {
						estilo.intensidadeFundo = valor / 100;
						this.salvarDigitacao();
					}),
			);

		new Setting(el).setName("Título na cor do quadrante").addToggle((toggle) =>
			toggle.setValue(estilo.tituloColorido ?? efetivo.tituloColorido).onChange(async (valor) => {
				estilo.tituloColorido = valor;
				await this.aplicar();
			}),
		);

		// Dois caminhos de volta, de propósito, porque são coisas diferentes:
		//
		// - "Voltar a herdar" é reversível: os ajustes ficam guardados e voltam se ela personalizar
		//   de novo. É o mesmo que o dropdown lá em cima, repetido aqui porque depois de oito
		//   controles o topo da seção já saiu da tela.
		// - "Limpar os ajustes" é o descarte de verdade, para quem quer recomeçar do global.
		new Setting(el)
			.addButton((botao) =>
				botao
					.setButtonText("Voltar a herdar")
					.setTooltip("Segue o global de novo; os ajustes ficam guardados")
					.onClick(async () => {
						quadrante.personalizaEstilo = undefined;
						await this.aplicar();
					}),
			)
			.addButton((botao) =>
				botao
					.setButtonText("Limpar os ajustes")
					.setTooltip("Descarta a aparência própria deste quadrante e volta ao global")
					.setWarning()
					.onClick(async () => {
						quadrante.estilo = {};
						quadrante.personalizaEstilo = undefined;
						new Notice("Aparência do quadrante limpa. Ele voltou a seguir o global.");
						await this.aplicar();
					}),
			);
	}

	/**
	 * Se um estilo tem algum campo definido de fato.
	 *
	 * `{}` não conta: o painel cria o objeto vazio só de desenhar a seção, e tratá-lo como
	 * "personalizado" faria o primeiro clique em Personalizar não pré-preencher nada.
	 * `!== undefined` e não truthiness, pelo motivo de sempre (`radius: 0` é escolha válida).
	 */
	private temEstiloProprio(estilo: object | undefined): boolean {
		if (!estilo) return false;
		return Object.values(estilo).some((v) => v !== undefined);
	}

	/**
	 * Um slider que pode estar "não definido" (herdando). O botão ao lado devolve ao herdado —
	 * sem ele, mexer no slider uma vez prenderia o campo para sempre.
	 */
	private controleNumero(
		el: HTMLElement,
		nome: string,
		herdado: number,
		min: number,
		max: number,
		valor: number | undefined,
		definir: (v: number | undefined) => void,
	): void {
		const setting = new Setting(el)
			.setName(nome)
			.setDesc(valor === undefined ? `Herdando do global (${herdado}px)` : `${valor}px`);

		setting.addSlider((slider) =>
			slider
				.setLimits(min, max, 1)
				// Sem valor próprio, o slider começa no herdado — mexer nele parte do que está
				// na tela, em vez de saltar para o mínimo.
				.setValue(valor ?? herdado)
				.setDynamicTooltip()
				.onChange((v) => {
					definir(v);
					// Sem `aplicar()`: redesenhar destruiria este slider no meio do arrasto. A
					// descrição ("Herdando do global") e o botão de desfazer só aparecem no próximo
					// desenho do painel — é um custo aceitável perto de o controle não funcionar.
					setting.setDesc(`${v}px`);
					this.salvarDigitacao();
				}),
		);

		if (valor !== undefined) {
			setting.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Voltar ao herdado")
					.onClick(async () => {
						definir(undefined);
						await this.aplicar();
					}),
			);
		}
	}

	/**
	 * Os controles de aparência dos botões, usados nas TRÊS camadas da herança: global (Aparência),
	 * quadrante (Cor e aparência) e botão individual.
	 *
	 * Um método só para as três porque os controles são os mesmos — o que muda é de onde o valor
	 * vem e para onde ele vai. Duplicar isto em três lugares faria um controle novo nascer faltando
	 * em dois deles.
	 *
	 * ⚠️ A lição da sessão 11 está em `alvo` + `quemDefine`: cada controle diz de qual camada o
	 * valor efetivo está vindo, e oferece o botão de voltar ao herdado quando esta camada é quem
	 * está mandando. Sem isso a usuária mexe no global, uma camada acima ignora, e parece bug.
	 */
	private desenharEstiloBotao(el: HTMLElement, ctx: ContextoEstiloBotao): void {
		const { alvo, camada } = ctx;
		// O valor que vale quando ESTA camada não define nada — o que os controles mostram como
		// "herdado". Resolver incluindo a própria camada mostraria o valor próprio, que é
		// justamente o que a palavra "herdando" nega.
		const herdado = resolverEstiloBotao(
			camada === "global" ? undefined : ctx.global,
			camada === "quadrante" ? undefined : ctx.doQuadrante,
			undefined,
		);

		/** De onde vem o valor efetivo deste campo, considerando todas as camadas. */
		const origem = (campo: keyof EstiloBotao): Camada =>
			quemDefine(campo, ctx.global, ctx.doQuadrante, ctx.doBotao);

		/**
		 * O rótulo da opção "sem escolha". Na global não há de quem herdar — ali "não escolher"
		 * significa usar o padrão do plugin, e chamar isso de "herdar" seria mentira.
		 */
		const semEscolha = (rotulo: string): string =>
			camada === "global" ? `Padrão (${rotulo})` : `Herdar (${rotulo})`;

		/**
		 * A descrição de um controle: diz quando o valor é herdado, e — o caso que importa —
		 * quando uma camada ACIMA desta está sobrescrevendo, tornando este controle inócuo.
		 */
		const descrever = (campo: keyof EstiloBotao, rotuloHerdado: string): string => {
			const quem = origem(campo);
			if (alvo[campo] !== undefined) return "Definido aqui.";
			const base = camada === "global" ? `Padrão: ${rotuloHerdado}.` : `Herdando: ${rotuloHerdado}.`;
			if (quem === "padrao" || quem === camada) return base;
			return `${base} ${AVISO_SOBRESCRITA[quem] ?? ""}`.trim();
		};

		// ── Arranjo: só nas camadas que mandam numa LISTA de botões ──────────────────────────
		// Quantos botões cabem por linha é propriedade do conjunto: um botão sozinho não decide o
		// arranjo da lista em que está. Por isso o controle não aparece na camada do botão.
		if (camada !== "botao") {
			const arranjoHerdado = ctx.doQuadrante?.arranjo ?? ctx.global?.arranjo ?? "coluna";
			this.escolha<ArranjoBotoes>(el, {
				nome: "Disposição",
				descricao:
					alvo.arranjo !== undefined
						? "Definido aqui."
						: camada === "global"
							? `Padrão: ${NOME_ARRANJO[arranjoHerdado]}.`
							: `Herdando: ${NOME_ARRANJO[arranjoHerdado]}.`,
				opcoes: NOME_ARRANJO,
				rotuloHerdar: semEscolha(NOME_ARRANJO[arranjoHerdado]),
				valor: alvo.arranjo,
				definir: (v) => {
					alvo.arranjo = v;
				},
			});
		}

		this.escolha<FormaBotao>(el, {
			nome: "Formato",
			descricao: descrever("forma", NOME_FORMA[herdado.forma]),
			opcoes: NOME_FORMA,
			rotuloHerdar: semEscolha(NOME_FORMA[herdado.forma]),
			valor: alvo.forma,
			definir: (v) => {
				alvo.forma = v;
			},
		});

		this.escolha<PinturaBotao>(el, {
			nome: "Cor do botão",
			descricao: descrever("pintura", NOME_PINTURA[herdado.pintura]),
			opcoes: NOME_PINTURA,
			rotuloHerdar: semEscolha(NOME_PINTURA[herdado.pintura]),
			valor: alvo.pintura,
			definir: (v) => {
				alvo.pintura = v;
			},
		});

		this.escolha<CorLetraBotao>(el, {
			nome: "Cor da letra",
			descricao: descrever("corLetra", NOME_COR_LETRA[herdado.corLetra]),
			opcoes: NOME_COR_LETRA,
			rotuloHerdar: semEscolha(NOME_COR_LETRA[herdado.corLetra]),
			valor: alvo.corLetra,
			definir: (v) => {
				alvo.corLetra = v;
			},
		});

		this.escolha<AlinhamentoBotao>(el, {
			nome: "Alinhamento",
			descricao: descrever("alinhamento", NOME_ALINHAMENTO[herdado.alinhamento]),
			opcoes: NOME_ALINHAMENTO,
			rotuloHerdar: semEscolha(NOME_ALINHAMENTO[herdado.alinhamento]),
			valor: alvo.alinhamento,
			definir: (v) => {
				alvo.alinhamento = v;
			},
		});

		// O arredondamento não faz efeito em pílula (raio máximo por definição): mostrar o slider
		// ali seria oferecer um controle que não faz nada.
		if (herdado.forma !== "pilula" || alvo.forma !== undefined) {
			const forma = alvo.forma ?? herdado.forma;
			if (forma !== "pilula") {
				this.sliderCamada(el, ctx, "radius", "Arredondamento", herdado.radius);
			}
		}

		this.sliderCamada(el, ctx, "altura", "Altura do botão", herdado.altura);
		this.sliderCamada(el, ctx, "tamanhoIcone", "Tamanho do ícone", herdado.tamanhoIcone);
		this.sliderTamanhoFonte(el, ctx, herdado.tamanhoFonte);

		this.alternar(el, {
			nome: "Só o ícone",
			descricao: descrever("soIcone", herdado.soIcone ? "sim" : "não"),
			valor: alvo.soIcone ?? herdado.soIcone,
			definido: alvo.soIcone !== undefined,
			definir: (v) => {
				alvo.soIcone = v;
			},
		});

		this.alternar(el, {
			nome: "Destaque",
			descricao: descrever("destaque", herdado.destaque ? "sim" : "não"),
			valor: alvo.destaque ?? herdado.destaque,
			definido: alvo.destaque !== undefined,
			definir: (v) => {
				alvo.destaque = v;
			},
		});
	}

	/**
	 * O tamanho da letra. Tem método próprio porque é o único slider cujo valor herdado pode não
	 * existir: sem escolha em nenhuma camada, a letra vem do dropdown "Tamanho dos botões"
	 * (pequeno/médio/grande), que é CSS e não tem px para mostrar aqui.
	 *
	 * Nesse caso o slider começa em 14 (o tamanho de interface do Obsidian) só como ponto de
	 * partida do arrasto — e o botão de desfazer devolve ao "automático".
	 */
	private sliderTamanhoFonte(el: HTMLElement, ctx: ContextoEstiloBotao, herdado: number | undefined): void {
		const faixa = FAIXAS.tamanhoFonte;
		const proprio = ctx.alvo.tamanhoFonte;
		const rotuloHerdado = herdado === undefined ? "o tamanho dos botões" : `${herdado}px`;

		const setting = new Setting(el)
			.setName("Tamanho da letra")
			.setDesc(proprio === undefined ? `Automático: segue ${rotuloHerdado}.` : `${proprio}px`);

		setting.addSlider((slider) =>
			slider
				.setLimits(faixa.min, faixa.max, 1)
				.setValue(proprio ?? herdado ?? 14)
				.setDynamicTooltip()
				.onChange((v) => {
					ctx.alvo.tamanhoFonte = v;
					// Sem `aplicar()`: redesenhar destruiria este slider no meio do arrasto (a
					// armadilha 1 do doc — já mordeu três vezes neste plugin).
					setting.setDesc(`${v}px`);
					this.salvarDigitacao();
				}),
		);

		if (proprio !== undefined) {
			setting.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Voltar ao automático")
					.onClick(async () => {
						ctx.alvo.tamanhoFonte = undefined;
						await this.aplicar();
					}),
			);
		}
	}

	/** Um slider de estilo de botão que respeita a herança da camada. */
	private sliderCamada(
		el: HTMLElement,
		ctx: ContextoEstiloBotao,
		campo: "radius" | "altura" | "tamanhoIcone",
		nome: string,
		herdado: number,
	): void {
		const faixa = FAIXAS[campo];
		this.controleNumero(el, nome, herdado, faixa.min, faixa.max, ctx.alvo[campo], (v) => {
			ctx.alvo[campo] = v;
		});
	}

	/**
	 * Um dropdown de estilo. A opção "" significa herdar — por isso o valor vazio vira `undefined`
	 * no modelo, e não uma string vazia (que seria um valor próprio inválido).
	 */
	private escolha<T extends string>(
		el: HTMLElement,
		opcoes: {
			nome: string;
			descricao: string;
			opcoes: Record<string, string>;
			rotuloHerdar: string;
			valor: T | undefined;
			definir: (v: T | undefined) => void;
		},
	): void {
		new Setting(el)
			.setName(opcoes.nome)
			.setDesc(opcoes.descricao)
			.addDropdown((drop) => {
				// A opção de "não escolher" existe em TODAS as camadas, inclusive na global — lá
				// ela devolve ao padrão de fábrica. Sem isso não havia caminho de volta: escolher
				// um formato uma vez o prendia para sempre (bug relatado na s13).
				drop.addOption("", opcoes.rotuloHerdar);
				for (const [chave, rotulo] of Object.entries(opcoes.opcoes)) drop.addOption(chave, rotulo);
				drop.setValue(opcoes.valor ?? "");
				// Dropdown pode usar `aplicar()`: é um clique único, não um arrasto — não há
				// controle sendo manipulado quando o redesenho acontece (ver armadilha 1 do doc).
				drop.onChange(async (valor) => {
					opcoes.definir((valor || undefined) as T | undefined);
					await this.aplicar();
				});
			});
	}

	/**
	 * Um toggle de estilo, com o botão de voltar ao herdado quando esta camada define o valor.
	 *
	 * O botão de desfazer aparece em TODAS as camadas (na global ele volta ao padrão de fábrica).
	 * Sem isso, desligar um toggle cujo herdado já era `false` gravava um `false` explícito que
	 * não se distingue do herdado — e, como o desfazer não aparecia, o estado ficava preso (s13).
	 */
	private alternar(
		el: HTMLElement,
		opcoes: {
			nome: string;
			descricao: string;
			valor: boolean;
			definido: boolean;
			definir: (v: boolean | undefined) => void;
		},
	): void {
		const setting = new Setting(el)
			.setName(opcoes.nome)
			.setDesc(opcoes.descricao)
			.addToggle((toggle) =>
				toggle.setValue(opcoes.valor).onChange(async (valor) => {
					opcoes.definir(valor);
					await this.aplicar();
				}),
			);

		if (opcoes.definido) {
			setting.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Voltar ao herdado")
					.onClick(async () => {
						opcoes.definir(undefined);
						await this.aplicar();
					}),
			);
		}
	}

	private desenharBotao(el: HTMLElement, quadrante: Quadrante, botao: Botao, indice: number): void {
		const linha = el.createDiv({ cls: "dash-home-config-botao" });

		const salvos = this.plugin.dados.botoesSalvos ?? [];
		// O molde, quando este botão é vinculado. `find` e não `botaoResolvido` porque aqui importa
		// distinguir "vinculado a um molde que existe" de "vínculo quebrado": o primeiro é editado na
		// biblioteca, o segundo virou um botão comum na prática.
		const molde = botao.salvoId ? salvos.find((s) => s.id === botao.salvoId) : undefined;

		const topo = new Setting(linha).setClass("dash-home-config-botao-topo");

		if (molde) {
			// Vinculado: nome e ícone são do MOLDE, e por isso não se editam aqui. Um campo de texto
			// nesta linha aceitaria a digitação e a perderia no próximo redesenho — o conteúdo real
			// vem da biblioteca (ver `botaoResolvido`). Melhor não oferecer do que oferecer e ignorar.
			linha.addClass("dash-home-config-botao-vinculado");

			const rotulo = topo.nameEl.createDiv({ cls: "dash-home-config-vinculo" });
			if (molde.icone) setIcon(rotulo.createSpan({ cls: "dash-home-config-vinculo-icone" }), molde.icone);
			rotulo.createSpan({ cls: "dash-home-config-vinculo-nome", text: molde.texto || "Sem nome" });
			topo.setDesc(`Botão salvo · ${descreverAcao(molde)}`);

			topo.addButton((b) =>
				b
					.setButtonText("Editar")
					.setTooltip("Abre este botão na tela “Botões” — a alteração vale em todos os cards que o usam")
					.onClick(() => {
						// Leva para a tela onde ele se edita, já com a seção aberta. Sem isso ela
						// teria que trocar de aba e procurar o botão na lista.
						this.tela = "botoes";
						abrirAcordeao("secao:biblioteca");
						abrirAcordeao(`${molde.id}:salvo`);
						this.atualizar(true);
					}),
			);
			topo.addButton((b) =>
				b
					.setButtonText("Trocar")
					.setTooltip("Usar outro botão salvo no lugar deste")
					.onClick(() => {
						new ModalEscolherBotaoSalvo(
							this.app,
							salvos,
							async (novo) => {
								// Troca o vínculo no lugar, preservando a POSIÇÃO do botão na lista —
								// remover e adicionar o jogaria para o fim do card.
								trocarBotaoSalvo(botao, novo);
								await this.aplicar();
							},
							this.plugin.dados.gruposBotoes,
						).open();
					}),
			);
		} else {
			// Sem molde: um botão de antes da biblioteca cujo vínculo não resolve (molde excluído
			// por fora, ou data.json editado à mão). A migração da carga cobre o caso normal, então
			// aqui só resta oferecer a saída — trocar por um salvo — em vez de um editor que não
			// existe mais.
			linha.addClass("dash-home-config-botao-vinculado");
			const rotulo = topo.nameEl.createDiv({ cls: "dash-home-config-vinculo" });
			if (botao.icone) setIcon(rotulo.createSpan({ cls: "dash-home-config-vinculo-icone" }), botao.icone);
			rotulo.createSpan({ cls: "dash-home-config-vinculo-nome", text: botao.texto || "Sem nome" });
			topo.setDesc("Este botão não está na sua lista de botões salvos. Continua funcionando; escolha um salvo para trocá-lo.");

			topo.addButton((b) =>
				b
					.setButtonText("Trocar por um salvo")
					.setCta()
					.onClick(() => {
						new ModalEscolherBotaoSalvo(
							this.app,
							salvos,
							async (novo) => {
								trocarBotaoSalvo(botao, novo);
								await this.aplicar();
							},
							this.plugin.dados.gruposBotoes,
						).open();
					}),
			);
		}

		topo.addExtraButton((b) =>
			b
				.setIcon("chevron-up")
				.setTooltip("Subir")
				.setDisabled(indice === 0)
				.onClick(async () => {
					mover(quadrante.botoes, indice, -1);
					await this.aplicar();
				}),
		);
		topo.addExtraButton((b) =>
			b
				.setIcon("chevron-down")
				.setTooltip("Descer")
				.setDisabled(indice === quadrante.botoes.length - 1)
				.onClick(async () => {
					mover(quadrante.botoes, indice, 1);
					await this.aplicar();
				}),
		);
		topo.addExtraButton((b) =>
			b
				.setIcon("copy")
				.setTooltip("Duplicar botão")
				.onClick(async () => {
					// Sem abrir acordeão: a aparência do botão saiu daqui para a tela "Botões", e a
					// cópia não tem mais seção própria para expandir.
					duplicarBotao(quadrante, indice);
					await this.aplicar();
				}),
		);
		topo.addExtraButton((b) =>
			b
				.setIcon("trash-2")
				.setTooltip("Excluir botão")
				.onClick(async () => {
					quadrante.botoes.splice(indice, 1);
					await this.aplicar();
				}),
		);

		// E acabou: a linha do botão no quadrante é só ISTO — qual botão é, e onde ele fica no card.
		// Nome, ícone, ação, propriedades e aparência moram todos na tela "Botões" (decisão dela,
		// s28). Um editor aqui mexeria num objeto que nem é lido na hora de desenhar, porque quem
		// desenha resolve o vínculo e lê o molde.
		//
		// Mover, duplicar e excluir ficam acima de propósito: são operações do CARD (a posição do
		// botão nesta lista), não do conteúdo do botão.
	}

	/**
	 * A linha do "o que o botão faz" — tipo da ação e destino.
	 *
	 * Recebe `Configuravel` (e não `Botao`) porque o mesmo editor serve ao botão do quadrante e ao
	 * molde da biblioteca: são a mesma configuração, e dois editores paralelos divergiriam na
	 * primeira opção nova. Vale igual para `desenharPropriedades` e `desenharCriarNota`.
	 */
	private desenharDestino(linha: HTMLElement, botao: Configuravel): void {
		const destino = new Setting(linha).setClass("dash-home-config-botao-destino");
		destino.addDropdown((drop) => {
			drop.addOption("nota", "Abrir nota");
			drop.addOption("pasta", "Abrir pasta");
			drop.addOption("busca", "Buscar");
			drop.addOption("comando", "Rodar comando");
			drop.addOption("criar", "Criar nota de um template");
			// "campo" NÃO é oferecido: virou a operação "digitar" dentro de "propriedade" (s23).
			// O valor antigo ainda existe no tipo para a carga poder migrá-lo.
			drop.addOption("propriedade", "Alterar propriedades");
			drop.setValue(botao.tipo === "campo" ? "propriedade" : botao.tipo);
			drop.onChange(async (valor) => {
				// O destino antigo não faz sentido no tipo novo (um caminho de nota não é uma query
				// de busca), então limpamos — melhor um campo vazio do que um destino que falha.
				botao.tipo = valor as TipoAcao;
				botao.destino = "";
				// As propriedades NÃO são apagadas ao sair do tipo: trocar para "Abrir nota" e voltar
				// devolve o que ela tinha montado, do mesmo jeito que trocar o conteúdo do quadrante
				// não apaga os botões. O que não é do tipo atual apenas não é usado.
				await this.aplicar();
			});
		});

		if (botao.tipo === "propriedade") {
			// O alvo é sempre a nota aberta, então não há destino a escolher — só a lista de
			// mudanças, que vai logo abaixo em `desenharPropriedades`.
			destino.setDesc("Altera a nota que estiver aberta no momento do clique.");
			return;
		}

		if (botao.tipo === "criar") {
			// O template e a pasta ficam logo abaixo, em `desenharCriarNota` — não há um destino
			// único a escolher aqui.
			destino.setDesc("Cria uma nota nova e a abre. O nome é pedido no clique.");
			return;
		}


		if (botao.tipo === "busca") {
			// Busca é o único tipo cujo destino é texto livre: não há lista de queries para escolher.
			destino.addText((texto) =>
				texto
					.setPlaceholder("tag:#cliente")
					.setValue(botao.destino)
					.onChange((valor) => {
						botao.destino = valor;
						this.salvarDigitacao();
					}),
			);
			return;
		}

		destino.addButton((b) => {
			b.setButtonText(botao.destino || "Escolher…");
			b.setTooltip(botao.destino || "Escolher destino");
			b.onClick(() => this.escolherDestino(botao));
		});
	}

	private escolherDestino(botao: Configuravel): void {
		const salvar = async (valor: string) => {
			botao.destino = valor;
			await this.aplicar();
		};

		if (botao.tipo === "nota") {
			new ModalEscolherNota(this.app, salvar).open();
			return;
		}
		if (botao.tipo === "pasta") {
			new ModalEscolherPasta(this.app, salvar).open();
			return;
		}
		if (botao.tipo === "comando") {
			new ModalEscolherComando(this.app, async (id, nome) => {
				// Se o botão ainda está com o nome padrão, adota o nome do comando — poupa a usuária
				// de digitar duas vezes a mesma coisa.
				if (!botao.texto || botao.texto === "Novo botão") botao.texto = nome;
				await salvar(id);
			}).open();
		}
	}

	/**
	 * O botão que cria uma nota: de qual template, em qual pasta, com que nome sugerido.
	 *
	 * Template e pasta são escolhidos por SELETOR, nunca digitados — é a regra do plugin desde a
	 * s3 (acertar uma string de caminho à mão é exatamente o que ele evita). O nome sugerido, esse
	 * sim, é texto livre, porque não existe lista de nomes futuros para escolher.
	 */
	private desenharCriarNota(el: HTMLElement, botao: Configuravel): void {
		const cfg = (botao.criar ??= { template: "", pasta: "" });

		new Setting(el)
			.setName("Template")
			.setDesc(cfg.template || "Nenhum — a nota nasce em branco.")
			.addButton((b) => {
				b.setButtonText(cfg.template ? "Trocar" : "Escolher…");
				b.setTooltip("Escolher a nota que serve de template");
				b.onClick(() => {
					new ModalEscolherNota(this.app, async (caminho) => {
						cfg.template = caminho;
						await this.aplicar();
					}).open();
				});
			})
			.addExtraButton((b) =>
				b
					.setIcon("x")
					.setTooltip("Sem template (nota em branco)")
					.setDisabled(!cfg.template)
					.onClick(async () => {
						cfg.template = "";
						await this.aplicar();
					}),
			);

		new Setting(el)
			.setName("Salvar em")
			.setDesc(cfg.pasta || "Raiz do vault.")
			.addButton((b) => {
				b.setButtonText(cfg.pasta ? "Trocar" : "Escolher…");
				b.setTooltip("Escolher a pasta de destino");
				b.onClick(() => {
					new ModalEscolherPasta(this.app, async (caminho) => {
						cfg.pasta = caminho;
						await this.aplicar();
					}).open();
				});
			})
			.addExtraButton((b) =>
				b
					.setIcon("x")
					.setTooltip("Salvar na raiz do vault")
					.setDisabled(!cfg.pasta)
					.onClick(async () => {
						cfg.pasta = "";
						await this.aplicar();
					}),
			);

		new Setting(el)
			.setName("Nome sugerido")
			.setDesc("Aparece já preenchido na caixinha do clique. Aceita {{date}} e {{time}}.")
			.addText((texto) =>
				texto
					.setPlaceholder("Ex.: Reunião {{date}}")
					.setValue(cfg.nomeSugerido ?? "")
					.onChange((valor) => {
						cfg.nomeSugerido = valor;
						this.salvarDigitacao();
					}),
			);

		// O Templater é opcional, mas muda o que o template faz — e é melhor ela saber disto ao
		// montar do que descobrir no primeiro clique.
		const temTemplater = !!(this.app as unknown as {
			plugins?: { plugins?: Record<string, unknown> };
		}).plugins?.plugins?.["templater-obsidian"];

		el.createDiv({
			cls: "dash-home-config-vazio",
			text: temTemplater
				? "O Templater está ativo: a sintaxe dele (<% tp… %>) é processada na nota nova."
				: "O Templater não está ativo — o template é copiado como está, sem processar sintaxe.",
		});
	}

	/** A dica da caixa vazia, e o aviso do que o formato escolhido grava. */
	private desenharDicaDoCampo(el: HTMLElement, mudanca: MudancaPropriedade): void {
		new Setting(el)
			.setName("Dica dentro da caixa")
			.setDesc("Opcional. O texto cinza que aparece enquanto a caixa está vazia.")
			.addText((texto) =>
				texto
					.setPlaceholder("Ex.: dias antes")
					.setValue(mudanca.dica ?? "")
					.onChange((valor) => {
						mudanca.dica = valor;
						this.salvarDigitacao();
					}),
			);

		const formato = mudanca.formato ?? "texto";
		el.createDiv({
			cls: "dash-home-config-vazio",
			text:
				formato === "numero"
					? "Grava como número — uma Base que filtra por número acha a nota. Apagar a caixa remove a propriedade."
					: formato === "data"
						? "Grava como data (AAAA-MM-DD). Apagar a caixa remove a propriedade."
						: "Grava como texto. Apagar a caixa remove a propriedade da nota.",
		});
	}

	/**
	 * As propriedades que o botão altera na nota aberta.
	 *
	 * É uma LISTA porque uma mudança de estado costuma mexer em mais de um campo de uma vez
	 * ("arquivar" = `status: arquivado` + `arquivado: true`). Com um botão por propriedade, ela
	 * teria que clicar dois — e esquecer o segundo deixaria a nota num estado pela metade.
	 */
	private desenharPropriedades(el: HTMLElement, botao: Configuravel): void {
		const mudancas = botao.propriedades ?? [];

		const cabecalho = new Setting(el)
			.setName("Propriedades alteradas")
			.setDesc(
				mudancas.length === 0
					? "Nenhuma ainda. Um clique no botão vai gravar estas propriedades na nota aberta."
					: `${mudancas.length === 1 ? "1 propriedade alterada" : `${mudancas.length} propriedades alteradas`} a cada clique.`,
			);

		cabecalho.addButton((b) =>
			b
				.setButtonText("Adicionar propriedade")
				.setCta()
				.onClick(async () => {
					criarMudancaPropriedade(botao);
					await this.aplicar();
				}),
		);

		if (mudancas.length === 0) {
			el.createDiv({
				cls: "dash-home-config-vazio",
				text: "Sem propriedade configurada, o botão avisa e não altera nada.",
			});
			return;
		}

		mudancas.forEach((mudanca, indice) => {
			const caixa = el.createDiv({ cls: "dash-home-config-propriedade" });

			// Linha 1: qual propriedade, e o que fazer com ela.
			const alvo = new Setting(caixa).setClass("dash-home-config-propriedade-alvo");

			alvo.addButton((b) => {
				b.setButtonText(mudanca.nome || "Escolher propriedade…");
				b.setTooltip(mudanca.nome || "Escolher a propriedade da nota");
				b.onClick(() => {
					new ModalEscolherPropriedade(this.app, async (nome) => {
						mudanca.nome = nome;
						await this.aplicar();
					}).open();
				});
			});

			alvo.addDropdown((drop) => {
				drop.addOption("definir", "Definir como");
				drop.addOption("alternar", "Alternar entre");
				drop.addOption("escolher", "Escolher de uma lista");
				drop.addOption("digitar", "Digitar (caixa no card)");
				drop.addOption("interruptor", "Interruptor (sim/não)");
				drop.setValue(mudanca.operacao);
				drop.onChange(async (valor) => {
					const nova = valor as OperacaoPropriedade;

					// As operações de CONTROLE não convivem com as de clique no mesmo botão: um
					// botão que virou caixa de digitação não tem clique sobrando para gravar um
					// "definir". Recusar é mais honesto que aceitar e ignorar em silêncio — ela
					// veria a propriedade listada e concluiria que é gravada.
					const outras = mudancas.filter((m) => m !== mudanca);
					const conflito = ehControle(nova)
						? outras.length > 0
						: outras.some((m) => ehControle(m.operacao));

					if (conflito) {
						new Notice(
							ehControle(nova)
								? "“Digitar” e “Interruptor” viram o próprio botão, então precisam estar sozinhos. Crie outro botão para esta propriedade."
								: "Este botão é um controle (digitar/interruptor) e não tem clique. Crie outro botão para esta propriedade.",
						);
						// Redesenha para o dropdown voltar ao valor real — sem isto ele continua
						// mostrando a opção recusada.
						this.atualizar();
						return;
					}

					mudanca.operacao = nova;
					// Sair do alternar descarta o segundo valor: mantê-lo escondido faria ele
					// reaparecer sozinho se ela voltasse a alternar depois.
					if (mudanca.operacao !== "alternar") delete mudanca.valor2;
					// `opcoes`, `formato` e `dica` NÃO são descartados ao trocar de operação: montar
					// uma lista de seis valores (ou configurar a caixa) é trabalho, e apagá-lo
					// porque ela espiou outra operação seria perdê-lo.
					await this.aplicar();
				});
			});

			// O dropdown de tipo muda de significado conforme a operação:
			//
			// - "digitar": é o FORMATO da caixa, e só os três que se digitam. Booleano e vazio não
			//   fazem sentido numa caixa de texto — quem quer sim/não usa o interruptor.
			// - "interruptor": não há escolha nenhuma; o valor é sempre booleano.
			// - as outras: o tipo do valor gravado, como sempre.
			if (mudanca.operacao === "digitar") {
				alvo.addDropdown((drop) => {
					drop.addOption("texto", "Texto");
					drop.addOption("numero", "Número");
					drop.addOption("data", "Data");
					drop.setValue(mudanca.formato ?? "texto");
					drop.onChange(async (valor) => {
						mudanca.formato = valor as TipoCampo;
						await this.aplicar();
					});
				});
			} else if (mudanca.operacao !== "interruptor") {
				alvo.addDropdown((drop) => {
					drop.addOption("texto", "Texto");
					drop.addOption("numero", "Número");
					drop.addOption("booleano", "Sim/não");
					drop.addOption("data", "Data");
					drop.addOption("vazio", "Limpar");
					drop.setValue(mudanca.tipo);
					drop.onChange(async (valor) => {
						mudanca.tipo = valor as TipoValorPropriedade;
						await this.aplicar();
					});
				});
			}

			alvo.addExtraButton((b) =>
				b
					.setIcon("chevron-up")
					.setTooltip("Subir")
					.setDisabled(indice === 0)
					.onClick(async () => {
						mover(mudancas, indice, -1);
						await this.aplicar();
					}),
			);
			alvo.addExtraButton((b) =>
				b
					.setIcon("chevron-down")
					.setTooltip("Descer")
					.setDisabled(indice === mudancas.length - 1)
					.onClick(async () => {
						mover(mudancas, indice, 1);
						await this.aplicar();
					}),
			);
			alvo.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip("Remover esta propriedade")
					.onClick(async () => {
						mudancas.splice(indice, 1);
						if (mudancas.length === 0) delete botao.propriedades;
						await this.aplicar();
					}),
			);

			// O interruptor não tem valor a configurar: ele grava sim/não conforme a chavinha, e o
			// estado inicial vem da própria nota.
			if (mudanca.operacao === "interruptor") {
				new Setting(caixa).setDesc(
					`Desenha uma chavinha no card. Ligada grava "sim" em "${mudanca.nome || "…"}", desligada grava "não".`,
				);
				return;
			}

			// "Digitar" também não tem valor fixo — quem digita é ela, na hora. O que se configura
			// aqui é só a dica da caixa vazia.
			if (mudanca.operacao === "digitar") {
				this.desenharDicaDoCampo(caixa, mudanca);
				return;
			}

			// "Limpar" apaga a propriedade da nota — não há valor a digitar.
			if (mudanca.tipo === "vazio") {
				new Setting(caixa).setDesc(`Remove a propriedade "${mudanca.nome || "…"}" da nota.`);
				return;
			}

			// "Escolher" não tem valor fixo: tem a LISTA que vai aparecer no clique.
			if (mudanca.operacao === "escolher") {
				this.desenharOpcoes(caixa, mudanca);
				return;
			}

			// Linha 2: o(s) valor(es). Campos de texto usam `salvarDigitacao`, nunca `aplicar` —
			// redesenhar o painel a cada tecla tiraria o foco do campo no meio da digitação.
			const valores = new Setting(caixa)
				.setClass("dash-home-config-propriedade-valores")
				.setName(mudanca.operacao === "alternar" ? "Alterna entre" : "Valor");

			valores.addText((texto) =>
				texto
					.setPlaceholder(this.exemploDeValor(mudanca.tipo))
					.setValue(mudanca.valor)
					.onChange((valor) => {
						mudanca.valor = valor;
						this.salvarDigitacao();
					}),
			);

			if (mudanca.operacao === "alternar") {
				valores.addText((texto) =>
					texto
						// Deixar em branco é uma escolha com efeito: o segundo lado do ciclo passa a
						// ser "remover a propriedade", que é como se alterna um marcador (tem/não tem).
						.setPlaceholder("e (vazio = remover)")
						.setValue(mudanca.valor2 ?? "")
						.onChange((valor) => {
							mudanca.valor2 = valor;
							this.salvarDigitacao();
						}),
				);
			}

			valores.setDesc(this.explicarMudanca(mudanca));
		});
	}

	/**
	 * A lista de opções que o botão oferece no clique.
	 *
	 * Uma por linha, num textarea, e não um campo por opção com botão de adicionar: escrever seis
	 * valores é uma digitação só, e reordenar é recortar e colar uma linha. Um formulário com seis
	 * campos e setas de subir/descer seria mais cliques para o mesmo resultado.
	 */
	private desenharOpcoes(el: HTMLElement, mudanca: MudancaPropriedade): void {
		const opcoes = mudanca.opcoes ?? [];

		const lista = new Setting(el)
			.setClass("dash-home-config-opcoes")
			.setName("Opções")
			.setDesc(
				opcoes.length === 0
					? "Uma por linha. São elas que aparecem para clicar."
					: `${opcoes.length} ${opcoes.length === 1 ? "opção" : "opções"}, nesta ordem, ao clicar no botão.`,
			);

		lista.addTextArea((area) => {
			area.setPlaceholder("a fazer\nfazendo\nfeito");
			area.setValue(opcoes.join("\n"));
			area.inputEl.rows = Math.min(10, Math.max(4, opcoes.length + 1));
			area.onChange((valor) => {
				// A limpeza (vazias, repetidas) roda aqui e não só na carga: sem isso uma linha em
				// branco no meio da digitação já viraria uma opção clicável na miniatura.
				const limpas = limparOpcoes(valor.split("\n"));
				if (limpas.length > 0) mudanca.opcoes = limpas;
				else delete mudanca.opcoes;
				this.salvarDigitacao();
			});
		});

		// Puxar os valores que a propriedade já tem nas notas: montar seis opções à mão quando elas
		// já existem no vault é trabalho repetido. É ponto de partida, não fonte — o que vale é a
		// lista acima, que ela edita.
		const nome = mudanca.nome?.trim();
		if (nome) {
			const doVault = valoresDaPropriedade(this.app, nome);
			const novos = doVault.filter((v) => !opcoes.includes(v));

			new Setting(el)
				.setClass("dash-home-config-opcoes-vault")
				.setDesc(
					doVault.length === 0
						? `Nenhuma nota usa "${nome}" ainda — digite as opções acima.`
						: novos.length === 0
							? `Os ${doVault.length} valores que "${nome}" tem no vault já estão na lista.`
							: `"${nome}" tem ${doVault.length} ${doVault.length === 1 ? "valor" : "valores"} nas suas notas: ${doVault.slice(0, 6).join(", ")}${doVault.length > 6 ? "…" : ""}`,
				)
				.addButton((b) =>
					b
						.setButtonText(opcoes.length === 0 ? "Puxar do vault" : `Acrescentar ${novos.length}`)
						.setTooltip("Preenche a lista com os valores já usados nas suas notas")
						.setDisabled(novos.length === 0)
						.onClick(async () => {
							// Acrescenta ao fim, sem apagar o que ela já escreveu: substituir jogaria
							// fora a ordem e as opções que ainda não existem em nota nenhuma.
							mudanca.opcoes = limparOpcoes([...opcoes, ...doVault]);
							await this.aplicar();
						}),
				);
		}

		if (opcoes.length === 0) {
			el.createDiv({
				cls: "dash-home-config-vazio",
				text: "Sem opções, o botão avisa e não altera nada.",
			});
		}
	}

	/** Um exemplo do formato aceito, por tipo — evita a pergunta "como escrevo uma data aqui?". */
	private exemploDeValor(tipo: TipoValorPropriedade): string {
		if (tipo === "numero") return "3 ou 3,5";
		if (tipo === "booleano") return "sim / não";
		if (tipo === "data") return "hoje, agora ou 2026-08-05";
		return "concluído";
	}

	/**
	 * O que vai acontecer, em português, com os valores que ela acabou de digitar.
	 *
	 * Existe porque "alternar" tem uma regra que não se lê no formulário: o botão compara o valor
	 * ATUAL da nota com o primeiro campo para decidir o lado. Sem esta frase, a única forma de
	 * descobrir seria clicando e observando a nota.
	 */
	private explicarMudanca(mudanca: MudancaPropriedade): string {
		const nome = mudanca.nome || "a propriedade";
		const primeiro = mudanca.valor.trim() || "(vazio)";

		if (mudanca.operacao === "escolher") {
			const quantas = mudanca.opcoes?.length ?? 0;
			return quantas === 0
				? `Abre uma lista para escolher o valor de "${nome}" — falta configurar as opções.`
				: `Abre uma lista com ${quantas} ${quantas === 1 ? "opção" : "opções"} e grava a clicada em "${nome}".`;
		}

		if (mudanca.operacao === "alternar") {
			const segundo = mudanca.valor2?.trim() || "remover a propriedade";
			return `Se "${nome}" já for ${primeiro}, passa a ${segundo}. Senão, vira ${primeiro}.`;
		}

		if (mudanca.tipo === "data" && ["hoje", "agora"].includes(mudanca.valor.trim().toLowerCase())) {
			return `Grava a data do dia do clique em "${nome}".`;
		}

		return `Grava ${primeiro} em "${nome}", seja qual for o valor atual.`;
	}

	// ── Coluna direita: a miniatura ──────────────────────────────────────────────────────

	private desenharPreview(el: HTMLElement, dashboard: Dashboard): void {
		el.createEl("h3", { text: "Preview" });
		el.createDiv({
			cls: "dash-home-config-preview-nota",
			text: "É assim que o dashboard fica na nota.",
		});

		const palco = el.createDiv({ cls: "dash-home-config-preview-palco" });
		renderizarDashboard(palco, dashboard, this.plugin.dados, { miniatura: true });

		new Setting(el).addButton((botao) =>
			botao
				.setButtonText("Abrir dashboard")
				.setCta()
				.onClick(async () => {
					await this.plugin.abrirDashboard(dashboard);
				}),
		);
	}

	/**
	 * Redesenha só a miniatura. Usado pelos campos de texto, onde um redesenho total tiraria o foco
	 * do campo no meio da digitação.
	 */
	private atualizarPreview(): void {
		const palco = this.containerEl.querySelector<HTMLElement>(".dash-home-config-preview-palco");
		if (!palco) return;
		renderizarDashboard(palco, dashboardAtivo(this.plugin.dados), this.plugin.dados, { miniatura: true });
	}

	/**
	 * As notas em que este dashboard é escrito.
	 *
	 * É uma LISTA porque o dashboard é uma predefinição: a mesma configuração de botões costuma
	 * servir a várias notas do mesmo tipo (um "mapa de cliente" aplicado a vinte clientes). Mexer
	 * num botão atualiza todas — o que é o ponto, e por isso está dito na descrição.
	 *
	 * As notas são apontadas por seletor, nunca digitadas: acertar uma string exata é justamente
	 * o que o plugin evita (e o que causou o bug de caixa da sessão 3).
	 */
	private desenharNotas(el: HTMLElement, dashboard: Dashboard): void {
		const notas = (dashboard.caminhosNota ??= []);

		const cabecalho = new Setting(el)
			.setName("Notas deste dashboard")
			.setDesc(
				notas.length === 0
					? "Escolha em quais notas este dashboard é escrito. Pode ser mais de uma."
					: notas.length === 1
						? "Este dashboard é escrito nesta nota. Dá para aplicá-lo em mais de uma."
						: `Este dashboard é escrito em ${notas.length} notas. Mudanças valem para todas.`,
			);

		cabecalho.addButton((botao) =>
			botao
				.setButtonText("Aplicar em…")
				.setTooltip("Escrever este dashboard também em outra nota")
				.onClick(() => {
					new ModalEscolherNota(this.app, async (caminho) => {
						if (!this.conferirNotaLivre(caminho, dashboard)) return;
						notas.push(caminho);
						await this.aplicar();
					}).open();
				}),
		);

		cabecalho.addButton((botao) =>
			botao
				.setButtonText("Criar nova")
				.setTooltip("Criar uma nota nova com este dashboard")
				.onClick(() => {
					new ModalNomeDaNota(this.app, dashboard.nome, async (caminho) => {
						if (!this.conferirNotaLivre(caminho, dashboard)) return;
						notas.push(caminho);
						// aplicar() já chama escreverDashboard, que cria o arquivo se não existir.
						await this.aplicar();
						new Notice(`Nota "${caminho}" criada.`);
					}).open();
				}),
		);

		if (notas.length === 0) {
			el.createDiv({
				cls: "dash-home-config-vazio",
				text: "Nenhuma nota ainda — o dashboard existe, mas não é escrito em lugar nenhum.",
			});
			return;
		}

		for (const [i, caminho] of notas.entries()) {
			const linha = new Setting(el).setClass("dash-home-config-nota-linha");
			linha.setName(caminho);

			linha.addExtraButton((b) =>
				b
					.setIcon("external-link")
					.setTooltip("Abrir esta nota")
					.onClick(async () => {
						await this.plugin.abrirNota(caminho);
					}),
			);

			linha.addExtraButton((b) =>
				b
					.setIcon("x")
					.setTooltip("Parar de escrever nesta nota")
					.onClick(async () => {
						// Só desvincula: o arquivo e o bloco já escrito continuam onde estão.
						// Apagar nota da usuária sem ela pedir é destrutivo demais.
						notas.splice(i, 1);
						new Notice(`"${caminho}" não recebe mais este dashboard. A nota continua no vault.`);
						await this.aplicar();
					}),
			);
		}
	}

	/**
	 * Recusa apontar dois dashboards para a mesma nota. Sem isto, um sobrescreveria o outro a cada
	 * salvamento — silenciosamente, que é o pior jeito de perder trabalho.
	 *
	 * Também recusa a mesma nota duas vezes no mesmo dashboard, que faria a nota ser escrita duas
	 * vezes por salvamento sem nenhum ganho.
	 */
	private conferirNotaLivre(caminho: string, dashboard: Dashboard): boolean {
		const alvo = caminho.trim().toLowerCase();

		if (dashboard.caminhosNota?.some((c) => c.trim().toLowerCase() === alvo)) {
			new Notice(`Este dashboard já é escrito em "${caminho}".`);
			return false;
		}

		const conflito = dashboardQueUsaNota(this.plugin.dados, caminho, dashboard.id);
		if (conflito) {
			new Notice(`A nota "${caminho}" já é usada pelo dashboard "${conflito.nome}". Escolha outra.`);
			return false;
		}
		return true;
	}

	/** Botão de ícone que não propaga o clique para o cabeçalho (que expande/colapsa). */
	private botaoIcone(
		el: HTMLElement,
		icone: string,
		titulo: string,
		ativo: boolean,
		onClick: () => void | Promise<void>,
	): void {
		const botao = el.createEl("button", { cls: "clickable-icon dash-home-config-acao" });
		botao.setAttribute("aria-label", titulo);
		setIcon(botao, icone);
		if (!ativo) {
			botao.addClass("is-desativado");
			botao.setAttribute("disabled", "true");
			return;
		}
		botao.addEventListener("click", (evento) => {
			evento.stopPropagation();
			void onClick();
		});
	}
}

/**
 * Troca dois itens de posição dentro da lista.
 *
 * Serve ao subir/descer dentro de um grupo: os dois vizinhos de grupo podem estar longe um do outro
 * na lista global (com botões de outros grupos entre eles), e `mover()` — que desloca uma casa —
 * empurraria o botão para dentro do grupo errado.
 */
function trocarNaLista<T>(lista: T[], a: T, b: T): void {
	const i = lista.indexOf(a);
	const j = lista.indexOf(b);
	if (i < 0 || j < 0) return;
	lista[i] = b;
	lista[j] = a;
}

function semPrefixo(id: string): string {
	return id.startsWith("lucide-") ? id.slice("lucide-".length) : id;
}

/**
 * As camadas em jogo ao desenhar os controles de aparência de botão.
 *
 * `alvo` é o objeto que os controles ESCREVEM (o estilo da camada sendo editada); as outras três
 * são as camadas em vigor, usadas só para leitura — para calcular o herdado e para descobrir se
 * alguém acima está sobrescrevendo.
 */
interface ContextoEstiloBotao {
	/** Onde os controles gravam. É sempre uma das três camadas abaixo. */
	alvo: EstiloBotao;
	/** Qual camada `alvo` é — decide quais controles aparecem e se há opção de herdar. */
	camada: Camada;
	global: EstiloBotao | undefined;
	doQuadrante: EstiloBotao | undefined;
	doBotao: EstiloBotao | undefined;
}

/**
 * O aviso de que uma camada ACIMA está mandando — o antídoto do bug da sessão 11, em que a
 * configuração global era ignorada em silêncio e parecia quebrada.
 */
const AVISO_SOBRESCRITA: Partial<Record<Camada, string>> = {
	quadrante: "⚠️ O quadrante sobrescreve isto.",
	botao: "⚠️ Este botão tem valor próprio e ignora esta escolha.",
};

const NOME_ARRANJO: Record<ArranjoBotoes, string> = {
	coluna: "Um embaixo do outro",
	grade2: "Dois por linha",
	grade3: "Três por linha",
	// "preenchendo a linha" e não "fluindo": desde a s22 os botões dividem a largura do card em
	// partes iguais, então o nome antigo descreveria o comportamento anterior.
	chips: "Lado a lado (preenchendo a linha)",
};

const NOME_FORMA: Record<FormaBotao, string> = {
	retangulo: "Retângulo",
	pilula: "Pílula (bem arredondado)",
	quadrado: "Quadrado (só ícone)",
};

const NOME_PINTURA: Record<PinturaBotao, string> = {
	neutro: "Neutra (só o ícone colorido)",
	fundo: "Fundo tingido",
	contorno: "Contorno colorido",
	solido: "Cor cheia",
};

const NOME_COR_LETRA: Record<CorLetraBotao, string> = {
	auto: "Automática (branca no botão preenchido)",
	texto: "Cor de texto do tema",
};

const NOME_ALINHAMENTO: Record<AlinhamentoBotao, string> = {
	esquerda: "À esquerda",
	centro: "Centralizado",
};

/**
 * " (metade)", " (um terço)"… para as frações que têm nome. Ajuda a enxergar o tamanho sem
 * precisar contar colunas. Devolve "" quando a fração não é redonda — inventar nome para 5/6
 * atrapalharia mais do que ajuda.
 */
function fracaoLegivel(parte: number, total: number): string {
	if (parte * 2 === total) return " (metade)";
	if (parte * 3 === total) return " (um terço)";
	if (parte * 4 === total) return " (um quarto)";
	if (parte * 6 === total) return " (um sexto)";
	if (parte * 3 === total * 2) return " (dois terços)";
	if (parte * 4 === total * 3) return " (três quartos)";
	return "";
}

interface ItemDaLinha {
	quadrante: Quadrante;
	/** Quantas colunas da grade este quadrante ocupa. */
	fatia: number;
}

/**
 * Agrupa os quadrantes em linhas do jeito que o CSS Grid faz: preenche a linha até não caber
 * mais, e o que não cabe começa a próxima.
 *
 * Simplificação assumida: o grid real pode puxar um item PEQUENO de mais adiante para tapar um
 * buraco (`grid-auto-flow` denso não está ligado, mas o algoritmo padrão ainda avança). Aqui
 * mantemos a ordem, que é o que a usuária espera ver — e o mapa serve justamente para mostrar
 * quando sobra espaço, que é a causa desse comportamento.
 */
function agruparEmLinhas(quadrantes: Quadrante[], total: number): ItemDaLinha[][] {
	const linhas: ItemDaLinha[][] = [];
	let atual: ItemDaLinha[] = [];
	let usado = 0;

	for (const quadrante of quadrantes) {
		// O separador ignora `largura` e sempre toma a linha inteira — é o que o render faz.
		const bruta =
			quadrante.conteudo === "separador" || quadrante.largura === "cheio"
				? total
				: (quadrante.largura ?? 1);
		// Nunca deixa uma fatia maior que a grade virar uma linha impossível de desenhar.
		const fatia = Math.min(total, Math.max(1, bruta));

		if (usado + fatia > total && atual.length > 0) {
			linhas.push(atual);
			atual = [];
			usado = 0;
		}

		atual.push({ quadrante, fatia });
		usado += fatia;

		if (usado >= total) {
			linhas.push(atual);
			atual = [];
			usado = 0;
		}
	}

	if (atual.length > 0) linhas.push(atual);
	return linhas;
}

/**
 * Confirmação de sim/não, resolvida numa Promise.
 *
 * Usada ao excluir um molde que está em uso: a exclusão mexe em cards de outros dashboards, que ela
 * pode nem estar vendo na tela — e uma ação de efeito invisível não pode acontecer num clique só.
 * Fechar pelo esc ou clicando fora conta como NÃO: o padrão seguro é não mexer nos dados dela.
 */
function confirmar(app: App, titulo: string, detalhe: string): Promise<boolean> {
	return new Promise((resolve) => {
		const modal = new Modal(app);
		let respondeu = false;
		const responder = (valor: boolean) => {
			if (respondeu) return;
			respondeu = true;
			resolve(valor);
			modal.close();
		};

		modal.titleEl.setText(titulo);
		modal.contentEl.createEl("p", { text: detalhe });
		new Setting(modal.contentEl)
			.addButton((b) => b.setButtonText("Cancelar").onClick(() => responder(false)))
			.addButton((b) => b.setButtonText("Excluir").setWarning().onClick(() => responder(true)));

		// Fechado por fora (esc, clique no fundo): resolve como "não" para a Promise nunca ficar
		// pendurada — o chamador está com um `await` esperando.
		modal.onClose = () => {
			modal.contentEl.empty();
			if (!respondeu) {
				respondeu = true;
				resolve(false);
			}
		};
		modal.open();
	});
}

/**
 * A lista de botões salvos, para escolher qual colocar no quadrante.
 *
 * `FuzzySuggestModal` seria o padrão do vault (a regra dos seletores de ícone), mas aqui a lista é
 * curta e o que ela precisa ver é o que cada botão FAZ — um nome sozinho não distingue dois botões
 * "Status". Por isso a linha traz ícone, nome e a descrição da ação.
 */
class ModalEscolherBotaoSalvo extends Modal {
	constructor(
		app: App,
		private salvos: BotaoSalvo[],
		private onEscolher: (salvo: BotaoSalvo) => void | Promise<void>,
		private grupos: GrupoBotoes[] = [],
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Usar um botão salvo");

		if (this.salvos.length === 0) {
			this.contentEl.createEl("p", {
				cls: "dash-home-config-vazio",
				text: "Nenhum botão salvo ainda. Cadastre um na tela “Botões”.",
			});
			return;
		}

		const lista = this.contentEl.createDiv({ cls: "dash-home-config-salvos" });

		// É AQUI que o agrupamento paga: na hora de escolher, saber em que grupo o botão está é o
		// que evita varrer a lista inteira. Os grupos saem na ordem dela; "Sem grupo" por último.
		const secoes: Array<{ titulo: string; icone?: string; itens: BotaoSalvo[] }> = [];
		for (const grupo of this.grupos) {
			const itens = this.salvos.filter((s) => s.grupoId === grupo.id);
			if (itens.length > 0) secoes.push({ titulo: grupo.nome || "Sem nome", icone: grupo.icone, itens });
		}
		const semGrupo = this.salvos.filter((s) => !s.grupoId || !this.grupos.some((g) => g.id === s.grupoId));
		if (semGrupo.length > 0) secoes.push({ titulo: "Sem grupo", itens: semGrupo });

		// Um cabeçalho só faz sentido quando há mais de um grupo para distinguir: com um só, ele
		// seria uma linha repetindo o óbvio acima de todos os itens.
		const mostrarTitulos = secoes.length > 1;

		for (const secao of secoes) {
			if (mostrarTitulos) {
				const cabecalho = lista.createDiv({ cls: "dash-home-config-salvo-grupo" });
				if (secao.icone) setIcon(cabecalho.createSpan({ cls: "dash-home-config-salvo-grupo-icone" }), secao.icone);
				cabecalho.createSpan({ text: secao.titulo });
			}

			for (const salvo of secao.itens) {
				const item = lista.createEl("button", { cls: "dash-home-config-salvo-item" });

				const icone = item.createSpan({ cls: "dash-home-config-salvo-icone" });
				if (salvo.icone) setIcon(icone, salvo.icone);

				const textos = item.createDiv({ cls: "dash-home-config-salvo-textos" });
				textos.createDiv({ cls: "dash-home-config-salvo-nome", text: salvo.texto || "Sem nome" });
				textos.createDiv({ cls: "dash-home-config-salvo-acao", text: descreverAcao(salvo) });

				item.addEventListener("click", () => {
					this.close();
					void this.onEscolher(salvo);
				});
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** O que o botão faz, em uma linha — para a lista de escolha e para o rótulo do botão vinculado. */
function descreverAcao(botao: Configuravel): string {
	switch (botao.tipo) {
		case "nota":
			return botao.destino ? `Abre a nota ${botao.destino}` : "Abrir nota (sem destino)";
		case "pasta":
			return botao.destino ? `Abre a pasta ${botao.destino}` : "Abrir pasta (sem destino)";
		case "busca":
			return botao.destino ? `Busca ${botao.destino}` : "Buscar (sem query)";
		case "comando":
			return botao.destino ? `Roda o comando ${botao.destino}` : "Rodar comando (sem comando)";
		case "criar":
			return botao.criar?.template ? `Cria nota de ${botao.criar.template}` : "Cria uma nota nova";
		default: {
			const n = botao.propriedades?.length ?? 0;
			if (n === 0) return "Altera propriedades (nenhuma configurada)";
			return n === 1
				? `Altera a propriedade ${botao.propriedades?.[0].nome}`
				: `Altera ${n} propriedades`;
		}
	}
}

/**
 * Pergunta o nome de uma nota nova. É o único lugar onde a usuária digita um caminho — e aqui é
 * inevitável: a nota ainda não existe, então não há o que selecionar numa lista.
 */
class ModalNomeDaNota extends Modal {
	private valor: string;

	constructor(app: App, sugestao: string, private onConfirmar: (caminho: string) => void) {
		super(app);
		this.valor = `${(sugestao || "Dashboard").trim()}.md`;
	}

	onOpen(): void {
		this.titleEl.setText("Criar nota para o dashboard");
		this.contentEl.createEl("p", {
			cls: "dash-home-config-vazio",
			text: "Use barras para colocar em uma pasta (ex.: Painéis/Home.md). A pasta é criada se não existir.",
		});

		const confirmar = () => {
			const limpo = this.valor.trim();
			if (!limpo) {
				new Notice("Dê um nome para a nota.");
				return;
			}
			this.onConfirmar(limpo.endsWith(".md") ? limpo : `${limpo}.md`);
			this.close();
		};

		new Setting(this.contentEl).setName("Nome da nota").addText((texto) => {
			texto.setValue(this.valor).onChange((v) => (this.valor = v));
			texto.inputEl.addEventListener("keydown", (evento) => {
				if (evento.key === "Enter") confirmar();
			});
			// Foco no campo ao abrir: o modal existe só para isto.
			window.setTimeout(() => texto.inputEl.select(), 0);
		});

		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
			.addButton((b) => b.setButtonText("Criar").setCta().onClick(confirmar));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
