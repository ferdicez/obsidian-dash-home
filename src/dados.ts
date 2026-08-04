import type { Plugin } from "obsidian";
import type { EstiloQuadrante } from "./estilo";

/**
 * Dados persistidos do plugin (data.json): os dashboards que a usuária montou nas configurações.
 * Nada aqui depende do DOM — é o modelo puro.
 *
 * ── Por que o data.json guarda o layout se o dashboard é uma nota? ────────────────────────
 *
 * A nota é a *saída*: o plugin a gera e reescreve a cada salvamento (ver `nota.ts`). O data.json
 * é a *fonte*, porque é dele que o painel de configurações lê para montar os formulários. Ler de
 * volta do YAML daria no mesmo, mas exigiria um parser tolerante a nota editada à mão — e a
 * usuária não edita a nota, esse é o ponto do plugin.
 *
 * Consequência assumida: se o data.json sumir, os dashboards precisam ser remontados. Em troca,
 * as notas geradas continuam lá e continuam legíveis (o bloco vira texto YAML visível).
 */

/** O que um botão faz ao ser clicado. */
export type TipoAcao = "nota" | "pasta" | "busca" | "comando";

export interface Botao {
	id: string;
	texto: string;
	/** id completo do ícone Lucide ("lucide-star"), ou undefined para botão sem ícone. */
	icone?: string;
	tipo: TipoAcao;
	/**
	 * O destino, interpretado conforme `tipo`:
	 * - nota: caminho do arquivo ("Clientes/Índice.md")
	 * - pasta: caminho da pasta ("Clientes")
	 * - busca: a query de busca ("tag:#cliente")
	 * - comando: id do comando ("my-tasks:abrir-kanban")
	 */
	destino: string;
}

export interface Quadrante {
	id: string;
	titulo: string;
	icone?: string;
	/**
	 * A cor do quadrante. Aceita duas formas:
	 * - nome de cor do tema (chave de CORES): "azul", "verde"…
	 * - hex livre "#rrggbb" — inclusive vindo da paleta do plugin Customize
	 * `undefined` usa a cor de destaque do tema.
	 */
	cor?: string;
	/** Aparência só deste quadrante; o que não define, herda do estilo global. */
	estilo?: EstiloQuadrante;
	/**
	 * Quantas colunas do grid este quadrante ocupa. `undefined` = 1 (o padrão).
	 * "cheio" ocupa a linha inteira, seja qual for o número de colunas do dashboard.
	 *
	 * É isto que permite "três em cima, um largo embaixo" ou "dois em cima, três embaixo":
	 * o grid tem N colunas fixas e cada quadrante decide a sua fatia.
	 */
	largura?: number | "cheio";
	/**
	 * O que o quadrante mostra. `undefined` = "botoes" (o padrão, e o que todo quadrante
	 * existente antes desta funcionalidade era).
	 */
	conteudo?: "botoes" | "markdown";
	/**
	 * O markdown do quadrante, quando `conteudo === "markdown"`. Renderizado pelo Obsidian, então
	 * aceita tudo que uma nota aceita: texto, `![[embed]]`, blocos de Base, Dataview, callouts.
	 */
	markdown?: string;
	botoes: Botao[];
}

export interface Dashboard {
	id: string;
	nome: string;
	/** Caminho da nota gerada, com extensão ("Home.md"). */
	caminhoNota: string;
	/** Quantas colunas o grid tem em tela larga. Entre 1 e 4. */
	colunas: number;
	/**
	 * Largura do dashboard na nota:
	 * - "leitura": respeita a largura de leitura do Obsidian (padrão)
	 * - "total": ocupa toda a largura disponível, ignorando a largura de leitura
	 * - número: largura máxima em px
	 */
	largura: "leitura" | "total" | number;
	quadrantes: Quadrante[];
}

export interface DadosDashHome {
	dashboards: Dashboard[];
	/** id do dashboard que o painel de configurações está editando. */
	dashboardAtivoId: string;
	/** Tamanho dos botões no dashboard renderizado. */
	tamanhoBotao: "pequeno" | "medio" | "grande";
	/** Mostrar o título do quadrante acima dos botões. */
	mostrarTitulos: boolean;
	/** Aparência aplicada a todos os quadrantes, salvo o que cada um sobrescrever. */
	estiloGlobal: EstiloQuadrante;
}

/**
 * As cores disponíveis para os quadrantes. Os valores são variáveis do tema do Obsidian, não hex
 * fixo: assim o dashboard acompanha o tema claro/escuro da usuária sem precisar de dois conjuntos.
 */
