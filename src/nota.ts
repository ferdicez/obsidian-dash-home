import { Notice, TFile, TFolder, normalizePath, type App } from "obsidian";
import type { Dashboard } from "./dados";
import { estiloAtivo, type EstiloQuadrante } from "./estilo";
import { estiloBotaoAtivo, type EstiloBotao } from "./estilo-botao";

/**
 * A ponte entre o data.json e o vault: gera a nota do dashboard e a mantém atualizada.
 *
 * ── O contrato com a nota ────────────────────────────────────────────────────────────────
 *
 * O plugin é dono do bloco ```dash-cards, e só dele. Todo o resto da nota é da usuária: se ela escrever
 * um título, um parágrafo ou um embed em volta, isso sobrevive a cada salvamento. Por isso
 * `escreverDashboard` faz substituição cirúrgica do bloco em vez de reescrever o arquivo inteiro.
 *
 * O bloco carrega o id do dashboard (`# id: d_xxx`) para conseguirmos reencontrá-lo mesmo que a
 * usuária mova o bloco pelo arquivo — e para não confundir dois dashboards embedados na mesma nota.
 */

/**
 * A linguagem do bloco. `dash-cards` é a atual; `dash-home` é como o plugin se chamava até a 0.6.0.
 *
 * As duas continuam sendo LIDAS (e o `main.ts` registra as duas), porque as notas já escritas no
 * vault dela usam a antiga: trocar só o nome faria todo dashboard existente parar de renderizar
 * até ser regravado. O bloco NOVO é sempre escrito com a linguagem atual, então cada nota migra
 * sozinha no primeiro salvamento.
 */
export const LINGUAGEM = "dash-cards";
export const LINGUAGEM_ANTIGA = "dash-home";

const ABRE = "```" + LINGUAGEM;
const FECHA = "```";

