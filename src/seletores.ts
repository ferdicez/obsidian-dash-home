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
