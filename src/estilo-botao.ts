/**
 * A aparência dos botões: formato, cor, e como eles se arrumam dentro do quadrante.
 *
 * Segue exatamente o desenho de `estilo.ts` (que por sua vez segue o dos callouts do Customize):
 * todo campo é opcional e `undefined` significa "não decide nada, herda".
 *
 * ── A diferença: aqui a herança tem TRÊS camadas ─────────────────────────────────────────
 *
 *     global (dados.estiloBotaoGlobal)  →  quadrante (quadrante.estiloBotao)  →  botão (botao.estilo)
 *
 * O estilo do quadrante já tinha duas (global → quadrante). A terceira existe porque a usuária
 * pediu cor por botão: "no mesmo quadrante, um verde e um vermelho". Sem a camada do botão, isso
 * exigiria um quadrante por cor.
 *
 * ⚠️ Lição da sessão 11 (a barra que não era removida): herança invisível parece bug. Um botão com
 * valor próprio ignora o quadrante em silêncio, e a usuária mexe no controle de cima e "não
 * acontece nada". Por isso `quemDefine()` existe — o painel usa para dizer, em cada controle, de
 * onde o valor está vindo.
 */

/** Como os botões se arrumam dentro do quadrante. */
export type ArranjoBotoes = "coluna" | "grade2" | "grade3" | "chips";

/** O formato do botão. */
export type FormaBotao = "retangulo" | "pilula" | "quadrado";

/** Onde o conteúdo do botão fica na horizontal. */
export type AlinhamentoBotao = "esquerda" | "centro";

/** Como a cor entra no botão. */
export type PinturaBotao = "neutro" | "fundo" | "contorno" | "solido";

export interface EstiloBotao {
	/**
	 * Como os botões se arrumam. Só faz sentido no nível do quadrante ou global — um botão
	 * sozinho não decide o arranjo da lista em que está. Ver `resolverArranjo()`.
	 */
	arranjo?: ArranjoBotoes;
	/** Formato do botão. "quadrado" é o botão só de ícone, que ignora o texto. */
	forma?: FormaBotao;
	/** Raio das quinas em px. Ignorado quando `forma` é "pilula" ou "quadrado". */
	radius?: number;
	/** Espaçamento interno vertical em px — na prática, a altura do botão. */
	altura?: number;
	/** Tamanho do ícone em px. */
	tamanhoIcone?: number;
	/** Tamanho da letra em px. */
	tamanhoFonte?: number;
	/** Alinhamento do conteúdo. */
	alinhamento?: AlinhamentoBotao;
	/** Como a cor pinta o botão. */
	pintura?: PinturaBotao;
	/**
	 * A cor deste botão. Mesmo formato de `Quadrante.cor`: nome do tema ("azul") ou hex livre.
	 * `undefined` usa a cor do quadrante — que é o comportamento que o plugin sempre teve.
	 */
	cor?: string;
	/** Botão em destaque: pesa mais que os vizinhos (fonte em negrito e cor cheia). */
	destaque?: boolean;
	/** Esconder o texto, deixando só o ícone. Distinto de `forma: "quadrado"`, que também muda o formato. */
	soIcone?: boolean;
}

/**
 * O padrão de fábrica — o visual que os botões tinham antes de existir esta customização.
 *
 * Dois campos têm `undefined` como padrão, porque o valor deles não é conhecido AQUI:
 * - `cor`: sem valor próprio, o botão usa a cor do quadrante (quem resolve é o render).
 * - `tamanhoFonte`: sem valor próprio, a letra vem do dropdown "Tamanho dos botões" (que é CSS,
 *   em `--font-ui-*`). Fixar um px aqui faria os três tamanhos pararem de mexer na letra —
 *   mudando, em silêncio, dashboards já configurados.
 */
export const ESTILO_BOTAO_PADRAO: Required<Omit<EstiloBotao, "cor" | "tamanhoFonte">> & {
	cor: string | undefined;
	tamanhoFonte: number | undefined;
} = {
	arranjo: "coluna",
	forma: "retangulo",
	radius: 4,
	altura: 8,
	tamanhoIcone: 16,
	tamanhoFonte: undefined,
	alinhamento: "esquerda",
	pintura: "neutro",
	cor: undefined,
	destaque: false,
	soIcone: false,
};