/** O YAML do bloco. Legível de propósito: se a usuária abrir a nota, tem que dar pra entender. */
export function gerarBloco(
	dashboard: Dashboard,
	estiloGlobal?: EstiloQuadrante,
	estiloBotaoGlobal?: EstiloBotao,
): string {
	const linhas: string[] = [];
	linhas.push(ABRE);
	linhas.push(`# Gerado pelo plugin Dash Cards — edite em Configurações → Dash Cards`);
	linhas.push(`id: ${dashboard.id}`);
	linhas.push(`colunas: ${dashboard.colunas}`);
	// A largura do dashboard faltava aqui: o bloco descrevia o layout sem dizer quanto ele ocupa.
	// Não muda a renderização (que lê do data.json), mas um bloco que não descreve o próprio
	// dashboard não serve como registro do que foi configurado.
	linhas.push(`largura: ${dashboard.largura}`);

	// A aparência global, que vale para todos os quadrantes deste dashboard.
	const entradasGlobal = entradasDefinidas(estiloGlobal);
	if (entradasGlobal.length > 0) {
		linhas.push(`estilo:`);
		for (const linha of linhasDeEstilo(entradasGlobal, "  ")) linhas.push(linha);
	}

	// E a aparência global dos botões — a base da herança de três camadas.
	const entradasBotaoGlobal = entradasDefinidas(estiloBotaoGlobal);
	if (entradasBotaoGlobal.length > 0) {
		linhas.push(`estiloBotao:`);
		for (const linha of linhasDeEstilo(entradasBotaoGlobal, "  ")) linhas.push(linha);
	}

	linhas.push(`quadrantes:`);

	if (dashboard.quadrantes.length === 0) {
		linhas.push(`  []`);
	}

	for (const quadrante of dashboard.quadrantes) {
		linhas.push(`  - titulo: ${aspas(quadrante.titulo)}`);
		if (quadrante.icone) linhas.push(`    icone: ${quadrante.icone}`);
		if (quadrante.cor) linhas.push(`    cor: ${quadrante.cor}`);
		if (quadrante.largura) linhas.push(`    largura: ${quadrante.largura}`);

		// O estilo próprio do quadrante (o que ele sobrescreve do global). Faltava aqui: o bloco
		// descrevia o dashboard sem a aparência, então não servia como registro do que foi
		// configurado. Só sai o que o quadrante realmente define — o herdado não é repetido.
		//
		// Passa por `estiloAtivo` porque um quadrante que voltou a herdar ainda GUARDA os ajustes
		// dele: escrevê-los aqui faria o bloco descrever uma aparência que o dashboard não tem.
		const estiloDoQuadrante = estiloAtivo(quadrante.personalizaEstilo, quadrante.estilo);
		for (const linha of linhasDeEstilo(entradasDefinidas(estiloDoQuadrante), "    ")) {
			linhas.push(linha);
		}

		// A aparência dos botões deste quadrante — a camada do meio da herança. Mesma regra.
		const entradasBotao = entradasDefinidas(
			estiloBotaoAtivo(quadrante.personalizaEstiloBotao, quadrante.estiloBotao),
		);
		if (entradasBotao.length > 0) {
			linhas.push(`    estiloBotao:`);
			for (const linha of linhasDeEstilo(entradasBotao, "      ")) linhas.push(linha);
		}

		if (quadrante.conteudo === "separador") {
			linhas.push(`    conteudo: separador`);
			const sep = quadrante.separador ?? {};
			if (sep.texto) linhas.push(`    sepTexto: ${aspas(sep.texto)}`);
			// Só grava quando é `false`: `true` é o padrão e não precisa ocupar linha.
			if (sep.linha === false) linhas.push(`    sepLinha: false`);
			// `typeof` e não truthiness: espaço 0 é uma escolha válida (colar as linhas).
			if (typeof sep.espaco === "number") linhas.push(`    sepEspaco: ${sep.espaco}`);
			continue;
		}

		// "ambos" grava o markdown E os botões: por isso o markdown sai aqui, e só o tipo "markdown"
		// puro encerra o quadrante. Esquecer isto faria o bloco descrever metade do quadrante — a
		// mesma falha do separador (s9) e do estilo (s11).
		if (quadrante.conteudo === "markdown" || quadrante.conteudo === "ambos") {
			linhas.push(`    conteudo: ${quadrante.conteudo}`);
			// Em uma linha só, com escapes: o markdown pode ter quebras de linha, aspas e — o
			// caso perigoso — três crases, que num bloco literal fechariam o ```dash-home no meio
			// e destruiriam o resto da nota. `JSON.stringify` transforma tudo isso em "\n" e
			// caracteres escapados, então o conteúdo nunca influencia a estrutura do bloco.
			linhas.push(`    markdown: ${aspas(quadrante.markdown ?? "")}`);
			if (quadrante.conteudo === "markdown") continue;
		}

		if (quadrante.botoes.length === 0) {
			linhas.push(`    botoes: []`);
			continue;
		}
		linhas.push(`    botoes:`);
		for (const botao of quadrante.botoes) {
			linhas.push(`      - texto: ${aspas(botao.texto)}`);
			if (botao.icone) linhas.push(`        icone: ${botao.icone}`);
			linhas.push(`        tipo: ${botao.tipo}`);
			linhas.push(`        destino: ${aspas(botao.destino)}`);

			// As propriedades que o botão altera na nota aberta. Vão para o bloco pelo mesmo motivo
			// que o estilo: o bloco é o registro do que foi configurado, e um botão descrito só
			// como "tipo: propriedade" não diria o que ele faz. `aspas()` (JSON.stringify) é o que
			// impede um valor com crases ou dois-pontos de envenenar o bloco.
			const mudancas = botao.propriedades ?? [];
			if (mudancas.length > 0) {
				linhas.push(`        propriedades:`);
				for (const mudanca of mudancas) {
					linhas.push(`          - nome: ${aspas(mudanca.nome)}`);
					linhas.push(`            operacao: ${mudanca.operacao}`);
					linhas.push(`            tipo: ${mudanca.tipo}`);
					linhas.push(`            valor: ${aspas(mudanca.valor)}`);
					// Só no alternar: no definir ele não existe, e escrever `valor2: ""` sugeriria
					// um segundo valor que o botão nunca usa.
					if (mudanca.operacao === "alternar") {
						linhas.push(`            valor2: ${aspas(mudanca.valor2 ?? "")}`);
					}
					// As opções do "escolher" — o bloco tem que descrever a lista que o botão abre,
					// senão ele aparece só como "operacao: escolher" e não se sabe do quê.
					if (mudanca.operacao === "escolher" && mudanca.opcoes?.length) {
						linhas.push(`            opcoes:`);
						for (const opcao of mudanca.opcoes) linhas.push(`              - ${aspas(opcao)}`);
					}
				}
			}

			// A camada de cima da herança: só o que ESTE botão define, não o que ele herda.
			const entradasDoBotao = entradasDefinidas(botao.estilo);
			if (entradasDoBotao.length > 0) {
				linhas.push(`        estilo:`);
				for (const linha of linhasDeEstilo(entradasDoBotao, "          ")) linhas.push(linha);
			}
		}
	}

	linhas.push(FECHA);
	return linhas.join("\n");
}

/**
 * Os campos que um objeto de estilo realmente define.
 *
 * O filtro é `!== undefined` e NÃO truthiness: `radius: 0` (sem arredondamento), `espaco: 0` e
 * `destaque: false` são escolhas válidas que um teste de verdade descartaria em silêncio — o
 * mesmo erro que os testes pegaram nas sessões 9 e 11.
 */
function entradasDefinidas(estilo: object | undefined): Array<[string, unknown]> {
	return Object.entries(estilo ?? {}).filter(([, v]) => v !== undefined);
}

