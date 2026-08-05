import { MarkdownRenderer, setIcon, type App, type Component } from "obsidian";
import { corCss, type Botao, type Dashboard, type DadosDashHome, type Quadrante } from "./dados";
import { bordasDoQuadrante, estiloAtivo, resolverEstilo, variaveisDoQuadrante } from "./estilo";
import {
	colunasDoArranjo,
	ehSoIcone,
	estiloBotaoAtivo,
	resolverArranjo,
	resolverEstiloBotao,
	variaveisDoBotao,
	type EstiloBotao,
} from "./estilo-botao";
import { executarAcao } from "./acoes";

/**
 * Desenha o grid de quadrantes. Usado em dois lugares com a mesma função — o dashboard renderizado
 * na nota e a miniatura do painel de configurações — porque preview que não usa o mesmo código do
 * resultado real acaba divergindo dele.
 *
 * A diferença entre os dois modos é só CSS (a classe `is-miniatura` encolhe tudo) e o clique, que
 * a miniatura não liga. Nada de layout é reimplementado.
 */

export interface OpcoesRender {
	/** Miniatura do painel: escala reduzida e botões inertes. */
	miniatura?: boolean;
	/** Só é usado fora da miniatura — a miniatura não executa ação nenhuma. */
	app?: App;
	/**
	 * Dono do ciclo de vida do markdown renderizado. `MarkdownRenderer.render` registra
	 * listeners e sub-componentes (embeds, Bases, Dataview) que precisam ser destruídos junto
	 * com o container — sem um Component, eles vazam.
	 */
	componente?: Component;
	/** Caminho da nota que hospeda o dashboard, para resolver links relativos do markdown. */
	caminhoOrigem?: string;
}

export function renderizarDashboard(
	el: HTMLElement,
	dashboard: Dashboard,
	dados: DadosDashHome,
	opcoes: OpcoesRender = {},
): void {
	el.empty();
	el.addClass("dash-home-dashboard");
	el.toggleClass("is-miniatura", !!opcoes.miniatura);
	el.toggleClass(`dash-home-botoes-${dados.tamanhoBotao}`, true);

	// A largura só faz sentido na nota: na miniatura o palco do painel é quem manda, e aplicar
	// "total" ali estouraria a coluna do preview.
	aplicarLargura(el, dashboard, !!opcoes.miniatura);

	if (dashboard.quadrantes.length === 0) {
		const vazio = el.createDiv({ cls: "dash-home-vazio" });
		vazio.setText(
			opcoes.miniatura
				? "Adicione um quadrante para ver o preview"
				: "Este dashboard ainda não tem quadrantes. Configurações → Dash Cards.",
		);
		return;
	}

	const grid = el.createDiv({ cls: "dash-home-grid" });
	// Via style em vez de classe: o número de colunas é um dado (1 a 4), não um estado visual, e
	// a media query do CSS ainda consegue sobrescrever isto em tela estreita.
	grid.style.setProperty("--dash-home-colunas", String(dashboard.colunas));

	for (const quadrante of dashboard.quadrantes) {
		renderizarQuadrante(grid, quadrante, dados, opcoes);
	}
}

/**
 * Aplica a largura escolhida.
 *
 * "total" precisa vencer a largura de leitura do Obsidian, que é imposta por um container acima
 * do nosso elemento. Margem negativa simétrica é a saída usada por vários plugins: o bloco cresce
 * para os dois lados sem que precisemos alterar o layout da nota inteira.
 */
function aplicarLargura(el: HTMLElement, dashboard: Dashboard, miniatura: boolean): void {
	el.removeClass("is-largura-total");
	el.style.removeProperty("--dash-home-largura");

	if (miniatura || dashboard.largura === "leitura") return;

	if (dashboard.largura === "total") {
		el.addClass("is-largura-total");
		return;
	}

	if (typeof dashboard.largura === "number") {
		el.addClass("is-largura-total");
		el.style.setProperty("--dash-home-largura", `${dashboard.largura}px`);
	}
}