export const CORES: Record<string, string> = {
	vermelho: "var(--color-red)",
	laranja: "var(--color-orange)",
	amarelo: "var(--color-yellow)",
	verde: "var(--color-green)",
	turquesa: "var(--color-cyan)",
	azul: "var(--color-blue)",
	roxo: "var(--color-purple)",
	rosa: "var(--color-pink)",
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A cor de um quadrante como valor CSS. Aceita nome do tema ("azul") ou hex livre ("#e03131"),
 * e cai na cor de destaque quando não reconhece — nunca devolve valor inválido, porque isso
 * derrubaria a variável e deixaria o card sem cor nenhuma.
 */
export function corCss(cor: string | undefined): string {
	if (!cor) return "var(--interactive-accent)";
	const limpa = cor.trim();
	if (CORES[limpa]) return CORES[limpa];
	if (HEX.test(limpa)) return limpa.toLowerCase();
	return "var(--interactive-accent)";
}

/** true se a cor é um hex livre (e não um nome do tema). */
export function ehHex(cor: string | undefined): boolean {
	return !!cor && HEX.test(cor.trim());
}

export const DASHBOARD_PADRAO_ID = "principal";

export const DADOS_PADRAO: DadosDashHome = {
	dashboards: [
		{
			id: DASHBOARD_PADRAO_ID,
			// "Dash Home" é o plugin; a nota se chama "Home" porque é o que ela é para a usuária.
			nome: "Home",
			caminhoNota: "Home.md",
			colunas: 3,
			largura: "leitura",
			quadrantes: [],
		},
	],
	dashboardAtivoId: DASHBOARD_PADRAO_ID,
	tamanhoBotao: "medio",
	mostrarTitulos: true,
	estiloGlobal: {},
};

/** Devolvido quando não há dashboard nenhum. Congelado: ninguém escreve nele por acidente. */
const DASHBOARD_VAZIO: Dashboard = Object.freeze({
	id: "",
	nome: "",
	caminhoNota: "",
	colunas: 3,
	largura: "leitura",
	quadrantes: Object.freeze([]) as unknown as Quadrante[],
});

/**
 * Quantas colunas um quadrante pode ocupar: de 1 até o total do dashboard, ou "cheio".
 *
 * O teto importa: um `grid-column: span 3` num grid de 2 colunas faz o CSS criar uma terceira
 * coluna implícita, e o layout inteiro se desfaz. Como o número de colunas do dashboard pode
 * diminuir depois que a largura foi escolhida, a checagem roda a cada carga.
 *
 * `undefined` (o padrão, 1 coluna) é preservado como `undefined` — não gravamos o padrão.
 */
export function limitarLarguraQuadrante(
	valor: unknown,
	colunasDoDashboard: number,
): number | "cheio" | undefined {
	if (valor === "cheio") return "cheio";
	if (typeof valor !== "number" || !Number.isFinite(valor)) return undefined;
	const n = Math.round(valor);
	if (n <= 1) return undefined;
	// Ocupar todas as colunas É "cheio" — normalizar evita dois estados com o mesmo resultado.
	if (n >= colunasDoDashboard) return "cheio";
	return n;
}

/**
 * Largura em px permitida. Abaixo de 400 o grid não cabe; acima de 1600 não há tela onde a
 * diferença apareça — e um valor maior que a janela dá a impressão de que a configuração não
 * funcionou (o CSS trava em `max-width: 100%` de qualquer forma).
 */
export function limitarLargura(valor: unknown): "leitura" | "total" | number {
	if (valor === "total" || valor === "leitura") return valor;
	if (typeof valor === "number" && Number.isFinite(valor)) {
		return Math.min(1600, Math.max(400, Math.round(valor)));
	}
	return "leitura";
}

export async function carregarDados(plugin: Plugin): Promise<DadosDashHome> {
	const data = await plugin.loadData();
	// Object.assign raso (padrão dos outros plugins do vault): um campo novo adicionado ao
	// DADOS_PADRAO nasce preenchido mesmo em data.json antigos.
	const dados = Object.assign({}, DADOS_PADRAO, data) as DadosDashHome;

	// Blindagens contra data.json corrompido ou editado à mão. O painel de configurações itera
	// sobre tudo isto sem checar de novo, então a normalização acontece aqui, uma vez só.
	if (!Array.isArray(dados.dashboards)) dados.dashboards = [clonarDashboard(DADOS_PADRAO.dashboards[0])];
	dados.dashboards = dados.dashboards.filter((d) => d && typeof d.id === "string");
	if (dados.dashboards.length === 0) dados.dashboards = [clonarDashboard(DADOS_PADRAO.dashboards[0])];

	// `estiloGlobal` é aninhado e o Object.assign acima é raso: um data.json salvo antes desta
	// funcionalidade viria sem ele.
	if (!dados.estiloGlobal || typeof dados.estiloGlobal !== "object") dados.estiloGlobal = {};

	for (const dash of dados.dashboards) {
		dash.colunas = limitarColunas(dash.colunas);
		dash.largura = limitarLargura(dash.largura);
		if (typeof dash.caminhoNota !== "string" || !dash.caminhoNota) dash.caminhoNota = `${dash.nome || "Home"}.md`;
		if (!Array.isArray(dash.quadrantes)) dash.quadrantes = [];
		for (const quad of dash.quadrantes) {
			if (quad.estilo && typeof quad.estilo !== "object") delete quad.estilo;
			quad.largura = limitarLarguraQuadrante(quad.largura, dash.colunas);
			if (!Array.isArray(quad.botoes)) quad.botoes = [];
			// Um tipo desconhecido viraria um botão que não faz nada ao clicar; "nota" é o
			// fallback seguro (no pior caso avisa que a nota não existe).
			for (const botao of quad.botoes) {
				if (!TIPOS_VALIDOS.has(botao.tipo)) botao.tipo = "nota";
			}
		}
	}

	return dados;
}

const TIPOS_VALIDOS = new Set<string>(["nota", "pasta", "busca", "comando"]);

export async function salvarDados(plugin: Plugin, dados: DadosDashHome): Promise<void> {
	await plugin.saveData(dados);
}

/**
 * Colunas da grade de base: 1 a 6.
 *
 * O teto é 6 (e não 4) porque a grade não é "quantos quadrantes cabem por linha" — é a unidade
 * que os quadrantes fatiam. Linhas desiguais como "2 em cima, 3 embaixo" precisam de 6, que é o
 * mínimo múltiplo comum de 2 e 3.
 */
export function limitarColunas(n: unknown): number {
	const valor = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 3;
	return Math.min(6, Math.max(1, valor));
}

function clonarDashboard(d: Dashboard): Dashboard {
	return { ...d, quadrantes: d.quadrantes.map((q) => ({ ...q, botoes: q.botoes.map((b) => ({ ...b })) })) };
}

/**
 * O dashboard em edição. Nunca lança e nunca devolve undefined: se o ativo foi excluído, cai no
 * primeiro da lista; se não há nenhum, devolve o vazio.
 */
export function dashboardAtivo(dados: DadosDashHome): Dashboard {
	return dados.dashboards.find((d) => d.id === dados.dashboardAtivoId) ?? dados.dashboards[0] ?? DASHBOARD_VAZIO;
}

export function novoId(prefixo: string): string {
	return `${prefixo}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function criarDashboard(dados: DadosDashHome, nome: string): Dashboard {
	const limpo = nome.trim() || "Novo dashboard";
	const dashboard: Dashboard = {
		id: novoId("d"),
		nome: limpo,
		caminhoNota: caminhoLivre(dados, `${limpo}.md`),
		colunas: 3,
		largura: "leitura",
		quadrantes: [],
	};
	dados.dashboards.push(dashboard);
	return dashboard;
}

/**
 * Um caminho de nota que nenhum outro dashboard já usa. Dois dashboards apontando para a mesma
 * nota fariam um sobrescrever o outro a cada salvamento — silenciosamente, que é o pior jeito.
 */
function caminhoLivre(dados: DadosDashHome, desejado: string): string {
	const emUso = new Set(dados.dashboards.map((d) => d.caminhoNota.toLowerCase()));
	if (!emUso.has(desejado.toLowerCase())) return desejado;
	const base = desejado.replace(/\.md$/i, "");
	for (let i = 2; i < 100; i++) {
		const tentativa = `${base} ${i}.md`;
		if (!emUso.has(tentativa.toLowerCase())) return tentativa;
	}
	return `${base} ${novoId("n")}.md`;
}

/**
 * Remove o dashboard e reaponta o ativo se for preciso — o data.json nunca guarda id órfão.
 * Recusa remover o último: "nenhum dashboard" é um estado que a UI não precisa saber representar.
 * Não apaga a nota gerada: apagar arquivo da usuária sem ela pedir é destrutivo demais.
 */
export function removerDashboard(dados: DadosDashHome, id: string): boolean {
	if (dados.dashboards.length <= 1) return false;
	const i = dados.dashboards.findIndex((d) => d.id === id);
	if (i < 0) return false;
	dados.dashboards.splice(i, 1);
	if (dados.dashboardAtivoId === id) dados.dashboardAtivoId = dados.dashboards[0].id;
	return true;
}

export function criarQuadrante(dashboard: Dashboard, titulo: string): Quadrante {
	const quadrante: Quadrante = {
		id: novoId("q"),
		titulo: titulo.trim() || "Novo quadrante",
		botoes: [],
	};
	dashboard.quadrantes.push(quadrante);
	return quadrante;
}

export function criarBotao(quadrante: Quadrante, texto: string): Botao {
	const botao: Botao = {
		id: novoId("b"),
		texto: texto.trim() || "Novo botão",
		tipo: "nota",
		destino: "",
	};
	quadrante.botoes.push(botao);
	return botao;
}

/** Reordena um item dentro de uma lista (delta -1 = sobe, +1 = desce). Ignora movimentos fora da lista. */
export function mover<T>(lista: T[], indice: number, delta: number): void {
	const destino = indice + delta;
	if (destino < 0 || destino >= lista.length) return;
	const [item] = lista.splice(indice, 1);
	lista.splice(destino, 0, item);
}
