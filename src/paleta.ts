import type { App } from "obsidian";

/**
 * Lê as paletas de cores do plugin Customize, para o Dash Home poder oferecer as cores que a
 * usuária já configurou lá em vez de obrigá-la a redigitar hex.
 *
 * ── Por que ler o data.json de outro plugin ──────────────────────────────────────────────
 *
 * Não há API pública de plugin-para-plugin no Obsidian. As opções seriam: duplicar a paleta aqui
 * (ela teria que manter as duas em sincronia à mão) ou ler o arquivo do vizinho. A leitura é o
 * menor mal, desde que seja estritamente opcional — o que é o caso: se o Customize não estiver
 * instalado, ou o formato mudar, `paletasDoCustomize` devolve lista vazia e o painel simplesmente
 * não mostra a seção de paleta. Nada quebra.
 *
 * Só LEMOS. Escrever no data.json de outro plugin corromperia o estado dele sem que ele soubesse.
 */

const ID_CUSTOMIZE = "customize";

export interface PaletaExterna {
	nome: string;
	/** hex "#rrggbb" já normalizados. */
	cores: string[];
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * As paletas do Customize, ou lista vazia se ele não estiver instalado/configurado.
 * Nunca lança: qualquer falha vira "sem paletas".
 */
export async function paletasDoCustomize(app: App): Promise<PaletaExterna[]> {
	try {
		const caminho = `${app.vault.configDir}/plugins/${ID_CUSTOMIZE}/data.json`;
		if (!(await app.vault.adapter.exists(caminho))) return [];

		const bruto = await app.vault.adapter.read(caminho);
		const dados = JSON.parse(bruto) as { paletas?: unknown };
		if (!Array.isArray(dados.paletas)) return [];

		const paletas: PaletaExterna[] = [];
		for (const p of dados.paletas) {
			if (!p || typeof p !== "object") continue;
			const { nome, cores } = p as { nome?: unknown; cores?: unknown };
			if (!Array.isArray(cores)) continue;

			const limpas = cores.filter((c): c is string => typeof c === "string" && HEX.test(c.trim()));
			if (limpas.length === 0) continue;

			paletas.push({
				nome: typeof nome === "string" && nome.trim() ? nome.trim() : "Paleta",
				cores: limpas.map((c) => c.trim().toLowerCase()),
			});
		}
		return paletas;
	} catch (e) {
		console.warn("[dash-home] não consegui ler as paletas do Customize:", e);
		return [];
	}
}
