import { setIcon } from "obsidian";

/**
 * Seção recolhível no estilo do painel de configurações do My Tasks — que é o padrão que a
 * usuária pediu explicitamente ("use o estilo que você fez nas configurações do My Tasks").
 *
 * Portado de `my-tasks/src/acordeao.ts`. Duas diferenças importantes em relação à versão
 * ingênua que este plugin tinha antes:
 *
 * 1. **Abrir/fechar não redesenha a tela.** O clique só troca classes CSS. A versão anterior
 *    chamava `atualizar()`, que recriava o painel inteiro — perdendo foco de campo e posição de
 *    scroll a cada clique.
 * 2. **O conteúdo fechado não é desenhado.** `sePreenchido` adia o desenho até a primeira
 *    abertura; seções caras (que varrem o vault) não pagam custo enquanto estão fechadas.
 */

/**
 * Estado de aberto/fechado por chave. Vive no MÓDULO, não na instância do painel, porque
 * `display()` reconstrói a tela inteira a cada gravação: sem isso, mexer em qualquer campo
 * dentro de um acordeão o fecharia na cara dela no meio da edição.
 */
const abertos = new Map<string, boolean>();

export interface OpcoesAcordeao {
	/**
	 * Chave estável para lembrar aberto/fechado entre redesenhos. Precisa ser única na tela e
	 * não pode depender de índice de lista — senão reordenar embaralha o estado.
	 */
	chave: string;
	titulo: string;
	descricao?: string;
	/** Texto curto à direita do título (ex.: "3 botões"). */
	resumo?: string;
	/** Começa aberto na PRIMEIRA vez que aparece; depois vale o que a usuária deixou. */
	abertoPorPadrao?: boolean;
	/** Acordeão aninhado: recua e afina o título, para o nível de dentro não competir com o de fora. */
	aninhado?: boolean;
}

export interface Acordeao {
	/** A seção inteira — use para pendurar botões de ação no cabeçalho. */
	secao: HTMLElement;
	/** O cabeçalho clicável, onde ações extras podem ser inseridas. */
	cabecalho: HTMLElement;
	/** Onde o conteúdo da seção é desenhado. */
	corpo: HTMLElement;
	/** Chamado só quando a seção está ABERTA (ou na primeira abertura). */
	sePreenchido: (desenhar: (corpo: HTMLElement) => void) => void;
}

export function criarAcordeao(container: HTMLElement, opcoes: OpcoesAcordeao): Acordeao {
	const aberto = abertos.get(opcoes.chave) ?? opcoes.abertoPorPadrao ?? false;
	abertos.set(opcoes.chave, aberto);

	const secao = container.createDiv({ cls: "dash-home-acordeao" });
	if (opcoes.aninhado) secao.addClass("dash-home-acordeao-aninhado");
	secao.toggleClass("dash-home-acordeao-aberto", aberto);

	// <button> de propósito: dá foco por teclado e Enter/Espaço de graça, que uma <div> não tem.
	const cabecalho = secao.createEl("button", {
		cls: "dash-home-acordeao-cabecalho",
		attr: { "aria-expanded": String(aberto) },
	});

	const seta = cabecalho.createSpan({ cls: "dash-home-acordeao-seta" });
	setIcon(seta, "chevron-right");

	const textos = cabecalho.createDiv({ cls: "dash-home-acordeao-textos" });
	textos.createSpan({ cls: "dash-home-acordeao-titulo", text: opcoes.titulo });
	if (opcoes.descricao) {
		textos.createDiv({ cls: "dash-home-acordeao-descricao", text: opcoes.descricao });
	}
	if (opcoes.resumo) {
		cabecalho.createSpan({ cls: "dash-home-acordeao-resumo", text: opcoes.resumo });
	}

	const corpo = secao.createDiv({ cls: "dash-home-acordeao-corpo" });
	if (!aberto) corpo.addClass("dash-home-oculto");

	// Guarda o desenhador para a primeira abertura, quando a seção nasce fechada. Declarado ANTES
	// do listener que o usa — `let` não sofre hoisting de valor.
	let desenharPendente: ((corpo: HTMLElement) => void) | null = null;

	cabecalho.addEventListener("click", (evento) => {
		// Botões de ação dentro do cabeçalho (subir, descer, excluir) não devem abrir/fechar.
		if ((evento.target as HTMLElement).closest(".dash-home-acordeao-acoes")) return;

		const novoEstado = !(abertos.get(opcoes.chave) ?? false);
		abertos.set(opcoes.chave, novoEstado);
		secao.toggleClass("dash-home-acordeao-aberto", novoEstado);
		corpo.toggleClass("dash-home-oculto", !novoEstado);
		cabecalho.setAttr("aria-expanded", String(novoEstado));

		if (novoEstado && desenharPendente) {
			const desenhar = desenharPendente;
			desenharPendente = null;
			desenhar(corpo);
		}
	});

	return {
		secao,
		cabecalho,
		corpo,
		sePreenchido: (desenhar) => {
			if (aberto) {
				desenhar(corpo);
				return;
			}
			desenharPendente = desenhar;
		},
	};
}

/**
 * Marca um acordeão como aberto ANTES de ele ser desenhado. Usado ao criar um item novo (um
 * quadrante, por exemplo): ele nasce expandido e pronto para ser preenchido, em vez de fechado
 * no fim da lista.
 */
export function abrirAcordeao(chave: string): void {
	abertos.set(chave, true);
}