function renderizarQuadrante(
	grid: HTMLElement,
	quadrante: Quadrante,
	dados: DadosDashHome,
	opcoes: OpcoesRender,
): void {
	// O separador não é um card: sai antes de qualquer estilo de quadrante ser aplicado.
	if (quadrante.conteudo === "separador") {
		renderizarSeparador(grid, quadrante);
		return;
	}

	const card = grid.createDiv({ cls: "dash-home-quadrante" });
	// `estiloAtivo` (e não `quadrante.estilo` direto) porque um quadrante que voltou a herdar ainda
	// guarda os ajustes dele no objeto — eles ficam adormecidos até ela personalizar de novo.
	const estilo = resolverEstilo(dados.estiloGlobal, estiloAtivo(quadrante.personalizaEstilo, quadrante.estilo));

	// A fatia do grid que este quadrante ocupa. "cheio" usa `1 / -1` (da primeira à última linha
	// de grade), que vale para qualquer número de colunas sem precisar saber quantas são.
	if (quadrante.largura === "cheio") {
		card.style.setProperty("grid-column", "1 / -1");
	} else if (typeof quadrante.largura === "number" && quadrante.largura > 1) {
		card.style.setProperty("grid-column", `span ${quadrante.largura}`);
	}

	// setProperty escapa o valor: uma cor malformada vira uma declaração inválida e é ignorada,
	// nunca uma regra CSS injetada.
	card.style.setProperty("--dash-home-cor", corCss(quadrante.cor));
	for (const [prop, valor] of variaveisDoQuadrante(estilo)) {
		card.style.setProperty(prop, valor);
	}
	for (const [prop, valor] of bordasDoQuadrante(estilo)) {
		card.style.setProperty(prop, valor);
	}
	card.toggleClass("is-fundo-colorido", estilo.intensidadeFundo > 0);

	if (dados.mostrarTitulos && quadrante.titulo) {
		const cabecalho = card.createDiv({ cls: "dash-home-quadrante-titulo" });
		cabecalho.toggleClass("is-colorido", estilo.tituloColorido);
		if (quadrante.icone) setIcon(cabecalho.createSpan({ cls: "dash-home-quadrante-icone" }), quadrante.icone);
		cabecalho.createSpan({ text: quadrante.titulo });
	}

	// "ambos" desenha o markdown E os botões, nessa ordem: o texto explica, os botões agem. A ordem
	// é fixa de propósito — botões acima de um parágrafo que os descreve leria ao contrário.
	// O separador já saiu no início da função, então aqui só restam botoes/markdown/ambos.
	const comMarkdown = quadrante.conteudo === "markdown" || quadrante.conteudo === "ambos";
	const comBotoes = quadrante.conteudo !== "markdown";

	if (comMarkdown) {
		renderizarMarkdown(card, quadrante, opcoes, comBotoes);
	}

	if (!comBotoes) return;

	const lista = card.createDiv({ cls: "dash-home-botoes" });
	if (quadrante.botoes.length === 0) {
		// Num quadrante que também tem texto, "sem botões" seria ruído embaixo do conteúdo dela —
		// o card já mostra alguma coisa. O aviso só vale quando o card ficaria completamente vazio.
		if (!comMarkdown) lista.createDiv({ cls: "dash-home-botao-vazio", text: "sem botões" });
		return;
	}

	// O arranjo é do conjunto, não do botão: quantos cabem por linha é propriedade da lista. Por
	// isso sai das duas camadas de cima (global → quadrante) e é aplicado no contêiner.
	const estiloBotaoDoQuadrante = estiloBotaoAtivo(quadrante.personalizaEstiloBotao, quadrante.estiloBotao);
	const arranjo = resolverArranjo(dados.estiloBotaoGlobal, estiloBotaoDoQuadrante);
	lista.addClass(`is-arranjo-${arranjo}`);
	const colunas = colunasDoArranjo(arranjo);
	if (colunas > 1) lista.style.setProperty("--dash-home-botao-colunas", String(colunas));

	// A cor do quadrante é o fallback de cada botão que não escolhe a sua — é o comportamento que
	// o plugin sempre teve, e agora é só o último degrau da herança.
	const corDoQuadrante = corCss(quadrante.cor);

	for (const botao of quadrante.botoes) {
		renderizarBotao(lista, botao, opcoes, {
			global: dados.estiloBotaoGlobal,
			doQuadrante: estiloBotaoDoQuadrante,
			corDoQuadrante,
		});
	}
}

/** As camadas de herança que o botão precisa para se desenhar. */
interface ContextoBotao {
	global: EstiloBotao | undefined;
	doQuadrante: EstiloBotao | undefined;
	/** Já em valor CSS: a cor usada quando o botão não define a sua. */
	corDoQuadrante: string;
}

/**
 * Um separador entre linhas: linha divisória, título de seção, ou só espaço em branco.
 *
 * Sempre ocupa a linha inteira (`1 / -1`) — um separador que dividisse meia largura não separaria
 * nada, e ainda deixaria o grid puxar o próximo quadrante para o lado dele. Por isso ele ignora o
 * campo `largura` em vez de respeitá-lo.
 */
function renderizarSeparador(grid: HTMLElement, quadrante: Quadrante): void {
	const cfg = quadrante.separador ?? {};
	const el = grid.createDiv({ cls: "dash-home-separador" });
	el.style.setProperty("grid-column", "1 / -1");

	const espaco = typeof cfg.espaco === "number" ? cfg.espaco : 8;
	el.style.setProperty("--dash-home-separador-espaco", `${espaco}px`);

	const texto = cfg.texto?.trim() ?? "";
	// `linha` só é falso se explicitamente desligado: um separador recém-criado tem que aparecer.
	const comLinha = cfg.linha !== false;

	el.toggleClass("is-com-linha", comLinha);
	el.toggleClass("is-com-texto", texto.length > 0);

	if (texto) el.createSpan({ cls: "dash-home-separador-texto", text: texto });
}

