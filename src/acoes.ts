import { Notice, TFolder, type App } from "obsidian";
import type { Botao } from "./dados";

/**
 * O que acontece quando um botão do dashboard é clicado.
 *
 * Cada ramo falha com uma Notice em português dizendo o que faltou, em vez de silenciosamente não
 * fazer nada: um botão que não reage é indistinguível de um plugin quebrado.
 */
export async function executarAcao(app: App, botao: Botao, novaAba: boolean): Promise<void> {
	const destino = botao.destino?.trim();
	if (!destino) {
		new Notice(`O botão "${botao.texto}" ainda não tem destino. Configurações → Dash Home.`);
		return;
	}

	switch (botao.tipo) {
		case "nota":
			return abrirNota(app, destino, novaAba);
		case "pasta":
			return abrirPasta(app, destino);
		case "busca":
			return abrirBusca(app, destino);
		case "comando":
			return rodarComando(app, destino);
	}
}

async function abrirNota(app: App, caminho: string, novaAba: boolean): Promise<void> {
	// getFirstLinkpathDest resolve tanto "Clientes/Índice.md" quanto "Índice" — a usuária escolhe
	// pelo seletor (que grava o caminho completo), mas um data.json antigo pode ter só o nome.
	const arquivo = app.metadataCache.getFirstLinkpathDest(caminho.replace(/\.md$/i, ""), "");
	if (!arquivo) {
		new Notice(`Nota não encontrada: ${caminho}`);
		return;
	}
	await app.workspace.getLeaf(novaAba ? "tab" : false).openFile(arquivo);
}

async function abrirPasta(app: App, caminho: string): Promise<void> {
	const pasta = app.vault.getAbstractFileByPath(caminho);
	if (!(pasta instanceof TFolder)) {
		new Notice(`Pasta não encontrada: ${caminho}`);
		return;
	}

	// O explorador de arquivos não tem API pública para "revelar pasta". O caminho suportado é o
	// comando nativo de revelar o arquivo ativo, que não serve aqui. Então: abrimos o explorador e
	// pedimos para ele revelar a pasta pela API interna, com fallback silencioso se ela mudar.
	const folhas = app.workspace.getLeavesOfType("file-explorer");
	const folha = folhas[0];
	if (!folha) {
		new Notice("O explorador de arquivos não está aberto.");
		return;
	}

	await app.workspace.revealLeaf(folha);

	const view = folha.view as unknown as {
		revealInFolder?: (arquivo: unknown) => void;
	};
	if (typeof view.revealInFolder === "function") {
		view.revealInFolder(pasta);
	}
}

async function abrirBusca(app: App, query: string): Promise<void> {
	// Mesma situação da pasta: a busca global só é acessível por API interna. Se ela sumir numa
	// atualização do Obsidian, avisamos em vez de quebrar.
	const folha = app.workspace.getLeavesOfType("search")[0] ?? app.workspace.getRightLeaf(false);
	if (!folha) {
		new Notice("Não consegui abrir o painel de busca.");
		return;
	}

	if (folha.view.getViewType() !== "search") {
		await folha.setViewState({ type: "search", active: true });
	}
	await app.workspace.revealLeaf(folha);

	const view = folha.view as unknown as {
		setQuery?: (q: string) => void;
	};
	if (typeof view.setQuery === "function") {
		view.setQuery(query);
	} else {
		new Notice("A busca abriu, mas não consegui preencher a query automaticamente.");
	}
}

async function rodarComando(app: App, id: string): Promise<void> {
	const commands = (app as unknown as {
		commands: {
			executeCommandById: (id: string) => boolean;
		};
	}).commands;

	if (!commands?.executeCommandById(id)) {
		new Notice(`Comando não encontrado: ${id}. Ele pode ser de um plugin desativado.`);
	}
}
