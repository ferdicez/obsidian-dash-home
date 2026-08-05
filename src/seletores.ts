import {
	FuzzySuggestModal,
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
