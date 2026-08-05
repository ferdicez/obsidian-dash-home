/**
 * A aparência dos quadrantes: onde a cor aparece, quanto arredonda, quão grossa é a barra.
 *
 * Segue o mesmo desenho do estilo de callout do plugin Customize: todo campo é opcional, e
 * `undefined` significa "não decide nada, herda". Há um estilo global (vale para todos os
 * quadrantes) e um por quadrante, que sobrescreve o global campo a campo.
 *
 * Ao contrário dos callouts, aqui não estamos lutando com o CSS do Obsidian — o HTML é nosso.
 * Por isso o CSS gerado é direto: variáveis próprias num style inline, sem guerra de
 * especificidade e sem as armadilhas de triplet RGB que assombram `callouts.ts`.
 */

/** Onde a cor do quadrante aparece. */
export type PosicaoBarra = "topo" | "esquerda" | "direita" | "baixo" | "volta" | "nenhuma";

export interface EstiloQuadrante {
	/** Onde a barra colorida fica. "volta" = borda inteira; "nenhuma" = sem barra. */
	posicaoBarra?: PosicaoBarra;
	/** Espessura da barra em px. */
	espessuraBarra?: number;
	/** Raio das quinas em px. */
	radius?: number;
	/** Intensidade do fundo colorido (0 = fundo neutro do tema, 1 = cor cheia). */
	intensidadeFundo?: number;
	/** Espaçamento interno em px. */
	padding?: number;
	/** Pintar o título com a cor do quadrante. */
	tituloColorido?: boolean;
	/** Tamanho do ícone do título em px. */
	tamanhoIcone?: number;
}

/** O padrão de fábrica — o visual que o plugin tinha antes de existir customização. */
export const ESTILO_PADRAO: Required<EstiloQuadrante> = {
	posicaoBarra: "topo",
	espessuraBarra: 3,
	radius: 8,
	intensidadeFundo: 0,
	padding: 14,
	tituloColorido: false,
	tamanhoIcone: 16,
};

/**
 * O estilo que o quadrante REALMENTE aplica, considerando a chave "personalizar ou herdar".
 *
 * Um quadrante que herda tem os ajustes dele preservados em `estilo` (para não perder trabalho ao
 * alternar), mas eles ficam adormecidos: quem desenha precisa ver `undefined`, senão os valores
 * guardados vazariam para o dashboard e "herdar do global" não herdaria nada.
 *
 * É o ponto único onde a flag é interpretada — render, nota e painel passam todos por aqui.
 */
export function estiloAtivo(
	personaliza: boolean | undefined,
	estilo: EstiloQuadrante | undefined,
): EstiloQuadrante | undefined {
	return personaliza ? estilo : undefined;
}

/** Aplica a herança: o que o estilo do quadrante não define, vem do global. */
export function resolverEstilo(
	global: EstiloQuadrante | undefined,
	especifico: EstiloQuadrante | undefined,
): Required<EstiloQuadrante> {
	return {
		...ESTILO_PADRAO,
		...limparIndefinidos(global ?? {}),
		...limparIndefinidos(especifico ?? {}),
	};
}

/** Remove chaves `undefined` para o spread não apagar o que veio da camada de baixo. */
function limparIndefinidos(e: EstiloQuadrante): EstiloQuadrante {
	const saida: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(e)) {
		if (v !== undefined) saida[k] = v;
	}
	return saida as EstiloQuadrante;
}

/** Qual lado do card recebe a barra, por posição. */
const LADO: Record<PosicaoBarra, string | null> = {
	topo: "border-top",
	esquerda: "border-left",
	direita: "border-right",
	baixo: "border-bottom",
	volta: null, // tratado à parte: borda inteira
	nenhuma: null,
};

/**
 * As variáveis CSS de um quadrante, para aplicar via style inline no elemento.
 *
 * Devolve pares [propriedade, valor] em vez de uma string: quem chama usa
 * `style.setProperty`, que escapa o valor — nada aqui vira texto CSS concatenado, então
 * uma cor malformada não consegue injetar regra nenhuma.
 */
export function variaveisDoQuadrante(estilo: Required<EstiloQuadrante>): Array<[string, string]> {
	const vars: Array<[string, string]> = [
		["--dash-home-radius", `${estilo.radius}px`],
		["--dash-home-padding", `${estilo.padding}px`],
		["--dash-home-icone", `${estilo.tamanhoIcone}px`],
		["--dash-home-espessura", `${estilo.espessuraBarra}px`],
	];

	// O fundo é a cor do quadrante diluída no fundo do tema. `color-mix` resolve isso sem
	// precisar do triplet RGB — e como a cor entra por variável, funciona tanto para as cores
	// do tema quanto para um hex da paleta dela.
	if (estilo.intensidadeFundo > 0) {
		const pct = Math.round(estilo.intensidadeFundo * 100);
		vars.push([
			"--dash-home-fundo",
			`color-mix(in srgb, var(--dash-home-cor) ${pct}%, var(--background-secondary))`,
		]);
	}

	return vars;
}

/** As regras de borda, que dependem da posição escolhida. */
export function bordasDoQuadrante(estilo: Required<EstiloQuadrante>): Array<[string, string]> {
	const espessura = `${estilo.espessuraBarra}px`;

	if (estilo.posicaoBarra === "nenhuma") {
		return [["border", "1px solid var(--background-modifier-border)"]];
	}

	if (estilo.posicaoBarra === "volta") {
		return [["border", `${espessura} solid var(--dash-home-cor)`]];
	}

	const lado = LADO[estilo.posicaoBarra];
	if (!lado) return [["border", "1px solid var(--background-modifier-border)"]];

	// Borda fina neutra nos outros três lados, barra colorida no lado escolhido: sem isso o card
	// perderia o contorno e a barra ficaria solta no ar.
	return [
		["border", "1px solid var(--background-modifier-border)"],
		[lado, `${espessura} solid var(--dash-home-cor)`],
	];
}
