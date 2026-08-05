import type { MudancaPropriedade, TipoValorPropriedade } from "./dados";

/**
 * A alteração de propriedades (frontmatter) da nota aberta.
 *
 * Módulo puro de propósito: nada aqui toca o Obsidian. Quem escreve é `acoes.ts`, via
 * `processFrontMatter`; aqui ficam só as duas decisões que precisam ser exatas, porque erram em
 * cima de dados da usuária:
 *
 * 1. **Que valor YAML gravar** (`converterValor`) — o frontmatter é tipado, e `status: 3` não é a
 *    mesma coisa que `status: "3"` para uma Base que filtra por número.
 * 2. **Se o valor atual já é o desejado** (`ehIgual`) — é o que decide o lado do "alternar", e uma
 *    comparação ingênua (`atual === valor`) sempre daria falso, porque o valor configurado é texto
 *    e o do frontmatter pode ser número, booleano ou lista.
 */

/**
 * O valor a gravar no frontmatter, com o tipo YAML certo.
 *
 * `null` significa **apagar a propriedade** — é o que "vazio" faz. Deixar a chave com string vazia
 * manteria um `status:` pendurado na nota, que aparece na lista de propriedades do Obsidian e nas
 * Bases como se fosse um valor.
 *
 * Um número ou data que não converte cai em TEXTO em vez de virar `NaN`/`Invalid Date`: gravar lixo
 * na nota dela é pior do que gravar o que ela literalmente digitou.
 */
export function converterValor(texto: string, tipo: TipoValorPropriedade): unknown {
	const limpo = (texto ?? "").trim();

	if (tipo === "vazio") return null;

	if (tipo === "numero") {
		// Vírgula decimal: ela digita em português, e "3,5" com Number() daria NaN.
		const numero = Number(limpo.replace(",", "."));
		if (limpo === "" || !Number.isFinite(numero)) return limpo;
		return numero;
	}

	if (tipo === "booleano") {
		return VERDADEIROS.has(limpo.toLowerCase());
	}

	if (tipo === "data") {
		// `hoje` e `agora` são os únicos valores dinâmicos: são o uso real de um botão de data
		// ("marcar como concluído hoje"), e uma data fixa digitada à mão não serviria para isso.
		const chave = limpo.toLowerCase();
		if (chave === "hoje" || chave === "agora") return dataDeHoje(chave === "agora");
		return limpo;
	}

	return texto ?? "";
}

const VERDADEIROS = new Set(["true", "sim", "1", "verdadeiro", "yes", "on"]);

/**
 * A data de hoje no formato que o Obsidian usa nas propriedades de data: `AAAA-MM-DD`, ou
 * `AAAA-MM-DDTHH:mm` para data-e-hora.
 *
 * Montada a partir da hora LOCAL, não de `toISOString()` — este converte para UTC, e aí quem está
 * em Brasília depois das 21h ganharia a data de amanhã.
 */
export function dataDeHoje(comHora: boolean, agora: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	const dia = `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`;
	if (!comHora) return dia;
	return `${dia}T${pad(agora.getHours())}:${pad(agora.getMinutes())}`;
}

/**
 * Se o valor que está no frontmatter equivale ao valor configurado — a pergunta que decide o lado
 * do "alternar".
 *
 * Comparação por TEXTO normalizado, e não por identidade, porque os dois lados vêm de origens
 * diferentes: o configurado é sempre string (o painel só tem campo de texto) e o do frontmatter é
 * YAML já parseado (número, booleano, data, lista). Sem isso, `status: 3` nunca casaria com o "3"
 * configurado e o botão ficaria gravando sempre o mesmo lado.
 *
 * Numa propriedade de LISTA (`tags: [a, b]`), casa se o valor estiver entre os itens: é a leitura
 * que faz o alternar de tag funcionar.
 */
export function ehIgual(atual: unknown, valorConfigurado: string, tipo: TipoValorPropriedade): boolean {
	if (tipo === "vazio") return atual === undefined || atual === null || atual === "";

	if (Array.isArray(atual)) {
		return atual.some((item) => ehIgual(item, valorConfigurado, tipo));
	}

	const alvo = converterValor(valorConfigurado, tipo);
	if (atual === alvo) return true;

	// Booleano tem que casar pelo valor, não pelo texto: `false` no frontmatter e "não" no painel
	// são a mesma coisa, mas `String(false) === "não"` é falso.
	if (tipo === "booleano") return Boolean(atual) === Boolean(alvo);

	if (atual === undefined || atual === null) return false;
	return String(atual).trim().toLowerCase() === String(alvo).trim().toLowerCase();
}

/**
 * O valor final de UMA mudança, dado o que já está na nota.
 *
 * Devolve `{ valor }` com o que gravar (`null` = apagar a chave). É aqui que o "alternar" escolhe
 * o lado: se o atual já é o primeiro valor, vai para o segundo; em qualquer outro caso (inclusive
 * propriedade inexistente) vai para o primeiro — assim o primeiro clique num campo em branco tem
 * efeito visível, em vez de parecer que o botão não fez nada.
 */
export function valorFinal(mudanca: MudancaPropriedade, atual: unknown): unknown {
	if (mudanca.operacao === "alternar") {
		const segundo = mudanca.valor2 ?? "";
		if (ehIgual(atual, mudanca.valor, mudanca.tipo)) {
			// O segundo lado vazio significa "tirar a propriedade" — é o alternar de marcador
			// (tem/não tem), que sem isto exigiria um tipo "vazio" que só valeria para metade do ciclo.
			return segundo.trim() === "" ? null : converterValor(segundo, mudanca.tipo);
		}
		return converterValor(mudanca.valor, mudanca.tipo);
	}

	return converterValor(mudanca.valor, mudanca.tipo);
}

/**
 * Aplica todas as mudanças sobre o objeto de frontmatter, no lugar.
 *
 * Recebe o objeto que o `processFrontMatter` do Obsidian entrega — ou seja, escrever nele É a
 * escrita na nota. Só mexe nas chaves listadas: todo o resto do frontmatter da usuária (e o corpo
 * da nota) fica intocado, que é o mesmo contrato do bloco ```dash-home.
 *
 * Devolve o resumo do que mudou, para a Notice conseguir dizer o que aconteceu — um botão que
 * altera a nota em silêncio é indistinguível de um botão quebrado.
 */
export function aplicarPropriedades(
	frontmatter: Record<string, unknown>,
	mudancas: MudancaPropriedade[],
): string[] {
	const resumo: string[] = [];

	for (const mudanca of mudancas) {
		const nome = mudanca.nome?.trim();
		// Uma mudança sem nome apontaria para a chave "" — uma propriedade sem nome na nota dela.
		if (!nome) continue;

		const valor = valorFinal(mudanca, frontmatter[nome]);

		if (valor === null) {
			delete frontmatter[nome];
			resumo.push(`${nome} (removida)`);
			continue;
		}

		frontmatter[nome] = valor;
		resumo.push(`${nome}: ${valor}`);
	}

	return resumo;
}
