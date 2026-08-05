import { Notice, TFile, TFolder, normalizePath, type App } from "obsidian";
import { ehControle, type Botao, type MudancaPropriedade, type TipoValorPropriedade } from "./dados";
import { aplicarPropriedades } from "./propriedades";
import { ModalEscolherValor, ModalNomeDaNotaNova } from "./seletores";

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

	// Também não usa `destino`: o template e a pasta ficam em `criar`, e o nome vem do clique.
	if (botao.tipo === "criar") {
		return criarNota(app, botao, novaAba);
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

/**
 * Cria uma nota nova a partir de um template, na pasta escolhida, e a abre.
 *
 * ── Por que perguntar o nome ─────────────────────────────────────────────────────────────
 *
 * Decisão dela: o mesmo botão serve para "Cliente Acme" e para uma nota do dia, e um nome
 * automático só serviria ao segundo caso. A caixinha abre com a sugestão SELECIONADA, então
 * aceitar é um Enter e trocar é digitar por cima.
 *
 * ── Templater ────────────────────────────────────────────────────────────────────────────
 *
 * Se o Templater estiver ativo, é ele quem processa o arquivo — é o que faz `<% tp.date.now() %>`
 * funcionar, e ela o usa no vault. Sem ele, o conteúdo é copiado como está: um template com
 * sintaxe do Templater viraria texto literal, o que é feio mas honesto (e melhor que não criar
 * nota nenhuma).
 */
async function criarNota(app: App, botao: Botao, novaAba: boolean): Promise<void> {
	const cfg = botao.criar;
	const pasta = cfg?.pasta?.trim() ?? "";

	const sugestao = expandirData(cfg?.nomeSugerido?.trim() || "Nova nota");

	const nome = await perguntarNome(app, sugestao, pasta);
	// Cancelou: nada é criado. Um esc que ainda assim criasse "Nova nota" na raiz seria pior que
	// não fazer nada — ela teria que caçar e apagar o arquivo.
	if (nome === undefined) return;

	// Só o nome é limpo, não o caminho: se ela digitar "Clientes/Acme", a barra é dela e vale como
	// subpasta. Os outros caracteres são os que o sistema de arquivos recusa.
	const limpo = nome.replace(/[\\:*?"<>|]/g, "").trim();
	if (!limpo) {
		new Notice("Esse nome não pode ser usado para um arquivo.");
		return;
	}

	const base = limpo.endsWith(".md") ? limpo.slice(0, -3) : limpo;
	const caminho = normalizePath(pasta ? `${pasta}/${base}.md` : `${base}.md`);

	// Nunca sobrescrever: a nota existente pode ter conteúdo dela. Abrir a que já existe é o
	// comportamento útil (ela provavelmente quis chegar lá), e o aviso diz o que aconteceu.
	const jaExiste = app.vault.getAbstractFileByPath(caminho);
	if (jaExiste instanceof TFile) {
		new Notice(`"${base}" já existe — abrindo a nota existente.`);
		await app.workspace.getLeaf(novaAba ? "tab" : false).openFile(jaExiste);
		return;
	}

	// A pasta pode não existir ainda (ela escolheu no painel e depois renomeou, ou o nome tem
	// subpasta). Criar em silêncio é melhor que falhar pedindo que ela crie à mão.
	const pastaDoArquivo = caminho.slice(0, caminho.lastIndexOf("/"));
	if (pastaDoArquivo && !app.vault.getAbstractFileByPath(pastaDoArquivo)) {
		try {
			await app.vault.createFolder(pastaDoArquivo);
		} catch {
			// Corrida com outro processo criando a mesma pasta: se ela existe agora, seguimos.
		}
	}

	const conteudo = await lerTemplate(app, cfg?.template);
	if (conteudo === null) return; // o aviso já foi dado

	let arquivo: TFile;
	try {
		arquivo = await app.vault.create(caminho, conteudo);
	} catch (e) {
		console.warn("[dash-home] falha ao criar a nota:", e);
		new Notice(`Não consegui criar "${caminho}".`);
		return;
	}

	await app.workspace.getLeaf(novaAba ? "tab" : false).openFile(arquivo);

	// O Templater processa DEPOIS de a nota existir e estar aberta: os comandos dele (`tp.file.*`)
	// agem sobre o arquivo ativo. Falhar aqui não desfaz a nota — ela já está criada e aberta, com
	// o conteúdo bruto do template, o que é recuperável.
	await processarComTemplater(app, arquivo, cfg?.template);
}

/** Abre a caixinha do nome e devolve o que ela digitou — ou `undefined` se cancelou. */
function perguntarNome(app: App, sugestao: string, pasta: string): Promise<string | undefined> {
	return new Promise((resolver) => {
		let escolhido: string | undefined;
		const modal = new ModalNomeDaNotaNova(app, sugestao, pasta, (nome) => {
			escolhido = nome;
		});
		// Como nos outros modais do plugin: `onClose` corre depois do confirmar nos dois caminhos,
		// então é o único ponto que resolve — sem risco de resolver duas vezes.
		const fecharOriginal = modal.onClose.bind(modal);
		modal.onClose = () => {
			fecharOriginal();
			resolver(escolhido);
		};
		modal.open();
	});
}

/**
 * O conteúdo inicial da nota. `null` significa "houve erro e já avisei".
 *
 * Template vazio é uma escolha legítima (nota em branco), então só o caminho QUEBRADO avisa: um
 * template configurado que sumiu do vault é um erro dela querer saber, não algo a ignorar.
 */
async function lerTemplate(app: App, caminho: string | undefined): Promise<string | null> {
	const alvo = caminho?.trim();
	if (!alvo) return "";

	const arquivo = app.vault.getAbstractFileByPath(alvo);
	if (!(arquivo instanceof TFile)) {
		new Notice(`Template não encontrado: ${alvo}. Configurações → Dash Cards.`);
		return null;
	}

	try {
		return await app.vault.read(arquivo);
	} catch (e) {
		console.warn("[dash-home] falha ao ler o template:", e);
		new Notice(`Não consegui ler o template "${alvo}".`);
		return null;
	}
}

/**
 * Manda o Templater processar a nota recém-criada, se ele estiver ativo.
 *
 * `overwrite_file_commands` reescreve o arquivo já existente resolvendo a sintaxe dele — é a API
 * usada por quem integra com o Templater. Toda a chamada é defensiva porque é API INTERNA de outro
 * plugin: se ele mudar de versão, a nota continua criada com o template bruto em vez de o clique
 * inteiro falhar.
 */
async function processarComTemplater(app: App, arquivo: TFile, template: string | undefined): Promise<void> {
	if (!template?.trim()) return;

	const plugins = (app as unknown as {
		plugins?: { plugins?: Record<string, unknown> };
	}).plugins;
	const templater = plugins?.plugins?.["templater-obsidian"] as
		| { templater?: { overwrite_file_commands?: (arquivo: TFile, abrirNota?: boolean) => Promise<void> } }
		| undefined;

	const processar = templater?.templater?.overwrite_file_commands;
	if (typeof processar !== "function") return;

	try {
		await processar.call(templater!.templater, arquivo, false);
	} catch (e) {
		console.warn("[dash-home] o Templater não conseguiu processar a nota:", e);
		new Notice("A nota foi criada, mas o Templater não conseguiu processar o template.");
	}
}

/**
 * Troca `{{date}}` e `{{time}}` no nome sugerido, como o template nativo do Obsidian faz.
 *
 * Hora LOCAL, e não `toISOString()`: este converte para UTC, e quem está em Brasília depois das
 * 21h ganharia a data de amanhã no nome do arquivo. Mesma razão do `dataDeHoje` (s15).
 */
function expandirData(texto: string): string {
	const agora = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const data = `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`;
	const hora = `${pad(agora.getHours())}-${pad(agora.getMinutes())}`;
	return texto.replace(/\{\{\s*date\s*\}\}/gi, data).replace(/\{\{\s*time\s*\}\}/gi, hora);
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