/**
 * Um quadrante de conteúdo livre: o markdown é renderizado pelo Obsidian, então aceita tudo que
 * uma nota aceita — texto, `![[embed]]`, blocos de Base, Dataview, callouts.
 *
 * Na miniatura mostramos só um indicativo, sem renderizar de verdade: `MarkdownRenderer.render` é
 * assíncrono e cria sub-componentes (uma Base embutida abre consultas), o que é caro demais para
 * um preview que se redesenha a cada tecla — e, sem um Component dono, vazaria.
 */
function renderizarMarkdown(
	card: HTMLElement,
	quadrante: Quadrante,
	opcoes: OpcoesRender,
	comBotoesAbaixo = false,
): void {
	const corpo = card.createDiv({ cls: "dash-home-markdown" });
	// Só quando há botões junto: a margem que separa o texto deles não deve existir quando o
	// markdown é o card inteiro.
	corpo.toggleClass("is-com-botoes", comBotoesAbaixo);
	const fonte = quadrante.markdown?.trim() ?? "";

	if (!fonte) {
		// Com botões abaixo, um texto vazio não é um card vazio: os botões já preenchem o quadrante,
		// e o aviso de "escreva algo" seria um alerta para um estado que ela pode ter escolhido.
		if (comBotoesAbaixo) {
			corpo.remove();
			return;
		}
		corpo.createDiv({
			cls: "dash-home-botao-vazio",
			text: opcoes.miniatura ? "conteúdo livre" : "Quadrante vazio — escreva algo em Configurações → Dash Cards.",
		});
		return;
	}

	if (opcoes.miniatura) {
		// Uma amostra do texto, sem renderizar: dá noção do que há ali sem o custo do render real.
		const previa = fonte.replace(/\s+/g, " ").slice(0, 120);
		corpo.createDiv({ cls: "dash-home-markdown-previa", text: previa + (fonte.length > 120 ? "…" : "") });
		return;
	}

	const { app, componente } = opcoes;
	if (!app || !componente) {
		// Sem app ou sem dono do ciclo de vida não dá para renderizar com segurança.
		corpo.createDiv({ cls: "dash-home-botao-vazio", text: fonte });
		return;
	}

	void MarkdownRenderer.render(app, fonte, corpo, opcoes.caminhoOrigem ?? "", componente);
}

function renderizarBotao(
	lista: HTMLElement,
	botao: Botao,
	opcoes: OpcoesRender,
	ctx: ContextoBotao,
): void {
	// <a> em vez de <button> para o Ctrl+clique / clique do meio abrirem em nova aba de graça —
	// é o comportamento que a usuária espera de qualquer link do Obsidian.
	const el = lista.createEl("a", { cls: "dash-home-botao", href: "#" });

	const estilo = resolverEstiloBotao(ctx.global, ctx.doQuadrante, botao.estilo);
	// A cor própria do botão vence a do quadrante — é o que permite um verde e um vermelho lado a
	// lado no mesmo card.
	const cor = estilo.cor ? corCss(estilo.cor) : ctx.corDoQuadrante;

	// setProperty escapa o valor: uma cor malformada vira declaração inválida e é ignorada.
	for (const [prop, valor] of variaveisDoBotao(estilo, cor)) {
		el.style.setProperty(prop, valor);
	}

	el.addClass(`is-pintura-${estilo.pintura}`);
	el.addClass(`is-forma-${estilo.forma}`);
	// Só a escolha explícita vira classe: "auto" é a ausência de regra, o comportamento de sempre.
	el.toggleClass("is-letra-texto", estilo.corLetra === "texto");
	el.toggleClass("is-destaque", estilo.destaque);

	const soIcone = ehSoIcone(estilo);
	// Um botão só de ícone sem ícone nenhum seria um quadrado vazio e sem sentido: nesse caso o
	// texto volta, porque é a única coisa que identifica o botão.
	const mostrarSoIcone = soIcone && !!botao.icone;
	el.toggleClass("is-so-icone", mostrarSoIcone);

	if (botao.icone) setIcon(el.createSpan({ cls: "dash-home-botao-icone" }), botao.icone);

	if (mostrarSoIcone) {
		// O nome vira tooltip: sem texto na tela, é o que diz para onde o botão leva.
		el.setAttribute("aria-label", botao.texto || "(sem nome)");
		el.setAttribute("title", botao.texto || "(sem nome)");
	} else {
		el.createSpan({ cls: "dash-home-botao-texto", text: botao.texto || "(sem nome)" });
	}

	if (opcoes.miniatura) {
		// Sem listener e sem href real: na miniatura o botão é uma imagem do que vai existir.
		el.removeAttribute("href");
		el.addClass("is-inerte");
		return;
	}

	const app = opcoes.app;
	if (!app) return;

	el.addEventListener("click", (evento) => {
		evento.preventDefault();
		// Ctrl (ou Cmd no Mac) e clique do meio abrem em aba nova, como no resto do Obsidian.
		const novaAba = evento.ctrlKey || evento.metaKey;
		void executarAcao(app, botao, novaAba);
	});

	el.addEventListener("auxclick", (evento) => {
		if (evento.button !== 1) return;
		evento.preventDefault();
		void executarAcao(app, botao, true);
	});
}