/** As entradas como linhas YAML indentadas. Strings vão entre aspas; números e booleanos, crus. */
function linhasDeEstilo(entradas: Array<[string, unknown]>, recuo: string): string[] {
	return entradas.map(
		([chave, valor]) => `${recuo}${chave}: ${typeof valor === "string" ? aspas(valor) : valor}`,
	);
}

/**
 * Aspas duplas sempre: some com todo o campo minado de YAML (`:`, `#`, `-`, string vazia).
 *
 * E, para o markdown, faz o trabalho crítico de escapar quebras de linha e crases — sem isso um
 * bloco de código dentro do markdown fecharia o ```dash-home prematuramente.
 */
function aspas(valor: string): string {
	return JSON.stringify(valor ?? "");
}

/**
 * Escreve o dashboard em TODAS as suas notas.
 *
 * Um dashboard é uma predefinição: a mesma configuração de botões pode valer para várias notas
 * (um "mapa de cliente" aplicado a vinte clientes). Mexer num botão atualiza todas no próximo
 * salvamento — é isso que o torna predefinição em vez de cópia.
 *
 * Devolve os arquivos escritos com sucesso. Uma nota que falha não interrompe as outras: com
 * vinte notas, uma pasta renomeada não pode impedir que as dezenove restantes atualizem.
 */
export async function escreverDashboard(
	app: App,
	dashboard: Dashboard,
	estiloGlobal?: EstiloQuadrante,
	estiloBotaoGlobal?: EstiloBotao,
): Promise<TFile[]> {
	const escritos: TFile[] = [];
	for (const caminho of dashboard.caminhosNota ?? []) {
		const arquivo = await escreverEmUmaNota(app, dashboard, caminho, estiloGlobal, estiloBotaoGlobal);
		if (arquivo) escritos.push(arquivo);
	}
	return escritos;
}

/**
 * Escreve o dashboard numa nota, criando o arquivo (e as pastas do caminho) se preciso.
 * Devolve o arquivo escrito, ou null se falhou — o chamador decide se avisa a usuária.
 */
async function escreverEmUmaNota(
	app: App,
	dashboard: Dashboard,
	caminhoBruto: string,
	estiloGlobal?: EstiloQuadrante,
	estiloBotaoGlobal?: EstiloBotao,
): Promise<TFile | null> {
	const bruto = caminhoBruto?.trim() ?? "";
	// Um caminho vazio viraria ".md" — um arquivo oculto e sem nome. Melhor não escrever nada e
	// deixar a usuária apontar a nota pelo seletor.
	if (!bruto) return null;

	const caminho = normalizePath(bruto.toLowerCase().endsWith(".md") ? bruto : `${bruto}.md`);
	const bloco = gerarBloco(dashboard, estiloGlobal, estiloBotaoGlobal);

	try {
		const existente = acharArquivo(app, caminho);
		if (existente instanceof TFolder) {
			avisarFalha(`"${caminho}" é uma pasta — escolha outro nome de nota em Configurações → Dash Cards.`);
			return null;
		}

		if (!(existente instanceof TFile)) {
			// Só cria pasta quando o arquivo realmente não existe — senão um caminho que difere
			// apenas na caixa criaria pastas desnecessárias a cada salvamento.
			await garantirPastaDe(app, caminho);
			const criado = await app.vault.create(caminho, `${bloco}\n`);
			limparFalha();
			return criado;
		}

		// process em vez de modify: se a nota estiver aberta e sendo editada, o Obsidian faz o
		// merge em cima do conteúdo mais recente em vez de sobrescrever o que a usuária digitou.
		await app.vault.process(existente, (conteudo) => substituirBloco(conteudo, dashboard.id, bloco));
		limparFalha();
		return existente;
	} catch (e) {
		console.warn("[dash-home] falha ao escrever a nota do dashboard:", e);
		avisarFalha(`Não consegui escrever a nota "${caminho}".`);
		return null;
	}
}

/**
 * Notifica a falha uma vez só enquanto ela persistir.
 *
 * Uma falha na escrita costuma se repetir a cada salvamento (o motivo raramente some sozinho), e
 * sem isto a tela vira uma parede de notificações idênticas — o que esconde a mensagem em vez de
 * comunicá-la. A mensagem volta a aparecer se o erro mudar, ou depois que uma escrita der certo.
 */
let ultimaFalha: string | null = null;

function avisarFalha(mensagem: string): void {
	if (mensagem === ultimaFalha) return;
	ultimaFalha = mensagem;
	new Notice(mensagem);
}

function limparFalha(): void {
	ultimaFalha = null;
}

/**
 * Troca o bloco ```dash-home do dashboard pelo novo. Se não achar, acrescenta no fim — assim uma nota
 * que a usuária criou à mão (ou de onde apagou o bloco sem querer) volta a funcionar sozinha.
 */
