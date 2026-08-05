import { Notice, TFile, TFolder, type App } from "obsidian";
import { ehControle, type Botao, type MudancaPropriedade, type TipoValorPropriedade } from "./dados";
import { aplicarPropriedades } from "./propriedades";
import { ModalEscolherValor } from "./seletores";

/**
 * O que acontece quando um botão do dashboard é clicado.
 *
 * Cada ramo falha com uma Notice em português dizendo o que faltou, em vez de silenciosamente não
 * fazer nada: um botão que não reage é indistinguível de um plugin quebrado.
 */
export async function executarAcao(app: App, botao: Botao, novaAba: boolean): Promise<void> {
	// Antes da checagem de destino: este tipo não usa `destino` — o alvo é a nota aberta, e o que
	// ele grava está em `propriedades`.
	if (botao.tipo === "propriedade") {
		return alterarPropriedades(app, botao);
	}

	const destino = botao.destino?.trim();
	if (!destino) {
		new Notice(`O botão "${botao.texto}" ainda não tem destino. Configurações → Dash Cards.`);
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
	// "propriedade" não aparece aqui: o early return acima já o tratou, e o TypeScript o removeu
	// do tipo neste ponto. Um TipoAcao NOVO, esse sim, continua dando erro de compilação no switch
	// em vez de virar um botão silenciosamente inerte.
}

/**
 * Grava na nota aberta o que ela digitou num botão do tipo "campo".
 *
 * Passa por `aplicarPropriedades` como qualquer outra alteração, e não por uma escrita direta,
 * porque é lá que mora a conversão de tipo do YAML: sem ela um "3" digitado viraria a STRING "3",
 * e a Base dela que filtra por número deixaria de achar a nota (a armadilha nº 13 do doc).
 *
 * Campo apagado remove a propriedade em vez de gravar string vazia — um `lembrete:` pendurado
 * aparece na lista de propriedades do Obsidian e nas Bases como se fosse um valor.
 */
export async function gravarCampo(
	app: App,
	botao: Botao,
	origem: MudancaPropriedade,
	texto: string,
): Promise<void> {
	const nome = origem.nome?.trim();
	if (!nome) return;

	const arquivo = app.workspace.getActiveFile();
	if (!(arquivo instanceof TFile) || arquivo.extension !== "md") {
		new Notice("Abra uma nota para preencher esta propriedade.");
		return;
	}

	const valor = texto.trim();

	// O tipo do VALOR é derivado do controle, com duas regras:
	//
	// - No interruptor é sempre booleano — a chavinha manda "sim"/"não", que `converterValor`
	//   transforma em `true`/`false`. E o vazio NÃO se aplica: desligar grava `false`, não apaga a
	//   propriedade, senão a chave sumiria da nota toda vez que ela desligasse.
	// - Na caixa, vazio APAGA a chave (um `lembrete:` pendurado aparece nas Bases como valor).
	const formato = origem.formato ?? "texto";
	const tipo: TipoValorPropriedade =
		origem.operacao === "interruptor"
			? "booleano"
			: valor === ""
				? "vazio"
				: formato === "numero"
					? "numero"
					: formato === "data"
						? "data"
						: "texto";

	const mudanca: MudancaPropriedade = {
		id: origem.id,
		nome,
		operacao: "definir",
		tipo,
		valor,
	};

	let resumo: string[] = [];
	try {
		await app.fileManager.processFrontMatter(arquivo, (frontmatter) => {
			resumo = aplicarPropriedades(frontmatter, [mudanca]);
		});
	} catch (e) {
		console.warn("[dash-home] falha ao gravar o campo na nota:", e);
		new Notice(`Não consegui gravar "${nome}" em "${arquivo.basename}".`);
		return;
	}

	if (resumo.length > 0) new Notice(`${arquivo.basename} — ${resumo.join(", ")}`);
}

/**
 * Altera as propriedades (frontmatter) da NOTA ABERTA.
 *
 * O alvo é a nota ativa, e não uma nota fixa, porque é isso que torna o botão reutilizável: o mesmo
 * dashboard aplicado a vinte notas de cliente ganha um botão "Concluir" que age em qualquer uma
 * delas. A contrapartida é que sem nota aberta não há o que alterar — daí o aviso.
 */
async function alterarPropriedades(app: App, botao: Botao): Promise<void> {
	// As operações de CONTROLE (digitar, interruptor) são excluídas: elas não acontecem no clique,
	// e sim no próprio widget que o render desenhou. Se chegassem aqui, um clique na moldura em
	// volta da caixa gravaria o `valor` configurado por cima do que ela digitou.
	const mudancas = (botao.propriedades ?? []).filter((m) => m.nome?.trim() && !ehControle(m.operacao));
	if (mudancas.length === 0) {
		new Notice(`O botão "${botao.texto}" ainda não tem propriedade configurada. Configurações → Dash Cards.`);
		return;
	}

	// getActiveFile e não `workspace.getActiveViewOfType`: o dashboard costuma ser clicado da própria
	// nota que o contém, e ela é justamente o arquivo ativo.
	const arquivo = app.workspace.getActiveFile();
	if (!(arquivo instanceof TFile)) {
		new Notice("Abra uma nota para o botão alterar as propriedades dela.");
		return;
	}
	if (arquivo.extension !== "md") {
		new Notice(`"${arquivo.name}" não é uma nota — só notas têm propriedades.`);
		return;
	}

	// As escolhas são resolvidas ANTES de qualquer escrita: cada "escolher" abre uma lista e espera
	// o clique dela. Fazer isso dentro do processFrontMatter significaria segurar o arquivo aberto
	// enquanto um modal espera — e um "esc" no meio deixaria a nota alterada pela metade.
	const resolvidas: MudancaPropriedade[] = [];
	for (const mudanca of mudancas) {
		if (mudanca.operacao !== "escolher") {
			resolvidas.push(mudanca);
			continue;
		}

		const opcoes = mudanca.opcoes ?? [];
		if (opcoes.length === 0) {
			new Notice(`"${mudanca.nome}" não tem opções configuradas. Configurações → Dash Cards.`);
			return;
		}

		const escolhido = await escolherValor(app, arquivo, mudanca, opcoes);
		// Cancelou (esc ou clique fora): nada é gravado, nem desta mudança nem das outras. Aplicar
		// só as anteriores deixaria a nota num estado que ela não pediu.
		if (escolhido === undefined) return;

		// Vira um "definir" com o valor clicado — daí para baixo o caminho é o mesmo dos outros.
		resolvidas.push({ ...mudanca, operacao: "definir", valor: escolhido });
	}

	let resumo: string[] = [];
	try {
		// processFrontMatter cria o bloco de propriedades se ainda não existir, faz o merge com o que
		// já está lá e reescreve só ele — o corpo da nota não é tocado.
		await app.fileManager.processFrontMatter(arquivo, (frontmatter) => {
			resumo = aplicarPropriedades(frontmatter, resolvidas);
		});
	} catch (e) {
		console.warn("[dash-home] falha ao alterar as propriedades da nota:", e);
		new Notice(`Não consegui alterar as propriedades de "${arquivo.basename}".`);
		return;
	}

	if (resumo.length === 0) {
		new Notice(`Nada a alterar em "${arquivo.basename}".`);
		return;
	}

	// Dizer o que mudou, e em qual nota: a alteração acontece no frontmatter, que pode estar fora da
	// tela (ou recolhido), então sem a Notice o clique não teria retorno visível nenhum.
	new Notice(`${arquivo.basename} — ${resumo.join(", ")}`);
}

/**
 * Abre a lista de opções e devolve a escolhida — ou `undefined` se ela cancelou.
 *
 * `FuzzySuggestModal` avisa por callback, não por Promise; a ponte é esta. O `onClose` resolve com
 * `undefined` porque fechar sem escolher (esc, clique fora) tem que ser distinguível de escolher —
 * senão o cancelamento gravaria alguma coisa.
 */
function escolherValor(
	app: App,
	arquivo: TFile,
	mudanca: MudancaPropriedade,
	opcoes: string[],
): Promise<string | undefined> {
	// O valor atual, para vir marcado na lista: serve tanto para mudar quanto para conferir em qual
	// estado a nota está.
	const atual = app.metadataCache.getFileCache(arquivo)?.frontmatter?.[mudanca.nome];
	const atualTexto = atual === null || atual === undefined ? undefined : String(atual);

	return new Promise((resolver) => {
		let escolhido: string | undefined;
		const modal = new ModalEscolherValor(
			app,
			`${mudanca.nome} — ${arquivo.basename}`,
			opcoes,
			atualTexto,
			(valor) => {
				escolhido = valor;
			},
		);
		// onClose corre depois do onChooseItem nos dois caminhos (escolha e cancelamento), então é
		// o único ponto que resolve — sem risco de resolver duas vezes.
		const fecharOriginal = modal.onClose.bind(modal);
		modal.onClose = () => {
			fecharOriginal();
			resolver(escolhido);
		};
		modal.open();
	});
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