export type EstiloBotaoResolvido = typeof ESTILO_BOTAO_PADRAO;

/**
 * Aplica a herança das três camadas. O que a camada de cima não define, vem da de baixo:
 * padrão de fábrica → global → quadrante → botão.
 */
export function resolverEstiloBotao(
	global: EstiloBotao | undefined,
	doQuadrante: EstiloBotao | undefined,
	doBotao: EstiloBotao | undefined,
): EstiloBotaoResolvido {
	return {
		...ESTILO_BOTAO_PADRAO,
		...limparIndefinidos(global ?? {}),
		...limparIndefinidos(doQuadrante ?? {}),
		...limparIndefinidos(doBotao ?? {}),
	};
}

/**
 * De qual camada vem o valor de um campo. O painel usa isto para nunca deixar a usuária mexendo
 * num controle que está sendo ignorado por uma camada acima — o bug da sessão 11.
 */
export type Camada = "padrao" | "global" | "quadrante" | "botao";

export function quemDefine(
	campo: keyof EstiloBotao,
	global: EstiloBotao | undefined,
	doQuadrante: EstiloBotao | undefined,
	doBotao: EstiloBotao | undefined,
): Camada {
	if (doBotao?.[campo] !== undefined) return "botao";
	if (doQuadrante?.[campo] !== undefined) return "quadrante";
	if (global?.[campo] !== undefined) return "global";
	return "padrao";
}

/** Remove chaves `undefined` para o spread não apagar o que veio da camada de baixo. */
function limparIndefinidos(e: EstiloBotao): EstiloBotao {
	const saida: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(e)) {
		if (v !== undefined) saida[k] = v;
	}
	return saida as EstiloBotao;
}

/**
 * O arranjo é do CONJUNTO, não do botão: quantos cabem por linha é uma propriedade da lista.
 * Um `arranjo` definido no estilo de um botão individual seria contraditório (dois botões da
 * mesma lista pedindo arranjos diferentes), então ele é lido só das duas camadas de cima.
 */
export function resolverArranjo(
	global: EstiloBotao | undefined,
	doQuadrante: EstiloBotao | undefined,
): ArranjoBotoes {
	return doQuadrante?.arranjo ?? global?.arranjo ?? ESTILO_BOTAO_PADRAO.arranjo;
}

/** Quantas colunas o arranjo tem. `chips` flui (não é grade), então vale 0. */
export function colunasDoArranjo(arranjo: ArranjoBotoes): number {
	if (arranjo === "grade2") return 2;
	if (arranjo === "grade3") return 3;
	return arranjo === "coluna" ? 1 : 0;
}

/**
 * As variáveis CSS de um botão, para aplicar via style inline.
 *
 * Pares [propriedade, valor] em vez de string: quem chama usa `style.setProperty`, que escapa o
 * valor — uma cor malformada vira declaração inválida e é ignorada, nunca regra injetada.
 *
 * `cor` chega já resolvida como valor CSS (a do botão, ou a do quadrante se ele não define).
 */
export function variaveisDoBotao(estilo: EstiloBotaoResolvido, cor: string): Array<[string, string]> {
	const vars: Array<[string, string]> = [
		["--dash-home-botao-cor", cor],
		["--dash-home-botao-altura", `${estilo.altura}px`],
		["--dash-home-botao-icone", `${estilo.tamanhoIcone}px`],
		["--dash-home-botao-radius", raioDaForma(estilo)],
		["--dash-home-botao-alinha", estilo.alinhamento === "centro" ? "center" : "flex-start"],
	];

	// Só quando há valor próprio: sem a variável, o CSS cai no `font-size` herdado — que é o que
	// o dropdown "Tamanho dos botões" define. Emitir um padrão aqui tiraria o efeito daquele
	// controle sem ninguém ter pedido.
	if (typeof estilo.tamanhoFonte === "number") {
		vars.push(["--dash-home-botao-fonte", `${estilo.tamanhoFonte}px`]);
	}

	// O fundo tingido usa `color-mix` pelo mesmo motivo do quadrante: resolve a diluição sem
	// precisar do triplet RGB, e funciona tanto para cor do tema quanto para hex da paleta.
	if (estilo.pintura === "fundo") {
		const pct = estilo.destaque ? 28 : 14;
		vars.push([
			"--dash-home-botao-fundo",
			`color-mix(in srgb, var(--dash-home-botao-cor) ${pct}%, var(--background-primary))`,
		]);
	}

	return vars;
}