export function substituirBloco(conteudo: string, id: string, blocoNovo: string): string {
	const alvo = acharBloco(conteudo, id);
	if (!alvo) {
		const separador = conteudo.length === 0 || conteudo.endsWith("\n") ? "" : "\n";
		return `${conteudo}${separador}${conteudo.length ? "\n" : ""}${blocoNovo}\n`;
	}
	return conteudo.slice(0, alvo.inicio) + blocoNovo + conteudo.slice(alvo.fim);
}

/**
 * Localiza o bloco pelo id que ele carrega. Prefere o bloco com o id certo; se nenhum bloco tiver
 * id (nota gerada por uma versão anterior), aceita o primeiro bloco ```dash-home como sendo o nosso.
 *
 * A varredura é uma passada só, acompanhando a cerca de código aberta no momento. Isso importa
 * porque um ```dash-home citado DENTRO de outro bloco (um exemplo em ````markdown, digamos) não é um
 * dashboard — é texto. Trocar aquilo destruiria o exemplo que a usuária escreveu.
 */
function acharBloco(conteudo: string, id: string): { inicio: number; fim: number } | null {
	const linhas = conteudo.split("\n");
	let primeiroSemId: { inicio: number; fim: number } | null = null;

	// Estado da varredura: dentro de um bloco, qual cerca o abriu e se é um ```dash-home nosso.
	let cercaAberta: string | null = null;
	let inicioNosso = -1;
	let idDoBloco: string | null = null;

	let posicao = 0;
	for (const linha of linhas) {
		const inicioLinha = posicao;
		posicao += linha.length + 1;

		const cerca = /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(linha);

		if (cercaAberta === null) {
			if (!cerca) continue;
			// Abre um bloco. Só nos interessa se for um bloco nosso no nível de topo — na linguagem
			// atual OU na antiga, senão a substituição não acharia o bloco das notas já escritas e
			// acrescentaria um segundo dashboard no fim do arquivo.
			cercaAberta = cerca[1];
			if ((cerca[2] === LINGUAGEM || cerca[2] === LINGUAGEM_ANTIGA) && cerca[1] === "```") {
				inicioNosso = inicioLinha;
				idDoBloco = null;
			}
			continue;
		}

		// Dentro de um bloco: só fecha com uma cerca do mesmo tipo e ao menos do mesmo tamanho,
		// e sem linguagem depois — é a regra do CommonMark, e é o que o Obsidian segue.
		const fecha = cerca && cerca[2] === "" && cerca[1][0] === cercaAberta[0] && cerca[1].length >= cercaAberta.length;

		if (!fecha) {
			if (inicioNosso >= 0 && idDoBloco === null) {
				idDoBloco = /^\s*id:\s*(\S+)\s*$/.exec(linha)?.[1] ?? null;
			}
			continue;
		}

		if (inicioNosso >= 0) {
			const alvo = { inicio: inicioNosso, fim: inicioLinha + linha.length };
			if (idDoBloco === id) return alvo;
			if (idDoBloco === null && !primeiroSemId) primeiroSemId = alvo;
		}

		cercaAberta = null;
		inicioNosso = -1;
		idDoBloco = null;
	}

	// Um bloco que ficou aberto até o fim do arquivo não é mexido: sem o fecha-cerca não dá para
	// saber onde ele termina, e cortar no chute apagaria conteúdo.
	return primeiroSemId;
}

/**
 * Acha o arquivo do caminho, ignorando diferença de caixa.
 *
 * `getAbstractFileByPath` casa exatamente: "home.md" não encontra o "Home.md" que existe. No
 * Windows isso é uma armadilha, porque o sistema de arquivos ignora caixa — o plugin concluía
 * "não existe", tentava criar, e o Windows recusava por já existir. Resultado: erro a cada
 * salvamento, com a usuária vendo uma nota que está bem ali.
 *
 * A busca exata vem primeiro porque é o caso normal e é O(1); a varredura só roda quando falha.
 */
function acharArquivo(app: App, caminho: string): TFile | TFolder | null {
	const exato = app.vault.getAbstractFileByPath(caminho);
	if (exato) return exato as TFile | TFolder;

	const alvo = caminho.toLowerCase();
	return app.vault.getFiles().find((f) => f.path.toLowerCase() === alvo) ?? null;
}

/** Cria as pastas intermediárias do caminho, se ainda não existirem. */
async function garantirPastaDe(app: App, caminho: string): Promise<void> {
	const barra = caminho.lastIndexOf("/");
	if (barra <= 0) return;
	const pasta = caminho.slice(0, barra);
	if (app.vault.getAbstractFileByPath(pasta)) return;
	await app.vault.createFolder(pasta).catch(() => {
		// Corrida com outro processo criando a mesma pasta: se ela existe agora, está tudo certo.
	});
}
