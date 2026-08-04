import { Modal, Notice, PluginSettingTab, Setting, setIcon, type App } from "obsidian";
import { abrirAcordeao, criarAcordeao } from "./acordeao";
import {
	CORES,
	criarBotao,
	criarDashboard,
	criarQuadrante,
	dashboardAtivo,
	ehHex,
	limitarColunas,
	limitarLargura,
	limitarLarguraQuadrante,
	mover,
	removerDashboard,
	type Botao,
	type DadosDashHome,
	type Dashboard,
	type Quadrante,
	type TipoAcao,
} from "./dados";
import { resolverEstilo, type EstiloQuadrante, type PosicaoBarra } from "./estilo";
import { paletasDoCustomize, type PaletaExterna } from "./paleta";
import type DashHomePlugin from "./main";
import { renderizarDashboard } from "./render";
import {
	ModalEscolherBase,
	ModalEscolherComando,
	ModalEscolherIcone,
	ModalEscolherNota,
	ModalEscolherPasta,
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
export class PainelConfigDashHome extends PluginSettingTab {
	// O estado de aberto/fechado dos acordeões vive no módulo `acordeao.ts`, não aqui — ver o
	// comentário de `abertos` lá.

	constructor(app: App, private plugin: DashHomePlugin) {
		super(app, plugin);
	}

	/** Timer do salvamento adiado dos campos de texto (ver `salvarDigitacao`). */
	private timerDigitacao: number | null = null;

	/** Paletas do plugin Customize. Lidas do disco uma vez por abertura do painel. */
	private paletas: PaletaExterna[] = [];
	private leuPaletas = false;

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

	private atualizar(): void {
		const { containerEl } = this;

		// Guarda e devolve o scroll. Sem isto, cada clique (trocar cor, reordenar, abrir um
		// quadrante) joga o painel de volta para o topo e a usuária tem que se reencontrar na
		// lista — o redesenho total é conveniente para o código, mas quem paga o preço é ela.
		const rolagem = this.acharRolagem();
		const posicao = rolagem?.scrollTop ?? 0;

		containerEl.empty();
		containerEl.addClass("dash-home-config");

		const dados = this.plugin.dados;
		const dashboard = dashboardAtivo(dados);

		this.desenharBarraDashboards(containerEl, dashboard);

		const colunas = containerEl.createDiv({ cls: "dash-home-config-colunas" });
		const esquerda = colunas.createDiv({ cls: "dash-home-config-montagem" });
		const direita = colunas.createDiv({ cls: "dash-home-config-preview" });

		this.desenharMontagem(esquerda, dashboard);
		this.desenharPreview(direita, dashboard);

		if (rolagem && posicao > 0) {
			// Depois do layout: o conteúdo acabou de ser recriado e a altura só é conhecida agora.
			// Sem o requestAnimationFrame o scrollTop é cortado para a altura antiga (menor).
			window.requestAnimationFrame(() => {
				rolagem.scrollTop = posicao;
			});
		}
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

		new Setting(el)
			.setName("Nome")
			.setDesc("Só o nome do dashboard nas configurações — não muda a nota.")
			.addText((texto) =>
				texto.setValue(dashboard.nome).onChange((valor) => {
					dashboard.nome = valor;
					// Sem redesenhar: o campo tem foco e um redesenho a cada tecla o perderia.
					this.salvarDigitacao();
				}),
			);

		// A nota é apontada por seletor, não digitada: a usuária indica qual nota é o dashboard do
		// mesmo jeito que indica o destino de um botão. Digitar caminho à mão é a única parte onde
		// ela ainda precisaria acertar uma string exata — e é justamente o que o plugin evita.
		new Setting(el)
			.setName("Nota do dashboard")
			.setDesc(
				dashboard.caminhoNota
					? `O dashboard é escrito em "${dashboard.caminhoNota}". Aponte a nota inicial do Obsidian para ela.`
					: "Escolha em qual nota este dashboard é escrito.",
			)
			.addButton((botao) =>
				botao
					.setButtonText(dashboard.caminhoNota || "Escolher nota…")
					.setTooltip(dashboard.caminhoNota || "Escolher a nota do dashboard")
					.onClick(() => {
						new ModalEscolherNota(this.app, async (caminho) => {
							if (!this.conferirNotaLivre(caminho, dashboard)) return;
							dashboard.caminhoNota = caminho;
							await this.aplicar();
						}).open();
					}),
			)
			.addButton((botao) =>
				botao
					.setButtonText("Criar nova")
					.setTooltip("Criar uma nota nova para este dashboard")
					.onClick(() => {
						new ModalNomeDaNota(this.app, dashboard.nome, async (caminho) => {
							if (!this.conferirNotaLivre(caminho, dashboard)) return;
							dashboard.caminhoNota = caminho;
							// aplicar() já chama escreverDashboard, que cria o arquivo se não existir.
							await this.aplicar();
							new Notice(`Nota "${caminho}" criada.`);
						}).open();
					}),
			)
			.addExtraButton((botao) =>
				botao
					.setIcon("external-link")
					.setTooltip("Abrir a nota")
					.onClick(async () => {
						await this.plugin.abrirDashboard(dashboard);
					}),
			);

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
		const secaoQuadrantes = criarAcordeao(el, {
			chave: `${dashboard.id}:quadrantes`,
			titulo: "Quadrantes",
			resumo: `${dashboard.quadrantes.length}`,
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

		const dados = this.plugin.dados;

		const secaoAparencia = criarAcordeao(el, {
			chave: "secao:aparencia",
			titulo: "Aparência",
			descricao: "Vale para todos os quadrantes; cada um pode sobrescrever.",
		});

		secaoAparencia.sePreenchido((corpo) => this.desenharAparencia(corpo, dados));
	}

	private desenharAparencia(el: HTMLElement, dados: DadosDashHome): void {
		new Setting(el)
			.setName("Tamanho dos botões")
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

		new Setting(el)
			.setName("Mostrar títulos dos quadrantes")
			.addToggle((toggle) =>
				toggle.setValue(dados.mostrarTitulos).onChange(async (valor) => {
					dados.mostrarTitulos = valor;
					await this.aplicar();
				}),
			);

		// A herança (global → quadrante) segue a mesma lógica do estilo de callout do Customize.
		const global = dados.estiloGlobal;

		// Quantos quadrantes têm posição própria — eles ignoram esta configuração global, e sem
		// aviso a usuária mexe aqui e "não acontece nada".
		const comBarraPropria = this.plugin.dados.dashboards.flatMap((d) =>
			d.quadrantes.filter((q) => q.estilo?.posicaoBarra !== undefined),
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
					: `${quadrante.botoes.length} ${quadrante.botoes.length === 1 ? "botão" : "botões"}`,
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
		this.botaoIcone(acoes, "trash-2", "Excluir quadrante", true, async () => {
			dashboard.quadrantes.splice(indice, 1);
			await this.aplicar();
		});

		secao.sePreenchido((corpo) => {
			// Dentro do quadrante, três acordeões aninhados: conteúdo (o que ela mexe mais),
			// identidade e aparência. Sem isso um quadrante aberto vira uma parede de ~12 controles.

			const secaoConteudo = criarAcordeao(corpo, {
				chave: `${quadrante.id}:conteudo`,
				titulo: ehMarkdown ? "Conteúdo" : "Botões",
				aninhado: true,
				abertoPorPadrao: true,
			});

			secaoConteudo.sePreenchido((corpoConteudo) => {
				new Setting(corpoConteudo)
					.setName("Tipo de conteúdo")
					.setDesc("Botões, um espaço livre para escrever, ou um separador entre linhas.")
					.addDropdown((drop) => {
						drop.addOption("botoes", "Botões");
						drop.addOption("markdown", "Conteúdo livre");
						drop.addOption("separador", "Separador / espaço");
						drop.setValue(quadrante.conteudo ?? "botoes");
						drop.onChange(async (valor) => {
							// Os botões NÃO são apagados ao trocar de tipo (nem o markdown): voltar
							// atrás tem que devolver o que existia. O que não é do tipo atual
							// simplesmente não é renderizado.
							quadrante.conteudo =
								valor === "botoes" ? undefined : (valor as "markdown" | "separador");
							await this.aplicar();
						});
					});

				if (quadrante.conteudo === "separador") {
					this.desenharSeparador(corpoConteudo, quadrante);
					return;
				}

				if (ehMarkdown) {
					this.desenharEditorMarkdown(corpoConteudo, quadrante);
					return;
				}

				if (quadrante.botoes.length === 0) {
					corpoConteudo.createDiv({ cls: "dash-home-config-vazio", text: "Nenhum botão ainda." });
				}
				quadrante.botoes.forEach((botao, i) => {
					this.desenharBotao(corpoConteudo, quadrante, botao, i);
				});
				new Setting(corpoConteudo).addButton((botao) =>
					botao.setButtonText("+ Novo botão").onClick(async () => {
						criarBotao(quadrante, "Novo botão");
						await this.aplicar();
					}),
				);
			});

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
		const setting = new Setting(el).setName("Cor").setClass("dash-home-config-cores");

		const faixa = setting.controlEl.createDiv({ cls: "dash-home-swatches" });

		const swatch = (valor: string | undefined, rotulo: string, css: string) => {
			const b = faixa.createEl("button", { cls: "dash-home-swatch" });
			b.setAttribute("aria-label", rotulo);
			b.setAttribute("title", rotulo);
			b.style.setProperty("--swatch", css);
			b.toggleClass("is-ativo", (quadrante.cor ?? "") === (valor ?? ""));
			b.addEventListener("click", async () => {
				quadrante.cor = valor;
				await this.aplicar();
			});
		};

		swatch(undefined, "Padrão do tema", "var(--interactive-accent)");
		for (const nome of Object.keys(CORES)) {
			swatch(nome, nome.charAt(0).toUpperCase() + nome.slice(1), CORES[nome]);
		}

		// Cor livre: o input nativo é o caminho mais direto e já traz o seletor do sistema.
		setting.addColorPicker((picker) => {
			picker.setValue(ehHex(quadrante.cor) ? (quadrante.cor as string) : "#4263eb");
			picker.onChange(async (valor) => {
				quadrante.cor = valor;
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
				const b = faixaPaleta.createEl("button", { cls: "dash-home-swatch" });
				b.setAttribute("aria-label", hex);
				b.setAttribute("title", hex);
				b.style.setProperty("--swatch", hex);
				b.toggleClass("is-ativo", (quadrante.cor ?? "").toLowerCase() === hex);
				b.addEventListener("click", async () => {
					quadrante.cor = hex;
					await this.aplicar();
				});
			}
		}
	}

	/**
	 * A aparência do quadrante. Cada controle mexe só no estilo DESTE quadrante; o que ele não
	 * define herda do estilo global (seção "Aparência", mais abaixo no painel).
	 */
	private desenharEstilo(el: HTMLElement, quadrante: Quadrante): void {
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

		new Setting(el).addButton((botao) =>
			botao
				.setButtonText("Voltar ao estilo global")
				.setTooltip("Descarta os ajustes deste quadrante")
				.onClick(async () => {
					quadrante.estilo = {};
					await this.aplicar();
				}),
		);
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

	private desenharBotao(el: HTMLElement, quadrante: Quadrante, botao: Botao, indice: number): void {
		const linha = el.createDiv({ cls: "dash-home-config-botao" });

		const topo = new Setting(linha).setClass("dash-home-config-botao-topo");
		topo.addText((texto) =>
			texto
				.setPlaceholder("Nome do botão")
				.setValue(botao.texto)
				.onChange((valor) => {
					botao.texto = valor;
					this.salvarDigitacao();
				}),
		);

		topo.addButton((b) => {
			if (botao.icone) b.setIcon(botao.icone);
			else b.setButtonText("Ícone");
			b.setTooltip("Escolher ícone");
			b.onClick(() => {
				new ModalEscolherIcone(this.app, botao.texto, botao.icone, async (icone) => {
					botao.icone = icone;
					await this.aplicar();
				}).open();
			});
		});

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
				.setIcon("trash-2")
				.setTooltip("Excluir botão")
				.onClick(async () => {
					quadrante.botoes.splice(indice, 1);
					await this.aplicar();
				}),
		);

		// Segunda linha: o que o botão faz.
		const destino = new Setting(linha).setClass("dash-home-config-botao-destino");
		destino.addDropdown((drop) => {
			drop.addOption("nota", "Abrir nota");
			drop.addOption("pasta", "Abrir pasta");
			drop.addOption("busca", "Buscar");
			drop.addOption("comando", "Rodar comando");
			drop.setValue(botao.tipo);
			drop.onChange(async (valor) => {
				// O destino antigo não faz sentido no tipo novo (um caminho de nota não é uma query
				// de busca), então limpamos — melhor um campo vazio do que um destino que falha.
				botao.tipo = valor as TipoAcao;
				botao.destino = "";
				await this.aplicar();
			});
		});

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

	private escolherDestino(botao: Botao): void {
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
	 * Recusa apontar dois dashboards para a mesma nota. Sem isto, um sobrescreveria o outro a cada
	 * salvamento — silenciosamente, que é o pior jeito de perder trabalho.
	 */
	private conferirNotaLivre(caminho: string, dashboard: Dashboard): boolean {
		const alvo = caminho.trim().toLowerCase();
		const conflito = this.plugin.dados.dashboards.find(
			(d) => d.id !== dashboard.id && d.caminhoNota.trim().toLowerCase() === alvo,
		);
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

function semPrefixo(id: string): string {
	return id.startsWith("lucide-") ? id.slice("lucide-".length) : id;
}

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