/**
 * O raio efetivo. "pilula" usa um valor grande o bastante para arredondar por completo qualquer
 * altura (999px é o truque usual — o navegador satura no meio da menor dimensão), e "quadrado"
 * mantém o raio configurado, porque um botão de ícone quadrado ainda pode ter quinas suaves.
 */
function raioDaForma(estilo: EstiloBotaoResolvido): string {
	if (estilo.forma === "pilula") return "999px";
	return `${estilo.radius}px`;
}

/** true quando o botão mostra só o ícone — `soIcone` explícito ou a forma quadrada, que o implica. */
export function ehSoIcone(estilo: EstiloBotaoResolvido): boolean {
	return estilo.soIcone || estilo.forma === "quadrado";
}

/**
 * Faixas dos controles numéricos, num lugar só: o painel e a normalização do data.json precisam
 * concordar, e duplicar os números faria um aceitar o que o outro corta.
 */
export const FAIXAS = {
	radius: { min: 0, max: 24 },
	altura: { min: 2, max: 24 },
	tamanhoIcone: { min: 10, max: 32 },
	// Abaixo de 9px o texto fica ilegível; acima de 28 o botão vira título.
	tamanhoFonte: { min: 9, max: 28 },
} as const;

const ARRANJOS = new Set<string>(["coluna", "grade2", "grade3", "chips"]);
const FORMAS = new Set<string>(["retangulo", "pilula", "quadrado"]);
const ALINHAMENTOS = new Set<string>(["esquerda", "centro"]);
const PINTURAS = new Set<string>(["neutro", "fundo", "contorno", "solido"]);

/**
 * Blindagem contra data.json corrompido ou editado à mão. Roda na carga, uma vez só — o painel e
 * o render iteram sobre isto sem checar de novo.
 *
 * Campo inválido é REMOVIDO, não corrigido para um padrão: remover devolve o campo à herança, que
 * é o estado neutro. Corrigir para um valor concreto prenderia a camada num valor que a usuária
 * nunca escolheu — exatamente o que causou o bug da sessão 11.
 */
export function normalizarEstiloBotao(valor: unknown): EstiloBotao | undefined {
	if (!valor || typeof valor !== "object") return undefined;
	const e = valor as Record<string, unknown>;
	const saida: EstiloBotao = {};

	if (typeof e.arranjo === "string" && ARRANJOS.has(e.arranjo)) saida.arranjo = e.arranjo as ArranjoBotoes;
	if (typeof e.forma === "string" && FORMAS.has(e.forma)) saida.forma = e.forma as FormaBotao;
	if (typeof e.alinhamento === "string" && ALINHAMENTOS.has(e.alinhamento)) {
		saida.alinhamento = e.alinhamento as AlinhamentoBotao;
	}
	if (typeof e.pintura === "string" && PINTURAS.has(e.pintura)) saida.pintura = e.pintura as PinturaBotao;
	if (typeof e.cor === "string" && e.cor.trim()) saida.cor = e.cor.trim();
	// `typeof`, não truthiness: `false` é uma escolha válida (desligar o destaque herdado).
	if (typeof e.destaque === "boolean") saida.destaque = e.destaque;
	if (typeof e.soIcone === "boolean") saida.soIcone = e.soIcone;

	for (const campo of ["radius", "altura", "tamanhoIcone", "tamanhoFonte"] as const) {
		const bruto = e[campo];
		// Idem: `radius: 0` (sem arredondamento) é escolha válida e um teste de verdade a descartaria.
		if (typeof bruto !== "number" || !Number.isFinite(bruto)) continue;
		const faixa = FAIXAS[campo];
		saida[campo] = Math.min(faixa.max, Math.max(faixa.min, Math.round(bruto)));
	}

	// Objeto vazio é o mesmo que não ter estilo: devolver `undefined` evita gravar `{}` no
	// data.json e no bloco da nota para todo botão que nunca foi customizado.
	return Object.keys(saida).length > 0 ? saida : undefined;
}
