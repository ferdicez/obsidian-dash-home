import {
	FuzzySuggestModal,
	Modal,
	Notice,
	Setting,
	TFile,
	TFolder,
	getIconIds,
	setIcon,
	type App,
	type Command,
	type FuzzyMatch,
} from "obsidian";

/**
 * Os modais de escolha do painel de configurações. Todos são `FuzzySuggestModal` pelo mesmo motivo:
 * é o padrão do vault (ver `customize/src/modal-escolher-icone.ts`) e traz busca fuzzy, navegação
 * por teclado e rolagem virtualizada de graça — por isso as listas podem ser completas, sem corte.
 */

const SEM_ICONE = "Sem ícone";

let idsCache: string[] | null = null;

function todosOsIcones(): string[] {
	if (!idsCache) idsCache = getIconIds();
	return idsCache;
}

/** O id sem o prefixo — o texto contra o qual a busca casa e que aparece na lista. */
function semPrefixo(id: string): string {
	return id.startsWith("lucide-") ? id.slice("lucide-".length) : id;
}

/**
 * Escolha de ícone Lucide. Guarda o id COMPLETO ("lucide-star") porque é o que `setIcon` recebe
 * na renderização; a busca, porém, casa contra o nome sem prefixo, senão o "lucide-" que está em
 * todos os ids polui todos os matches.
 */
export class ModalEscolherIcone extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private contexto: string,
		private valorInicial: string | undefined,
		private onEscolher: (icone: string | undefined) => void,
	) {
		super(app);
		this.setPlaceholder(`Ícone — ${this.contexto} — busque por nome`);
		this.setInstructions([
			{ command: "↑↓", purpose: "navegar" },
			{ command: "↵", purpose: "escolher" },
			{ command: "esc", purpose: "cancelar" },
		]);
	}

	getItems(): string[] {
		return [SEM_ICONE, ...todosOsIcones()];
	}

	getItemText(icone: string): string {
		return icone === SEM_ICONE ? icone : semPrefixo(icone);
	}

	async onOpen(): Promise<void> {
		await super.onOpen();
		if (this.valorInicial) {
			this.inputEl.value = semPrefixo(this.valorInicial);
			this.inputEl.trigger("input");
		}
	}

	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
		el.addClass("dash-home-sugestao-icone");
		el.createSpan({ text: this.getItemText(match.item) });
		if (match.item === SEM_ICONE) {
			el.addClass("cm-em");
			return;
		}
		setIcon(el.createSpan(), match.item);
	}

	onChooseItem(icone: string): void {
		this.onEscolher(icone === SEM_ICONE ? undefined : icone);
	}
}

/** Escolha de nota do vault. Grava o caminho completo, que é o que `abrirNota` resolve. */
export class ModalEscolherNota extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onEscolher: (caminho: string) => void) {
		super(app);
		this.setPlaceholder("Escolha a nota que o botão abre");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(arquivo: TFile): string {
		return arquivo.path;
	}

	renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
		el.addClass("dash-home-sugestao-caminho");
		el.createDiv({ text: match.item.basename });
		// O caminho embaixo desambigua notas de mesmo nome em pastas diferentes.
		el.createDiv({ cls: "dash-home-sugestao-secundaria", text: match.item.path });
	}

	onChooseItem(arquivo: TFile): void {
		this.onEscolher(arquivo.path);
	}
}

/**
 * Escolha de uma Base (`.base`) do vault.
 *
 * `getMarkdownFiles()` não serve aqui: Bases não são markdown. Filtramos `getFiles()` pela
 * extensão — se a usuária não tiver nenhuma Base, o modal abre vazio e ela fecha, o que é
 * preferível a esconder o botão e deixá-la sem saber que a opção existe.
 */
export class ModalEscolherBase extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onEscolher: (caminho: string) => void) {
		super(app);
		this.setPlaceholder("Escolha a Base para embutir");
		this.emptyStateText = "Nenhuma Base (.base) encontrada no vault.";
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((f) => f.extension === "base");
	}

	getItemText(arquivo: TFile): string {
		return arquivo.path;
	}

	renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
		el.addClass("dash-home-sugestao-caminho");
		el.createDiv({ text: match.item.basename });
		el.createDiv({ cls: "dash-home-sugestao-secundaria", text: match.item.path });
	}

	onChooseItem(arquivo: TFile): void {
		this.onEscolher(arquivo.path);
	}
}

/** Escolha de pasta do vault. */
export class ModalEscolherPasta extends FuzzySuggestModal<TFolder> {
	constructor(app: App, private onEscolher: (caminho: string) => void) {
		super(app);
		this.setPlaceholder("Escolha a pasta que o botão abre");
	}

	getItems(): TFolder[] {
		const pastas: TFolder[] = [];
		// Vault.recurseChildren visita a raiz também; a raiz não é um destino útil, então fica fora.
		const visitar = (pasta: TFolder) => {
			for (const filho of pasta.children) {
				if (filho instanceof TFolder) {
					pastas.push(filho);
					visitar(filho);
				}
			}
		};
		visitar(this.app.vault.getRoot());
		return pastas;
	}

