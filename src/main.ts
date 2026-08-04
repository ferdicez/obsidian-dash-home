import { MarkdownRenderChild, Notice, Plugin, TFile } from "obsidian";
import { carregarDados, dashboardAtivo, salvarDados, type Dashboard, type DadosDashHome } from "./dados";
import { escreverDashboard } from "./nota";
import { PainelConfigDashHome } from "./painel-config";
import { renderizarDashboard } from "./render";

/**
 * Dash Home — dashboard inicial de navegação.
 *
 * A usuária monta o layout inteiro em Configurações → Dash Home (quadrantes, botões, ícones,
 * cores), vendo uma miniatura ao vivo, e aponta por seletor qual nota é o dashboard. O plugin
 * escreve o resultado nessa nota como um bloco ```dash-home, e é esse bloco que este arquivo
 * registra para renderizar. Em nenhum momento ela digita YAML ou caminho de arquivo.
 *
 * Por que passar por uma nota em vez de uma view própria: o dashboard vira um arquivo .md de
 * verdade — sincroniza junto com o resto do vault, funciona com o "abrir nota específica na
 * inicialização" nativo do Obsidian, aceita texto e embeds em volta, e não desaparece se o plugin
 * for desinstalado. A usuária nunca edita esse arquivo à mão; ele é gerado.
 */
export default class DashHomePlugin extends Plugin {
	dados!: DadosDashHome;

	async onload() {
		this.dados = await carregarDados(this);

		// O bloco carrega o id do dashboard, então achamos qual renderizar mesmo com dois embedados
		// na mesma nota. Sem id (ou id órfão), cai no dashboard ativo — que é o caso comum.
		this.registerMarkdownCodeBlockProcessor("dash-home", (fonte, el, ctx) => {
			const id = /^\s*id:\s*(\S+)\s*$/m.exec(fonte)?.[1];
			const dashboard = this.dados.dashboards.find((d) => d.id === id) ?? dashboardAtivo(this.dados);

			// Um MarkdownRenderChild por bloco, entregue ao contexto via addChild: o Obsidian o
			// destrói quando o bloco sai da tela, levando junto os embeds e Bases que o markdown
			// de um quadrante de conteúdo livre tiver criado. Sem este dono, esses sub-componentes
			// continuariam vivos e consultando depois da nota fechada.
			const componente = new MarkdownRenderChild(el);
			ctx.addChild(componente);

			renderizarDashboard(el, dashboard, this.dados, {
				app: this.app,
				componente,
				// A nota que hospeda o bloco — sem ela, links relativos do markdown não resolvem.
				caminhoOrigem: ctx.sourcePath,
			});
		});

		this.addCommand({
			id: "abrir-dashboard",
			name: "Abrir dashboard",
			callback: () => void this.abrirDashboard(dashboardAtivo(this.dados)),
		});

		this.addCommand({
			id: "regerar-notas",
			name: "Regerar as notas de todos os dashboards",
			callback: () => void this.regerarTodos(),
		});

		this.addRibbonIcon("layout-dashboard", "Abrir dashboard", () => {
			void this.abrirDashboard(dashboardAtivo(this.dados));
		});

		this.addSettingTab(new PainelConfigDashHome(this.app, this));
	}

	/** Persiste e regrava a nota do dashboard ativo — o fluxo normal de qualquer edição no painel. */
	async salvar(): Promise<void> {
		await salvarDados(this, this.dados);
		await this.gerarNota(dashboardAtivo(this.dados));
	}

	/** Persiste sem tocar em nota. Para mudanças que não afetam o conteúdo gerado (ex.: trocar o ativo). */
	async salvarSemGerar(): Promise<void> {
		await salvarDados(this, this.dados);
	}

	/**
	 * Escreve a nota de um dashboard com os estilos globais atuais.
	 *
	 * Existe para que os três pontos de escrita não repitam quais globais passar: um estilo novo
	 * adicionado ao modelo entra aqui, uma vez, em vez de em cada chamador (e ficar faltando em um
	 * deles seria um bug silencioso — a nota sairia sem parte da aparência).
	 */
	private gerarNota(dashboard: Dashboard): Promise<TFile | null> {
		return escreverDashboard(this.app, dashboard, this.dados.estiloGlobal, this.dados.estiloBotaoGlobal);
	}

	/** Garante que a nota existe e a abre. */
	async abrirDashboard(dashboard: Dashboard): Promise<void> {
		const arquivo = await this.gerarNota(dashboard);
		if (!(arquivo instanceof TFile)) return; // escreverDashboard já avisou o que houve
		await this.app.workspace.getLeaf(false).openFile(arquivo);
	}

	private async regerarTodos(): Promise<void> {
		let ok = 0;
		for (const dashboard of this.dados.dashboards) {
			if (await this.gerarNota(dashboard)) ok++;
		}
		new Notice(`${ok} de ${this.dados.dashboards.length} nota(s) regerada(s).`);
	}
}