	getItemText(pasta: TFolder): string {
		return pasta.path;
	}

	onChooseItem(pasta: TFolder): void {
		this.onEscolher(pasta.path);
	}
}

/**
 * Escolha de uma PROPRIEDADE (campo de frontmatter) já usada no vault.
 *
 * A lista sai do que existe nas notas dela, não de uma lista fixa: as propriedades são dela, e
 * qualquer catálogo que eu escrevesse estaria errado. Escolher em vez de digitar também evita o
 * erro que não dá aviso nenhum — "Status" e "status" são propriedades DIFERENTES no frontmatter, e
 * um typo criaria uma segunda propriedade em vez de alterar a que ela quer.
 *
 * A contagem de notas ao lado serve de desempate quando duas propriedades têm nomes parecidos: a
 * usada em 200 notas é a de verdade; a de 1 costuma ser o typo antigo.
 */
export class ModalEscolherPropriedade extends FuzzySuggestModal<string> {
	private contagem = new Map<string, number>();

	constructor(app: App, private onEscolher: (nome: string) => void) {
		super(app);
		this.setPlaceholder("Escolha a propriedade — ou digite um nome novo e tecle Enter");
		this.setInstructions([
			{ command: "↑↓", purpose: "navegar" },
			{ command: "↵", purpose: "escolher" },
			{ command: "esc", purpose: "cancelar" },
		]);
	}

	getItems(): string[] {
		this.contagem = contarPropriedades(this.app);
		// Mais usadas primeiro: a fuzzy reordena pelo texto digitado, mas com o campo vazio esta é a
		// ordem que aparece — e "as que eu mais uso" é o começo mais útil.
		return [...this.contagem.keys()].sort(
			(a, b) => (this.contagem.get(b) ?? 0) - (this.contagem.get(a) ?? 0) || a.localeCompare(b),
		);
	}

	getItemText(nome: string): string {
		return nome;
	}

	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
		el.addClass("dash-home-sugestao-caminho");
		el.createDiv({ text: match.item });
		const n = this.contagem.get(match.item) ?? 0;
		el.createDiv({
			cls: "dash-home-sugestao-secundaria",
			text: n === 1 ? "1 nota" : `${n} notas`,
		});
	}

	/**
	 * Uma propriedade que ainda não existe em nota nenhuma é um caso legítimo — é o primeiro botão
	 * que vai criá-la. Sem isto, a única saída seria ir a uma nota, criar a propriedade à mão, e só
	 * então voltar aqui.
	 */
	onNoSuggestion(): void {
		const digitado = this.inputEl.value.trim();
		if (!digitado) return;
		this.resultContainerEl.empty();
		this.resultContainerEl
			.createDiv({ cls: "suggestion-item" })
			.createDiv({ text: `Criar a propriedade "${digitado}"` });
	}

	selectSuggestion(match: FuzzyMatch<string> | null, evt: MouseEvent | KeyboardEvent): void {
		// Sem sugestão selecionada, o Enter vale como "usar o que eu digitei".
		if (!match) {
			const digitado = this.inputEl.value.trim();
			this.close();
			if (digitado) this.onEscolher(digitado);
			return;
		}
		super.selectSuggestion(match, evt);
	}

	onChooseItem(nome: string): void {
		this.onEscolher(nome);
	}
}

/**
 * Quantas notas usam cada propriedade.
 *
 * Lê o `metadataCache`, que o Obsidian já mantém em memória — varrer o conteúdo dos arquivos para
 * isto seria ler o vault inteiro do disco a cada abertura do modal.
 */
function contarPropriedades(app: App): Map<string, number> {
	const contagem = new Map<string, number>();
	for (const arquivo of app.vault.getMarkdownFiles()) {
		const frontmatter = app.metadataCache.getFileCache(arquivo)?.frontmatter;
		if (!frontmatter) continue;
		for (const chave of Object.keys(frontmatter)) {
			// `position` é metadado do parser (onde o bloco começa e termina), não uma propriedade
			// da nota — apareceria na lista como se a usuária a tivesse criado.
			if (chave === "position") continue;
			contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
		}
	}
	return contagem;
}

/**
 * A lista que o botão "escolher" abre no clique — as opções configuradas, para a usuária clicar uma.
 *
 * É o que evita a multiplicação de botões: uma propriedade com seis valores possíveis seria seis
 * botões no dashboard, quando o que se quer é UM botão que mostra as seis possibilidades.
 *
 * O valor ATUAL da nota vem marcado. Sem isso ela veria seis opções iguais sem saber em qual está
 * — e a lista serve tanto para mudar quanto para conferir o estado.
 */
export class ModalEscolherValor extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private titulo: string,
		private opcoes: string[],
		private atual: string | undefined,
		private onEscolher: (valor: string) => void,
	) {
		super(app);
		this.setPlaceholder(titulo);
		this.setInstructions([
			{ command: "↑↓", purpose: "navegar" },
			{ command: "↵", purpose: "escolher" },
			{ command: "esc", purpose: "cancelar" },
		]);
	}

	getItems(): string[] {
		return this.opcoes;
	}

	getItemText(opcao: string): string {
		return opcao;
	}

	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
		el.addClass("dash-home-sugestao-caminho");
		el.createDiv({ text: match.item });
		// Comparação frouxa (aparada e sem caixa) só para MARCAR o atual: aqui é leitura para ela,
		// não o valor gravado — o que vai para a nota é sempre o texto exato da opção.
		if (this.atual !== undefined && match.item.trim().toLowerCase() === this.atual.trim().toLowerCase()) {
			el.createDiv({ cls: "dash-home-sugestao-secundaria", text: "✓ valor atual" });
		}
	}

	onChooseItem(opcao: string): void {
		this.onEscolher(opcao);
	}
}

/**
 * Os valores que uma propriedade já tem nas notas do vault.
 *
 * Serve de ponto de partida para a lista de opções do "escolher" — montar seis valores à mão quando
 * eles já existem nas notas seria trabalho repetido. Mas é só um ponto de partida: o que vale é a
 * lista que ela edita, senão um typo antigo numa nota viraria opção oferecida.
 *
 * Lê do `metadataCache` (memória), não do disco. Valores de LISTA são achatados: numa propriedade
 * de tags, o que interessa como opção é cada tag, não o conjunto.
 */
export function valoresDaPropriedade(app: App, nome: string): string[] {
	const contagem = new Map<string, number>();

	const registrar = (valor: unknown) => {
		if (valor === null || valor === undefined) return;
		if (Array.isArray(valor)) {
			for (const item of valor) registrar(item);
			return;
		}
		if (typeof valor === "object") return;
		const texto = String(valor).trim();
		if (!texto) return;
		contagem.set(texto, (contagem.get(texto) ?? 0) + 1);
	};

	for (const arquivo of app.vault.getMarkdownFiles()) {
		const frontmatter = app.metadataCache.getFileCache(arquivo)?.frontmatter;
		if (!frontmatter) continue;
		if (!(nome in frontmatter)) continue;
		registrar(frontmatter[nome]);
	}

	// Mais usados primeiro: numa propriedade com um typo antigo, o valor de verdade vem na frente.
	return [...contagem.keys()].sort(
		(a, b) => (contagem.get(b) ?? 0) - (contagem.get(a) ?? 0) || a.localeCompare(b),
	);
}

/**
 * Escolha de comando do Obsidian — inclusive os dos outros plugins da usuária (My Tasks, Gallery…).
 * `app.commands` é API interna: se ela mudar, a lista vem vazia em vez de o painel quebrar.
 */
export class ModalEscolherComando extends FuzzySuggestModal<Command> {
	constructor(app: App, private onEscolher: (id: string, nome: string) => void) {
		super(app);
		this.setPlaceholder("Escolha o comando que o botão executa");
	}

	getItems(): Command[] {
		const commands = (this.app as unknown as { commands?: { listCommands?: () => Command[] } }).commands;
		if (typeof commands?.listCommands !== "function") return [];
		return commands.listCommands();
	}

	getItemText(comando: Command): string {
		return comando.name;
	}

	onChooseItem(comando: Command): void {
		this.onEscolher(comando.id, comando.name);
	}
}

/**
 * A caixinha que pergunta o nome da nota nova, no clique de um botão "criar".
 *
 * Modal simples (não `FuzzySuggestModal`): aqui não há lista para escolher, ela DIGITA. O nome
 * sugerido vem selecionado, então aceitar no Enter é um gesto só — e trocar também, porque
 * digitar por cima substitui a seleção.
 *
 * Vive aqui, e não no painel, porque quem o abre é o dashboard renderizado.
 */
export class ModalNomeDaNotaNova extends Modal {
	private valor: string;

	constructor(
		app: App,
		sugestao: string,
		private pasta: string,
		private onConfirmar: (nome: string) => void,
	) {
		super(app);
		this.valor = sugestao;
	}

	onOpen(): void {
		this.titleEl.setText("Nome da nota");

		// Dizer ONDE a nota vai parar: o destino foi configurado no painel e ela não o vê aqui.
		this.contentEl.createEl("p", {
			cls: "dash-home-config-vazio",
			text: this.pasta ? `Será criada em "${this.pasta}".` : "Será criada na raiz do vault.",
		});

		const confirmar = () => {
			const limpo = this.valor.trim();
			if (!limpo) {
				new Notice("Dê um nome para a nota.");
				return;
			}
			this.onConfirmar(limpo);
			this.close();
		};

		new Setting(this.contentEl).setName("Nome").addText((texto) => {
			texto.setValue(this.valor).onChange((v) => (this.valor = v));
			texto.inputEl.addEventListener("keydown", (evento) => {
				if (evento.key === "Enter") {
					evento.preventDefault();
					confirmar();
				}
			});
			// Selecionado (não só focado): aceitar a sugestão é Enter, trocá-la é digitar por cima.
			window.setTimeout(() => texto.inputEl.select(), 0);
		});

		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
			.addButton((b) => b.setButtonText("Criar").setCta().onClick(confirmar));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
