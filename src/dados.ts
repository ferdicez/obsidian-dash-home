import { Notice, type Plugin } from "obsidian";
import type { EstiloQuadrante } from "./estilo";
import { normalizarEstiloBotao, type EstiloBotao } from "./estilo-botao";

/**
 * Dados persistidos do plugin (data.json): os dashboards que a usuária montou nas configurações.
 * Nada aqui depende do DOM — é o modelo puro.
 *
 * ── Por que o data.json guarda o layout se o dashboard é uma nota? ────────────────────────
 *
 * A nota é a *saída*: o plugin a gera e reescreve a cada salvamento (ver `nota.ts`). O data.json
 * é a *fonte*, porque é dele que o painel de configurações lê para montar os formulários. Ler de
 * volta do YAML daria no mesmo, mas exigiria um parser tolerante a nota editada à mão — e a
 * usuária não edita a nota, esse é o ponto do plugin.
 *
 * Consequência assumida: se o data.json sumir, os dashboards precisam ser remontados. Em troca,
 * as notas geradas continuam lá e continuam legíveis (o bloco vira texto YAML visível).
 */

/**
 * O que um botão faz ao ser clicado.
 *
 * "campo" foi um tipo próprio na 0.9.x e virou a operação "digitar" dentro de "propriedade" na
 * s23 — ele SÓ preenchia uma propriedade, então ser um tipo à parte duplicava a mesma escolha em
 * dois lugares. Continua aceito na carga (e convertido) para não quebrar o que ela já montou.
 */
export type TipoAcao = "nota" | "pasta" | "busca" | "comando" | "propriedade" | "campo" | "criar";

/** Onde a nota criada por um botão "criar" é salva, e a partir de qual template. */
export interface CriarNota {
	/** Caminho do arquivo de template ("Templates/Reunião.md"). Vazio = nota em branco. */
	template: string;
	/** Pasta de destino. Vazio = a raiz do vault. */
	pasta: string;
	/**
	 * Nome sugerido na caixinha do clique. Aceita `{{date}}` e `{{time}}`.
	 *
	 * É só a SUGESTÃO: ela sempre confirma (e pode trocar) antes de a nota ser criada — decisão
	 * dela, porque o mesmo botão serve para "Cliente Acme" e para uma nota do dia.
	 */
	nomeSugerido?: string;
}

/** O formato da caixa de digitação, na operação "digitar". */
export type TipoCampo = "numero" | "texto" | "data";

/**
 * O que fazer com uma propriedade (campo do frontmatter) da nota aberta:
 * - "definir": grava `valor`, seja qual for o conteúdo atual
 * - "alternar": se o atual for `valor`, grava `valor2`; senão, grava `valor`
 *
 * - "escolher": abre uma lista com as opções e grava a que for clicada
 *
 * "alternar" existe porque o uso mais comum de um botão de propriedade é um interruptor de estado
 * ("a fazer" ↔ "feito"), e com "definir" isso exigiria dois botões e a usuária escolhendo qual
 * clicar — ou seja, ela teria que saber o estado atual de cabeça.
 *
 * "escolher" é a mesma ideia levada a N valores, e evita a multiplicação de botões: uma propriedade
 * com seis valores possíveis viraria seis botões no dashboard (um por valor), quando o que se quer
 * é UM botão "Status" que mostra as seis possibilidades na hora do clique.
 *
 * As duas últimas NÃO acontecem no clique — elas viram o próprio controle dentro do card:
 *
 * - "digitar": uma caixa de texto/número/data ligada à propriedade. Substitui o input do Meta Bind
 * - "interruptor": uma chavinha que reflete o valor atual e grava sim/não ao ser clicada
 *
 * Por isso as duas são EXCLUSIVAS num botão (ver `ehControle`): um botão que já é uma caixa de
 * digitação não tem clique sobrando para também gravar um "definir".
 */
export type OperacaoPropriedade = "definir" | "alternar" | "escolher" | "digitar" | "interruptor";

/**
 * Se a operação transforma o botão num CONTROLE (caixa, chavinha) em vez de uma ação de clique.
 *
 * Ponto único da regra: o painel a usa para bloquear a mistura, e o render para decidir o que
 * desenhar. Duplicá-la faria as duas telas discordarem sobre o que o botão é.
 */
export function ehControle(operacao: OperacaoPropriedade): boolean {
	return operacao === "digitar" || operacao === "interruptor";
}

/**
 * O TIPO do valor gravado no frontmatter.
 *
 * Importa porque o frontmatter do Obsidian é YAML tipado: `status: 3` é número e `status: "3"` é
 * texto, e uma Base que filtra por número não acha o texto. Como o painel só tem campos de texto,
 * sem isto tudo viraria string e as propriedades de checkbox/número da usuária parariam de casar.
 */
export type TipoValorPropriedade = "texto" | "numero" | "booleano" | "data" | "vazio";

export interface MudancaPropriedade {
	id: string;
	/** O nome da propriedade no frontmatter ("status", "cliente"). */
	nome: string;
	operacao: OperacaoPropriedade;
	tipo: TipoValorPropriedade;
	/** O valor gravado, sempre como texto; convertido conforme `tipo` na hora de escrever. */
	valor: string;
	/** O segundo valor do "alternar". Ignorado quando a operação é "definir". */
	valor2?: string;
	/**
	 * As opções oferecidas no "escolher", na ordem em que aparecem na lista.
	 *
	 * Digitadas pela usuária (uma por linha no painel), e não lidas do vault na hora do clique:
	 * assim ela controla a ordem, e um typo antigo numa nota não vira opção oferecida. O painel
	 * oferece "puxar do vault" como ponto de partida, mas o que vale é esta lista.
	 */
	opcoes?: string[];
	/**
	 * O formato da caixa, na operação "digitar": texto, número ou data.
	 *
	 * Separado de `tipo` porque aquele tem cinco valores (inclui booleano e vazio) e nenhum dos
	 * dois se digita numa caixa. Em "digitar", `tipo` é derivado deste na hora de gravar.
	 */
	formato?: TipoCampo;
	/** A dica cinza dentro da caixa vazia ("Number", "dias antes"…). Só no "digitar". */
	dica?: string;
}

export interface Botao {
	id: string;
	texto: string;
	/** id completo do ícone Lucide ("lucide-star"), ou undefined para botão sem ícone. */
	icone?: string;
	tipo: TipoAcao;
	/**
	 * O destino, interpretado conforme `tipo`:
	 * - nota: caminho do arquivo ("Clientes/Índice.md")
	 * - pasta: caminho da pasta ("Clientes")
	 * - busca: a query de busca ("tag:#cliente")
	 * - comando: id do comando ("my-tasks:abrir-kanban")
	 * - propriedade: não usado (as mudanças ficam em `propriedades`)
	 */
	destino: string;
	/**
	 * As propriedades alteradas na nota aberta, quando `tipo === "propriedade"`.
	 *
	 * É uma LISTA porque uma mudança de estado costuma mexer em mais de um campo de uma vez
	 * ("arquivar" = `status: arquivado` + `arquivado: true`), e fazer isso com dois botões deixaria
	 * a nota num estado pela metade se ela clicasse só um.
	 */
	propriedades?: MudancaPropriedade[];
	/**
	 * A propriedade que a caixa de digitação preenche, quando `tipo === "campo"`.
	 *
	 * Separada de `propriedades` de propósito: lá são mudanças de valor FIXO, decididas na
	 * montagem; aqui o valor é digitado na hora, e o que se configura é só o alvo e o formato.
	 */
	campo?: CampoEntrada;
	/** Template e destino da nota nova, quando `tipo === "criar"`. */
	criar?: CriarNota;
	/**
	 * Aparência só deste botão; o que não define, herda do quadrante e depois do global.
	 * É a terceira camada da herança — ver `estilo-botao.ts`.
	 */
	estilo?: EstiloBotao;
	/**
	 * O id do botão salvo (`BotaoSalvo`) de onde este botão vem, quando ele é VINCULADO.
	 *
	 * Vinculado significa que o conteúdo real mora na biblioteca: editar o molde muda este botão em
	 * todos os dashboards de uma vez. Foi a escolha dela, em vez de a cópia solta.
	 *
	 * A consequência é que os campos deste objeto (texto, ícone, tipo, destino, propriedades…)
	 * **não valem nada** enquanto o vínculo existe — quem desenha tem que passar por
	 * `botaoResolvido()`, nunca ler o botão direto. Mesma regra de `estiloAtivo()` (armadilha nº 19).
	 *
	 * Os campos continuam guardados, e não apagados, por dois motivos: desvincular devolve um botão
	 * inteiro em vez de um esqueleto, e um molde excluído não leva o botão junto.
	 */
	salvoId?: string;
}

/**
 * Um botão pré-configurado na biblioteca, disponível em TODOS os dashboards.
 *
 * Existe para que montar um card não exija reescolher ícone, ação e propriedades a cada vez: ela
 * cadastra o botão uma vez aqui e, na montagem, só o seleciona.
 *
 * É um `Botao` sem `id`/`salvoId`: um molde não mora num quadrante e não se vincula a outro molde.
 * O `estilo` VEM junto — é parte do que ela configurou — e continua sendo a terceira camada da
 * herança, então um molde sem cor própria ainda se adapta ao quadrante em que for usado.
 */
export interface BotaoSalvo {
	id: string;
	/** O nome na biblioteca. É também o rótulo do botão no dashboard. */
	texto: string;
	icone?: string;
	tipo: TipoAcao;
	destino: string;
	propriedades?: MudancaPropriedade[];
	criar?: CriarNota;
	estilo?: EstiloBotao;
}

/**
 * O conteúdo REAL de um botão: o molde, quando ele é vinculado; ele mesmo, quando não é.
 *
 * Ponto único da regra, como `estiloAtivo()`. Render, nota e painel passam todos por aqui — ler
 * `quadrante.botoes[i]` direto mostraria o esqueleto guardado (o texto de antes do vínculo) em vez
 * do que ela configurou na biblioteca.
 *
 * Vínculo QUEBRADO (o molde foi excluído) cai no próprio botão: os campos continuam lá justamente
 * para este caso, e um botão que ainda funciona é melhor que um buraco na nota dela.
 */
export function botaoResolvido(botao: Botao, salvos: BotaoSalvo[] | undefined): Botao {
	if (!botao.salvoId) return botao;
	const molde = salvos?.find((s) => s.id === botao.salvoId);
	if (!molde) return botao;

	// O `id` é do BOTÃO, não do molde: ele é chave de acordeão no painel, e dois botões vindos do
	// mesmo molde no mesmo quadrante abririam e fechariam juntos.
	return {
		id: botao.id,
		salvoId: botao.salvoId,
		texto: molde.texto,
		icone: molde.icone,
		tipo: molde.tipo,
		destino: molde.destino,
		propriedades: molde.propriedades,
		criar: molde.criar,
		estilo: molde.estilo,
	};
}

/** Uma caixa de digitação ligada a uma propriedade da nota aberta. */
export interface CampoEntrada {
	/** O nome da propriedade no frontmatter ("lembrete"). */
	nome: string;
	tipo: TipoCampo;
	/** Texto de dica dentro da caixa vazia ("Number", "dias antes"…). */
	placeholder?: string;
}

export interface Quadrante {
	id: string;
	titulo: string;
	icone?: string;
	/**
	 * A cor do quadrante. Aceita duas formas:
	 * - nome de cor do tema (chave de CORES): "azul", "verde"…
	 * - hex livre "#rrggbb" — inclusive vindo da paleta do plugin Customize
	 * `undefined` usa a cor de destaque do tema.
	 */
	cor?: string;
	/** Aparência só deste quadrante; o que não define, herda do estilo global. */
	estilo?: EstiloQuadrante;
	/**
	 * Se este quadrante personaliza a própria aparência ou herda o global.
	 *
	 * Existe SEPARADA dos valores em `estilo` de propósito: ao voltar para "herdar", os ajustes
	 * que ela fez continuam guardados ali e reaparecem se ela personalizar de novo. Sem a flag, a
	 * única forma de voltar a herdar seria apagar `estilo` — e um clique perderia o trabalho.
	 *
	 * `undefined` = herda (o padrão). Quem lê a aparência tem que consultar isto ANTES de aplicar
	 * `estilo`, senão os valores adormecidos vazariam para o dashboard — ver `estiloAtivo()`.
	 */
	personalizaEstilo?: boolean;
	/**
	 * Aparência dos botões DESTE quadrante; o que não define, herda do global — e cada botão
	 * ainda pode sobrescrever isto. Camada do meio da herança de três níveis.
	 */
	estiloBotao?: EstiloBotao;
	/** O mesmo contrato de `personalizaEstilo`, para a aparência dos botões deste quadrante. */
	personalizaEstiloBotao?: boolean;
	/**
	 * Quantas colunas do grid este quadrante ocupa. `undefined` = 1 (o padrão).
	 * "cheio" ocupa a linha inteira, seja qual for o número de colunas do dashboard.
	 *
	 * É isto que permite "três em cima, um largo embaixo" ou "dois em cima, três embaixo":
	 * o grid tem N colunas fixas e cada quadrante decide a sua fatia.
	 */
	largura?: number | "cheio";
	/**
	 * O que o quadrante mostra. `undefined` = "botoes" (o padrão, e o que todo quadrante
	 * existente antes desta funcionalidade era).
	 *
	 * "separador" é um caso à parte: não é um card, e sim um respiro entre linhas — uma linha
	 * divisória, um título de seção, ou só espaço em branco. Ocupa sempre a linha inteira, porque
	 * um separador que dividisse só metade da largura não separaria nada.
	 *
	 * "ambos" mostra o markdown E os botões no mesmo card, nessa ordem. Existe porque "botões" e
	 * "conteúdo livre" eram excludentes, e uma explicação acima dos botões — o uso mais natural de
	 * um quadrante — exigia dois quadrantes lado a lado fingindo ser um.
	 */
	conteudo?: "botoes" | "markdown" | "separador" | "ambos";
	/** Aparência do separador, quando `conteudo === "separador"`. */
	separador?: {
		/** Texto opcional ao lado da linha (ou no lugar dela, se `linha` for false). */
		texto?: string;
		/** Desenhar a linha divisória. */
		linha?: boolean;
		/** Espaço acima e abaixo, em px. */
		espaco?: number;
	};
	/**
	 * O markdown do quadrante, quando `conteudo === "markdown"`. Renderizado pelo Obsidian, então
	 * aceita tudo que uma nota aceita: texto, `![[embed]]`, blocos de Base, Dataview, callouts.
	 */
	markdown?: string;
	botoes: Botao[];
}

export interface Dashboard {
	id: string;
	/**
	 * O nome da PREDEFINIÇÃO, não de nenhuma nota.
	 *
	 * Como o mesmo dashboard pode valer para várias notas (um "mapa de cliente" aplicado a vinte
	 * clientes), este nome identifica o conjunto de botões no painel — e só lá. Cada nota mantém
	 * o próprio nome de arquivo, que o plugin nunca toca.
	 */
	nome: string;
	/**
	 * As notas em que este dashboard é escrito, com extensão ("Clientes/Acme.md").
	 *
	 * É uma lista porque a mesma configuração de botões costuma servir a várias notas do mesmo
	 * tipo. Mudar um botão aqui atualiza todas elas no próximo salvamento — é o que faz disto uma
	 * predefinição em vez de uma cópia.
	 *
	 * Lista vazia é válido: um dashboard em montagem, ainda sem destino.
	 */
	caminhosNota: string[];
	/** Quantas colunas o grid tem em tela larga. Entre 1 e 4. */
	colunas: number;
	/**
	 * Largura do dashboard na nota:
	 * - "leitura": respeita a largura de leitura do Obsidian (padrão)
	 * - "total": ocupa toda a largura disponível, ignorando a largura de leitura
	 * - número: largura máxima em px
	 */
	largura: "leitura" | "total" | number;
	quadrantes: Quadrante[];
}

export interface DadosDashHome {
	dashboards: Dashboard[];
	/** id do dashboard que o painel de configurações está editando. */
	dashboardAtivoId: string;
	/** Tamanho dos botões no dashboard renderizado. */
	tamanhoBotao: "pequeno" | "medio" | "grande";
	/** Mostrar o título do quadrante acima dos botões. */
	mostrarTitulos: boolean;
	/** Aparência aplicada a todos os quadrantes, salvo o que cada um sobrescrever. */
	estiloGlobal: EstiloQuadrante;
	/**
	 * Aparência aplicada a todos os botões, salvo o que cada quadrante — e depois cada botão —
	 * sobrescrever. Base da herança de três níveis.
	 */
	estiloBotaoGlobal: EstiloBotao;
	/**
	 * A biblioteca de botões pré-configurados, compartilhada por TODOS os dashboards (escolha dela).
	 *
	 * Fica na raiz, e não dentro de `Dashboard`, exatamente por isso: cadastrar uma vez e usar em
	 * qualquer predefinição é o ponto do recurso. Num dashboard só, ela recadastraria tudo ao criar
	 * o próximo.
	 */
	botoesSalvos: BotaoSalvo[];
}

/**
 * As cores disponíveis para os quadrantes. Os valores são variáveis do tema do Obsidian, não hex
 * fixo: assim o dashboard acompanha o tema claro/escuro da usuária sem precisar de dois conjuntos.
 */
export const CORES: Record<string, string> = {
	vermelho: "var(--color-red)",
	laranja: "var(--color-orange)",
	amarelo: "var(--color-yellow)",
	verde: "var(--color-green)",
	turquesa: "var(--color-cyan)",
	azul: "var(--color-blue)",
	roxo: "var(--color-purple)",
	rosa: "var(--color-pink)",
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A cor de um quadrante como valor CSS. Aceita nome do tema ("azul") ou hex livre ("#e03131"),
 * e cai na cor de destaque quando não reconhece — nunca devolve valor inválido, porque isso
 * derrubaria a variável e deixaria o card sem cor nenhuma.
 */
export function corCss(cor: string | undefined): string {
	if (!cor) return "var(--interactive-accent)";
	const limpa = cor.trim();
	if (CORES[limpa]) return CORES[limpa];
	if (HEX.test(limpa)) return limpa.toLowerCase();
	return "var(--interactive-accent)";
}

/** true se a cor é um hex livre (e não um nome do tema). */
export function ehHex(cor: string | undefined): boolean {
	return !!cor && HEX.test(cor.trim());
}

export const DASHBOARD_PADRAO_ID = "principal";

export const DADOS_PADRAO: DadosDashHome = {
	dashboards: [
		{
			id: DASHBOARD_PADRAO_ID,
			// "Dash Home" é o plugin; a predefinição se chama "Home" porque é o primeiro uso dela.
			// Nada aqui trata essa nota como especial — qualquer nota pode receber um dashboard.
			nome: "Home",
			caminhosNota: ["Home.md"],
			colunas: 3,
			largura: "leitura",
			quadrantes: [],
		},
	],
	dashboardAtivoId: DASHBOARD_PADRAO_ID,
	tamanhoBotao: "medio",
	mostrarTitulos: true,
	estiloGlobal: {},
	estiloBotaoGlobal: {},
	botoesSalvos: [],
};

/** Devolvido quando não há dashboard nenhum. Congelado: ninguém escreve nele por acidente. */
const DASHBOARD_VAZIO: Dashboard = Object.freeze({
	id: "",
	nome: "",
	caminhosNota: Object.freeze([]) as unknown as string[],
	colunas: 3,
	largura: "leitura",
	quadrantes: Object.freeze([]) as unknown as Quadrante[],
});

/**
 * Quantas colunas um quadrante pode ocupar: de 1 até o total do dashboard, ou "cheio".
 *
 * O teto importa: um `grid-column: span 3` num grid de 2 colunas faz o CSS criar uma terceira
 * coluna implícita, e o layout inteiro se desfaz. Como o número de colunas do dashboard pode
 * diminuir depois que a largura foi escolhida, a checagem roda a cada carga.
 *
 * `undefined` (o padrão, 1 coluna) é preservado como `undefined` — não gravamos o padrão.
 */
export function limitarLarguraQuadrante(
	valor: unknown,
	colunasDoDashboard: number,
): number | "cheio" | undefined {
	if (valor === "cheio") return "cheio";
	if (typeof valor !== "number" || !Number.isFinite(valor)) return undefined;
	const n = Math.round(valor);
	if (n <= 1) return undefined;
	// Ocupar todas as colunas É "cheio" — normalizar evita dois estados com o mesmo resultado.
	if (n >= colunasDoDashboard) return "cheio";
	return n;
}

/**
 * Largura em px permitida. Abaixo de 400 o grid não cabe; acima de 1600 não há tela onde a
 * diferença apareça — e um valor maior que a janela dá a impressão de que a configuração não
 * funcionou (o CSS trava em `max-width: 100%` de qualquer forma).
 */
export function limitarLargura(valor: unknown): "leitura" | "total" | number {
	if (valor === "total" || valor === "leitura") return valor;
	if (typeof valor === "number" && Number.isFinite(valor)) {
		return Math.min(1600, Math.max(400, Math.round(valor)));
	}
	return "leitura";
}

/**
 * As notas de um dashboard, aceitando o formato antigo.
 *
 * Até a 0.2.1 o campo era `caminhoNota: string` (uma nota só). Um data.json salvo naquela versão
 * — que é o caso do vault de trabalho dela — precisa continuar funcionando sem perder o destino
 * já configurado, então o valor antigo vira o primeiro item da lista.
 *
 * A migração é só de LEITURA: o campo antigo não é apagado do objeto aqui. Se ela voltar para uma
 * versão anterior do plugin, o dashboard ainda aponta para a nota certa.
 */
function migrarCaminhos(dash: Dashboard & { caminhoNota?: unknown }): string[] {
	const limpar = (lista: unknown[]): string[] => {
		const vistos = new Set<string>();
		const saida: string[] = [];
		for (const item of lista) {
			if (typeof item !== "string") continue;
			const caminho = item.trim();
			// Caminho vazio viraria ".md" — um arquivo oculto e sem nome (o bug da sessão 3).
			if (!caminho) continue;
			// Duas entradas iguais fariam a mesma nota ser escrita duas vezes por salvamento.
			const chave = caminho.toLowerCase();
			if (vistos.has(chave)) continue;
			vistos.add(chave);
			saida.push(caminho);
		}
		return saida;
	};

	if (Array.isArray(dash.caminhosNota)) {
		const lista = limpar(dash.caminhosNota);
		// Se a lista existe mas ficou vazia depois da limpeza, o formato antigo ainda pode ter o
		// destino real — vale mais tentar recuperá-lo do que devolver um dashboard sem nota.
		if (lista.length > 0) return lista;
	}

	if (typeof dash.caminhoNota === "string") {
		const antigo = limpar([dash.caminhoNota]);
		if (antigo.length > 0) return antigo;
	}

	// Sem nada aproveitável: lista vazia. Não inventamos `${nome}.md` como antes, porque agora o
	// nome é da predefinição e não de uma nota — gerar um arquivo a partir dele criaria uma nota
	// que ela não pediu.
	return [];
}

/**
 * O id anterior do plugin, quando ele se chamava "Dash Home".
 *
 * O id define a PASTA em `.obsidian/plugins/`, e é de lá que o `loadData()` lê. Ao renomear para
 * `dash-cards`, o Obsidian passou a ver um plugin novo, com pasta nova e sem `data.json` — ou seja,
 * todos os dashboards dela ficariam para trás na pasta antiga, em silêncio.
 */
const ID_ANTIGO = "dash-home";

/**
 * Lê o `data.json` da instalação antiga, se houver.
 *
 * Passa pelo `vault.adapter` porque `loadData()` só enxerga a pasta do id ATUAL. Devolve `null`
 * em qualquer falha (pasta inexistente, JSON quebrado, permissão): não achar a configuração antiga
 * é o caso normal de quem instala o plugin agora, e não pode impedir a carga.
 */
async function dadosDaInstalacaoAntiga(plugin: Plugin): Promise<unknown | null> {
	try {
		const caminho = `${plugin.app.vault.configDir}/plugins/${ID_ANTIGO}/data.json`;
		if (!(await plugin.app.vault.adapter.exists(caminho))) return null;
		const bruto = await plugin.app.vault.adapter.read(caminho);
		const lido = JSON.parse(bruto);
		return lido && typeof lido === "object" ? lido : null;
	} catch {
		return null;
	}
}

export async function carregarDados(plugin: Plugin): Promise<DadosDashHome> {
	let data = await plugin.loadData();

	// Migração de "Dash Home" para "Dash Cards": sem `data.json` próprio, herda o da pasta antiga.
	//
	// A condição é `data` AUSENTE, e não "data vazio": depois da primeira gravação o plugin novo
	// tem o seu próprio arquivo, e reler o antigo desfaria tudo que ela fez desde então. A pasta
	// antiga NÃO é apagada — se ela voltar para uma versão anterior do plugin, a configuração ainda
	// está lá (mesma regra da migração de `caminhoNota`, sessão 14).
	if (!data) {
		const antigo = await dadosDaInstalacaoAntiga(plugin);
		if (antigo) {
			data = antigo;
			// Grava já na pasta nova: sem isto, a herança se repetiria a cada carga e uma exclusão
			// de dashboard voltaria sozinha na próxima abertura do Obsidian.
			await plugin.saveData(antigo);
			new Notice("Dash Cards: configuração do Dash Home importada.");
		}
	}

	// Object.assign raso (padrão dos outros plugins do vault): um campo novo adicionado ao
	// DADOS_PADRAO nasce preenchido mesmo em data.json antigos.
	const dados = Object.assign({}, DADOS_PADRAO, data) as DadosDashHome;

	// Blindagens contra data.json corrompido ou editado à mão. O painel de configurações itera
	// sobre tudo isto sem checar de novo, então a normalização acontece aqui, uma vez só.
	if (!Array.isArray(dados.dashboards)) dados.dashboards = [clonarDashboard(DADOS_PADRAO.dashboards[0])];
	dados.dashboards = dados.dashboards.filter((d) => d && typeof d.id === "string");
	if (dados.dashboards.length === 0) dados.dashboards = [clonarDashboard(DADOS_PADRAO.dashboards[0])];

	// `estiloGlobal` é aninhado e o Object.assign acima é raso: um data.json salvo antes desta
	// funcionalidade viria sem ele.
	if (!dados.estiloGlobal || typeof dados.estiloGlobal !== "object") dados.estiloGlobal = {};

	// Mesmo motivo, para o estilo de botão: um data.json salvo antes desta funcionalidade vem sem
	// ele. A normalização descarta campo inválido em vez de corrigi-lo — ver `estilo-botao.ts`.
	dados.estiloBotaoGlobal = normalizarEstiloBotao(dados.estiloBotaoGlobal) ?? {};

	// A biblioteca é lista e o Object.assign é raso: um data.json anterior a ela vem sem a chave.
	dados.botoesSalvos = normalizarBotoesSalvos(dados.botoesSalvos);

	for (const dash of dados.dashboards) {
		dash.colunas = limitarColunas(dash.colunas);
		dash.largura = limitarLargura(dash.largura);
		dash.caminhosNota = migrarCaminhos(dash);
		if (!Array.isArray(dash.quadrantes)) dash.quadrantes = [];
		for (const quad of dash.quadrantes) {
			if (quad.estilo && typeof quad.estilo !== "object") delete quad.estilo;

			// A chave "personaliza ou herda". Um valor que não é booleano cai em `undefined`
			// (= herda), o estado neutro — a mesma regra de `normalizarEstiloBotao`: campo inválido
			// é REMOVIDO, não corrigido, para não prender a camada num valor que ela não escolheu.
			//
			// Um data.json anterior a este campo vem sem ele, e por isso todo quadrante nasceria
			// herdando — apagando a aparência que ela já tinha configurado. Daí a compatibilidade:
			// quem já tem estilo próprio gravado É porque personalizou.
			if (typeof quad.personalizaEstilo !== "boolean") {
				quad.personalizaEstilo = temAlgumCampo(quad.estilo) ? true : undefined;
			}
			if (typeof quad.personalizaEstiloBotao !== "boolean") {
				quad.personalizaEstiloBotao = temAlgumCampo(quad.estiloBotao) ? true : undefined;
			}
			// `undefined` apaga a chave na serialização — não fica `estiloBotao: null` no data.json.
			quad.estiloBotao = normalizarEstiloBotao(quad.estiloBotao);
			quad.largura = limitarLarguraQuadrante(quad.largura, dash.colunas);
			if (quad.separador && typeof quad.separador !== "object") delete quad.separador;
			if (quad.separador && typeof quad.separador.espaco === "number") {
				// Um espaço absurdo empurraria o resto do dashboard para fora da tela.
				quad.separador.espaco = Math.min(200, Math.max(0, Math.round(quad.separador.espaco)));
			}
			if (!Array.isArray(quad.botoes)) quad.botoes = [];
			// Um tipo desconhecido viraria um botão que não faz nada ao clicar; "nota" é o
			// fallback seguro (no pior caso avisa que a nota não existe).
			for (const botao of quad.botoes) {
				// Um `salvoId` que não é string sobrevivente viraria um vínculo que nunca resolve, e o
				// botão mostraria o esqueleto para sempre. Vazio = não vinculado, o estado neutro.
				if (typeof botao.salvoId !== "string" || !botao.salvoId) delete botao.salvoId;
				if (!TIPOS_VALIDOS.has(botao.tipo)) botao.tipo = "nota";
				botao.estilo = normalizarEstiloBotao(botao.estilo);
				botao.propriedades = normalizarPropriedades(botao.propriedades);
				botao.campo = normalizarCampo(botao.campo);
				botao.criar = normalizarCriar(botao.criar);
				migrarCampoParaOperacao(botao);
			}
		}
	}

	// Depois de tudo normalizado: os botões soltos que ela montou antes da biblioteca viram botões
	// salvos e vinculados. Roda por último porque compara botões já limpos — comparar antes faria
	// dois botões idênticos parecerem diferentes por causa de um campo que a normalização removeria.
	migrarBotoesParaBiblioteca(dados);

	return dados;
}

/**
 * Converte todo botão solto dos quadrantes em um botão SALVO, vinculado.
 *
 * Existe porque o quadrante deixou de poder criar botão próprio (pedido dela na s28): sem isto, os
 * botões que ela já montou seriam os únicos do vault impossíveis de editar — o editor sumiu do
 * quadrante, e eles não estariam na biblioteca para serem editados de lá.
 *
 * **Botões iguais viram UM só** (escolha dela). Duas consequências que valem o cuidado:
 *
 * - A biblioteca não nasce com vinte "Início" repetidos, um por card.
 * - Editar esse "Início" passa a mudar os vinte cards de uma vez — que é o ponto do vinculado.
 *
 * A igualdade é por CONTEÚDO (`assinaturaDoBotao`), incluindo a aparência: dois botões que só
 * diferem na cor continuam separados, senão a migração mudaria o visual do dashboard dela.
 */
function migrarBotoesParaBiblioteca(dados: DadosDashHome): void {
	const salvos = (dados.botoesSalvos ??= []);

	// Os moldes que já existem entram no índice: se ela cadastrou "Início" na biblioteca e tem um
	// botão solto igual, o solto se liga ao molde dela em vez de criar um segundo idêntico.
	const porAssinatura = new Map<string, BotaoSalvo>();
	for (const salvo of salvos) {
		const chave = assinaturaDoBotao(salvo);
		if (!porAssinatura.has(chave)) porAssinatura.set(chave, salvo);
	}

	for (const dash of dados.dashboards) {
		for (const quad of dash.quadrantes) {
			for (const botao of quad.botoes) {
				// Já vinculado: nada a fazer. (Vínculo quebrado também é pulado — o id dele pode
				// voltar a existir, e converter aqui criaria um molde duplicado.)
				if (botao.salvoId) continue;

				const chave = assinaturaDoBotao(botao);
				let molde = porAssinatura.get(chave);

				if (!molde) {
					molde = {
						id: novoId("s"),
						texto: botao.texto,
						icone: botao.icone,
						tipo: botao.tipo,
						destino: botao.destino,
						// Cópia profunda: sem ela, o molde e o botão compartilhariam os objetos, e
						// editar um mexeria no outro em silêncio (a regra de sempre).
						propriedades: botao.propriedades?.map((p) => ({
							...p,
							id: novoId("p"),
							opcoes: p.opcoes ? [...p.opcoes] : undefined,
						})),
						criar: botao.criar ? { ...botao.criar } : undefined,
						// A aparência vai junto (escolha dela): assim nada muda de visual no
						// dashboard depois da migração — só o lugar de editar mudou.
						estilo: botao.estilo ? { ...botao.estilo } : undefined,
					};
					salvos.push(molde);
					porAssinatura.set(chave, molde);
				}

				botao.salvoId = molde.id;
			}
		}
	}
}

/**
 * A identidade de um botão pelo CONTEÚDO — o que decide se dois viram o mesmo molde.
 *
 * Inclui a aparência de propósito: dois botões que só diferem na cor precisam continuar dois, senão
 * a migração mudaria o visual do dashboard dela sem pedir.
 *
 * `JSON.stringify` de uma lista em ORDEM FIXA (e não do objeto inteiro): a ordem das chaves de um
 * objeto varia conforme ele foi montado, e dois botões iguais teriam assinaturas diferentes.
 */
function assinaturaDoBotao(botao: {
	texto?: string;
	icone?: string;
	tipo?: string;
	destino?: string;
	propriedades?: MudancaPropriedade[];
	criar?: CriarNota;
	estilo?: EstiloBotao;
}): string {
	const props = (botao.propriedades ?? []).map((p) => [
		p.nome,
		p.operacao,
		p.tipo,
		p.valor,
		p.valor2 ?? "",
		// A lista entra como LISTA, e não juntada por um separador: qualquer separador
		// escolhido poderia aparecer dentro de uma opção digitada por ela, e aí duas listas
		// diferentes gerariam a mesma assinatura — dois botões distintos virariam um molde só.
		p.opcoes ?? [],
		p.formato ?? "",
		p.dica ?? "",
	]);

	const criar = botao.criar
		? [botao.criar.template, botao.criar.pasta, botao.criar.nomeSugerido ?? ""]
		: null;

	// O estilo é um objeto de chaves opcionais: as entradas são ordenadas por nome para a
	// assinatura não depender da ordem em que os campos foram gravados.
	const estilo = botao.estilo
		? Object.entries(botao.estilo)
				.filter(([, v]) => v !== undefined)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		: null;

	return JSON.stringify([
		botao.texto ?? "",
		botao.icone ?? "",
		botao.tipo ?? "nota",
		botao.destino ?? "",
		props,
		criar,
		estilo,
	]);
}

const TIPOS_VALIDOS = new Set<string>(["nota", "pasta", "busca", "comando", "propriedade", "campo", "criar"]);

const OPERACOES_VALIDAS = new Set<string>(["definir", "alternar", "escolher", "digitar", "interruptor"]);
const TIPOS_VALOR_VALIDOS = new Set<string>(["texto", "numero", "booleano", "data", "vazio"]);
const TIPOS_CAMPO_VALIDOS = new Set<string>(["numero", "texto", "data"]);

/**
 * Blindagem do campo de digitação vindo do data.json.
 *
 * Mesma regra das propriedades: SEM NOME é descartado, e não corrigido — o nome é a chave que
 * será escrita no frontmatter dela, e inventar um gravaria um campo que ela nunca pediu. Já um
 * tipo inválido cai em "texto", que aceita qualquer conteúdo e por isso não perde o que ela
 * digitar.
 */
export function normalizarCampo(valor: unknown): CampoEntrada | undefined {
	if (!valor || typeof valor !== "object") return undefined;
	const bruto = valor as Partial<CampoEntrada>;

	const nome = typeof bruto.nome === "string" ? bruto.nome.trim() : "";
	if (!nome) return undefined;

	const tipo: TipoCampo =
		typeof bruto.tipo === "string" && TIPOS_CAMPO_VALIDOS.has(bruto.tipo)
			? (bruto.tipo as TipoCampo)
			: "texto";

	const campo: CampoEntrada = { nome, tipo };
	// Só grava se houver texto de fato: um placeholder vazio no data.json é ruído, e a chave
	// ausente já significa "sem dica".
	if (typeof bruto.placeholder === "string" && bruto.placeholder.trim()) {
		campo.placeholder = bruto.placeholder;
	}
	return campo;
}

/**
 * Blindagem do "criar nota" vindo do data.json.
 *
 * Aqui NADA é obrigatório, ao contrário do campo e das propriedades: sem template a nota nasce em
 * branco, e sem pasta ela vai para a raiz. Os dois são escolhas legítimas, então o objeto sobrevive
 * mesmo vazio — o que não pode é virar `{}` com chaves de tipo errado.
 */
export function normalizarCriar(valor: unknown): CriarNota | undefined {
	if (!valor || typeof valor !== "object") return undefined;
	const bruto = valor as Partial<CriarNota>;

	const criar: CriarNota = {
		template: typeof bruto.template === "string" ? bruto.template.trim() : "",
		pasta: typeof bruto.pasta === "string" ? bruto.pasta.trim() : "",
	};
	if (typeof bruto.nomeSugerido === "string" && bruto.nomeSugerido.trim()) {
		criar.nomeSugerido = bruto.nomeSugerido;
	}
	return criar;
}

/**
 * Converte o botão do tipo "campo" (0.9.x) na operação "digitar" de uma propriedade (s23).
 *
 * O tipo próprio existiu por duas versões e SÓ preenchia uma propriedade — ou seja, era a mesma
 * escolha em dois lugares do painel. Ela pediu a unificação, e esta função é o que impede que os
 * campos já montados sumam junto com o tipo antigo.
 *
 * O `botao.campo` NÃO é apagado, pela regra de sempre (a migração de `caminhoNota`, s14): se ela
 * voltar para a 0.9.x, o campo dela ainda está lá.
 */
function migrarCampoParaOperacao(botao: Botao): void {
	if (botao.tipo !== "campo") return;

	// Vira um botão de propriedade com uma mudança do tipo "digitar".
	botao.tipo = "propriedade";

	const campo = botao.campo;
	if (!campo?.nome) return;

	// Se já existe uma mudança para esta propriedade (ela pode ter recarregado duas vezes), não
	// duplica: a segunda viraria uma caixa gêmea no card.
	const jaTem = (botao.propriedades ?? []).some(
		(m) => m.operacao === "digitar" && m.nome === campo.nome,
	);
	if (jaTem) return;

	const mudanca: MudancaPropriedade = {
		id: novoId("p"),
		nome: campo.nome,
		operacao: "digitar",
		// Em "digitar" o tipo real é derivado do formato na hora de gravar; aqui só um valor válido.
		tipo: "texto",
		valor: "",
		formato: campo.tipo,
	};
	if (campo.placeholder) mudanca.dica = campo.placeholder;

	// À FRENTE das outras: um botão que virou caixa de digitação tem esta como razão de existir, e
	// `ehControle` olha a primeira mudança para decidir o que desenhar.
	botao.propriedades = [mudanca, ...(botao.propriedades ?? [])];
}

/**
 * Blindagem da lista de propriedades vinda do data.json.
 *
 * Uma mudança SEM NOME é descartada, e não corrigida para um nome qualquer: o nome é a chave que
 * vai ser escrita no frontmatter da usuária, e inventar um significa gravar um campo que ela nunca
 * pediu numa nota dela. Já operação e tipo inválidos caem no padrão, porque aí só o comportamento
 * é ambíguo — o alvo continua sendo o que ela escolheu.
 *
 * Devolve `undefined` (e não lista vazia) quando não sobra nada, para a chave sumir do data.json.
 */
export function normalizarPropriedades(valor: unknown): MudancaPropriedade[] | undefined {
	if (!Array.isArray(valor)) return undefined;

	const saida: MudancaPropriedade[] = [];
	for (const item of valor) {
		if (!item || typeof item !== "object") continue;
		const bruto = item as Partial<MudancaPropriedade>;
		const nome = typeof bruto.nome === "string" ? bruto.nome.trim() : "";
		if (!nome) continue;

		const operacao: OperacaoPropriedade =
			typeof bruto.operacao === "string" && OPERACOES_VALIDAS.has(bruto.operacao)
				? (bruto.operacao as OperacaoPropriedade)
				: "definir";
		const tipo: TipoValorPropriedade =
			typeof bruto.tipo === "string" && TIPOS_VALOR_VALIDOS.has(bruto.tipo)
				? (bruto.tipo as TipoValorPropriedade)
				: "texto";

		const mudanca: MudancaPropriedade = {
			id: typeof bruto.id === "string" && bruto.id ? bruto.id : novoId("p"),
			nome,
			operacao,
			tipo,
			valor: typeof bruto.valor === "string" ? bruto.valor : "",
		};
		// Só sobrevive no "alternar": guardar o segundo valor de um "definir" deixaria lixo no
		// data.json que reapareceria se ela voltasse a alternar depois.
		if (operacao === "alternar" && typeof bruto.valor2 === "string") mudanca.valor2 = bruto.valor2;

		// As opções, ao contrário, sobrevivem em QUALQUER operação: montar uma lista de seis valores
		// é trabalho, e apagá-la porque ela espiou o "definir" seria perder esse trabalho em
		// silêncio. Fora do "escolher" a lista simplesmente não é usada.
		if (Array.isArray(bruto.opcoes)) {
			const opcoes = limparOpcoes(bruto.opcoes);
			if (opcoes.length > 0) mudanca.opcoes = opcoes;
		}

		// `formato` e `dica` seguem a mesma regra das opções: sobrevivem em qualquer operação, para
		// espiar o "definir" não apagar o que ela configurou no "digitar".
		if (typeof bruto.formato === "string" && TIPOS_CAMPO_VALIDOS.has(bruto.formato)) {
			mudanca.formato = bruto.formato as TipoCampo;
		}
		if (typeof bruto.dica === "string" && bruto.dica.trim()) mudanca.dica = bruto.dica;

		saida.push(mudanca);
	}

	return saida.length > 0 ? saida : undefined;
}

/**
 * A lista de opções do "escolher", limpa.
 *
 * Repetida seria a mesma opção duas vezes na lista do clique; vazia viraria uma linha em branco
 * clicável. A ordem é preservada porque é a ordem em que ela vai ver as opções — e ordenar por
 * conta própria desfaria a escolha dela (fluxo natural: "a fazer, fazendo, feito" não é alfabético).
 *
 * A comparação de repetido é EXATA, sem `toLowerCase`: no frontmatter "Feito" e "feito" são valores
 * diferentes, e descartar um deles como duplicata mudaria o que é gravado na nota.
 */
export function limparOpcoes(lista: unknown[]): string[] {
	const vistos = new Set<string>();
	const saida: string[] = [];
	for (const item of lista) {
		if (typeof item !== "string") continue;
		const opcao = item.trim();
		if (!opcao || vistos.has(opcao)) continue;
		vistos.add(opcao);
		saida.push(opcao);
	}
	return saida;
}

/**
 * Blindagem da biblioteca de botões vinda do data.json.
 *
 * SEM ID é descartado, e não corrigido com um id novo: o id é o que os botões dos dashboards
 * apontam, e inventar um deixaria os vínculos existentes apontando para o nada — o molde apareceria
 * na lista mas nenhum botão o encontraria.
 *
 * O resto segue as regras já usadas nos botões: tipo inválido cai em "nota", e as partes aninhadas
 * passam pelos normalizadores que já existem.
 */
export function normalizarBotoesSalvos(valor: unknown): BotaoSalvo[] {
	if (!Array.isArray(valor)) return [];

	const saida: BotaoSalvo[] = [];
	const vistos = new Set<string>();
	for (const item of valor) {
		if (!item || typeof item !== "object") continue;
		const bruto = item as Partial<BotaoSalvo>;
		if (typeof bruto.id !== "string" || !bruto.id) continue;
		// Id repetido faria `find` devolver sempre o primeiro: o segundo molde seria inalcançável,
		// e editá-lo não mudaria botão nenhum.
		if (vistos.has(bruto.id)) continue;
		vistos.add(bruto.id);

		const salvo: BotaoSalvo = {
			id: bruto.id,
			texto: typeof bruto.texto === "string" ? bruto.texto : "",
			tipo:
				typeof bruto.tipo === "string" && TIPOS_VALIDOS.has(bruto.tipo)
					? (bruto.tipo as TipoAcao)
					: "nota",
			destino: typeof bruto.destino === "string" ? bruto.destino : "",
		};
		if (typeof bruto.icone === "string" && bruto.icone) salvo.icone = bruto.icone;
		salvo.propriedades = normalizarPropriedades(bruto.propriedades);
		salvo.criar = normalizarCriar(bruto.criar);
		salvo.estilo = normalizarEstiloBotao(bruto.estilo);

		saida.push(salvo);
	}
	return saida;
}

/** Cadastra um botão novo na biblioteca, vazio e pronto para ser configurado. */
export function criarBotaoSalvo(dados: DadosDashHome, texto: string): BotaoSalvo {
	const salvo: BotaoSalvo = {
		id: novoId("s"),
		texto: texto.trim() || "Novo botão salvo",
		tipo: "nota",
		destino: "",
	};
	(dados.botoesSalvos ??= []).push(salvo);
	return salvo;
}

/**
 * Coloca no quadrante um botão VINCULADO a um molde da biblioteca.
 *
 * O botão nasce só com o vínculo: o conteúdo vem de `botaoResolvido()` na hora de desenhar. Copiar
 * os campos aqui pareceria funcionar e divergiria do molde na primeira edição dele — que é
 * justamente o contrário do que ela escolheu.
 */
export function usarBotaoSalvo(quadrante: Quadrante, salvo: BotaoSalvo): Botao {
	const botao: Botao = {
		id: novoId("b"),
		salvoId: salvo.id,
		// Guardados como retrato do molde no momento em que foi usado: é o que sobra se o molde for
		// excluído, e o que `desvincular()` promove a botão próprio.
		texto: salvo.texto,
		icone: salvo.icone,
		tipo: salvo.tipo,
		destino: salvo.destino,
		propriedades: salvo.propriedades?.map((p) => ({ ...p, id: novoId("p"), opcoes: p.opcoes ? [...p.opcoes] : undefined })),
		criar: salvo.criar ? { ...salvo.criar } : undefined,
		estilo: salvo.estilo ? { ...salvo.estilo } : undefined,
	};
	quadrante.botoes.push(botao);
	return botao;
}

/**
 * Troca qual botão salvo este botão do card usa, no LUGAR.
 *
 * No lugar (em vez de remover e adicionar) porque a posição dele no card é escolha dela: recriar o
 * botão o jogaria para o fim da lista, e ela teria que reordenar de novo.
 *
 * O retrato é atualizado junto, pelo motivo de sempre: é o que sobra se o molde novo for excluído.
 */
export function trocarBotaoSalvo(botao: Botao, salvo: BotaoSalvo): void {
	botao.salvoId = salvo.id;
	botao.texto = salvo.texto;
	botao.icone = salvo.icone;
	botao.tipo = salvo.tipo;
	botao.destino = salvo.destino;
	botao.propriedades = salvo.propriedades?.map((p) => ({
		...p,
		id: novoId("p"),
		opcoes: p.opcoes ? [...p.opcoes] : undefined,
	}));
	botao.criar = salvo.criar ? { ...salvo.criar } : undefined;
	botao.estilo = salvo.estilo ? { ...salvo.estilo } : undefined;
}

/**
 * Corta o vínculo: o botão vira independente, com os valores que o molde tem AGORA.
 *
 * Sem isto, um botão vinculado seria uma prisão — ela não poderia mudar um único dashboard sem
 * mudar todos. E a cópia é dos valores atuais (não do retrato guardado) porque é o que ela está
 * vendo na tela; devolver um estado antigo pareceria o botão mudar sozinho ao desvincular.
 */
export function desvincularBotao(botao: Botao, salvos: BotaoSalvo[] | undefined): void {
	const atual = botaoResolvido(botao, salvos);
	botao.texto = atual.texto;
	botao.icone = atual.icone;
	botao.tipo = atual.tipo;
	botao.destino = atual.destino;
	// Cópia profunda com ids novos: as mudanças vinham do molde e continuariam compartilhadas com
	// ele — editar o botão desvinculado mexeria no molde, em silêncio.
	botao.propriedades = atual.propriedades?.map((p) => ({
		...p,
		id: novoId("p"),
		opcoes: p.opcoes ? [...p.opcoes] : undefined,
	}));
	botao.criar = atual.criar ? { ...atual.criar } : undefined;
	botao.estilo = atual.estilo ? { ...atual.estilo } : undefined;
	delete botao.salvoId;
}

/** Em quantos quadrantes (de todos os dashboards) um molde é usado. */
export function usosDoBotaoSalvo(dados: DadosDashHome, salvoId: string): number {
	let total = 0;
	for (const dash of dados.dashboards) {
		for (const quad of dash.quadrantes) {
			for (const botao of quad.botoes) {
				if (botao.salvoId === salvoId) total++;
			}
		}
	}
	return total;
}

/**
 * Exclui um molde da biblioteca e DESVINCULA os botões que o usavam, em vez de deixá-los órfãos.
 *
 * Um vínculo quebrado já cairia no retrato guardado (`botaoResolvido`), então nada sumiria da nota
 * dela de qualquer forma. Desvincular de fato é o passo a mais que evita um botão que parece
 * vinculado a um molde inexistente — e que voltaria a se vincular se um id igual reaparecesse.
 */
export function removerBotaoSalvo(dados: DadosDashHome, salvoId: string): boolean {
	const i = (dados.botoesSalvos ?? []).findIndex((s) => s.id === salvoId);
	if (i < 0) return false;

	// Desvincula ANTES de remover: `desvincularBotao` lê o molde para copiar os valores atuais.
	for (const dash of dados.dashboards) {
		for (const quad of dash.quadrantes) {
			for (const botao of quad.botoes) {
				if (botao.salvoId === salvoId) desvincularBotao(botao, dados.botoesSalvos);
			}
		}
	}

	dados.botoesSalvos.splice(i, 1);
	return true;
}

/** Duplica um molde da biblioteca, com a cópia logo abaixo do original. */
export function duplicarBotaoSalvo(dados: DadosDashHome, indice: number): BotaoSalvo | undefined {
	const original = (dados.botoesSalvos ?? [])[indice];
	if (!original) return undefined;

	const copia: BotaoSalvo = {
		...original,
		id: novoId("s"),
		texto: `${original.texto} (cópia)`,
		estilo: original.estilo ? { ...original.estilo } : undefined,
		criar: original.criar ? { ...original.criar } : undefined,
		propriedades: original.propriedades?.map((p) => ({
			...p,
			id: novoId("p"),
			opcoes: p.opcoes ? [...p.opcoes] : undefined,
		})),
	};

	dados.botoesSalvos.splice(indice + 1, 0, copia);
	return copia;
}

/**
 * Aceita `Botao` OU `BotaoSalvo`: a lista de propriedades tem o mesmo formato nos dois, e o painel
 * usa o mesmo editor para o botão do quadrante e para o molde da biblioteca. Um segundo criador
 * idêntico só criaria a chance de os dois divergirem.
 */
export function criarMudancaPropriedade(botao: { propriedades?: MudancaPropriedade[] }): MudancaPropriedade {
	const mudanca: MudancaPropriedade = {
		id: novoId("p"),
		nome: "",
		operacao: "definir",
		tipo: "texto",
		valor: "",
	};
	(botao.propriedades ??= []).push(mudanca);
	return mudanca;
}

export async function salvarDados(plugin: Plugin, dados: DadosDashHome): Promise<void> {
	await plugin.saveData(dados);
}

/**
 * Se um objeto de estilo define ALGUM campo de fato.
 *
 * Serve à compatibilidade da flag "personaliza ou herda": num data.json anterior a ela, ter estilo
 * gravado é a evidência de que a usuária personalizou aquele quadrante. Um objeto vazio (`{}`) não
 * conta — o painel cria `{}` só de abrir a seção, e isso não é escolha dela.
 *
 * `!== undefined` e não truthiness: `radius: 0` e `tituloColorido: false` são escolhas válidas.
 */
function temAlgumCampo(estilo: object | undefined): boolean {
	if (!estilo || typeof estilo !== "object") return false;
	return Object.values(estilo).some((v) => v !== undefined);
}

/**
 * Colunas da grade de base: 1 a 6.
 *
 * O teto é 6 (e não 4) porque a grade não é "quantos quadrantes cabem por linha" — é a unidade
 * que os quadrantes fatiam. Linhas desiguais como "2 em cima, 3 embaixo" precisam de 6, que é o
 * mínimo múltiplo comum de 2 e 3.
 */
export function limitarColunas(n: unknown): number {
	const valor = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 3;
	return Math.min(6, Math.max(1, valor));
}

/**
 * Cópia profunda o bastante: os objetos de estilo são aninhados, e um spread raso os deixaria
 * compartilhados entre o original e a cópia — mexer num mudaria o outro.
 */
function clonarDashboard(d: Dashboard): Dashboard {
	return {
		...d,
		quadrantes: d.quadrantes.map((q) => ({
			...q,
			estilo: q.estilo ? { ...q.estilo } : undefined,
			estiloBotao: q.estiloBotao ? { ...q.estiloBotao } : undefined,
			botoes: q.botoes.map((b) => ({
				...b,
				estilo: b.estilo ? { ...b.estilo } : undefined,
				campo: b.campo ? { ...b.campo } : undefined,
				criar: b.criar ? { ...b.criar } : undefined,
				propriedades: b.propriedades?.map((p) => ({ ...p })),
			})),
		})),
	};
}

/**
 * O dashboard em edição. Nunca lança e nunca devolve undefined: se o ativo foi excluído, cai no
 * primeiro da lista; se não há nenhum, devolve o vazio.
 */
export function dashboardAtivo(dados: DadosDashHome): Dashboard {
	return dados.dashboards.find((d) => d.id === dados.dashboardAtivoId) ?? dados.dashboards[0] ?? DASHBOARD_VAZIO;
}

export function novoId(prefixo: string): string {
	return `${prefixo}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function criarDashboard(dados: DadosDashHome, nome: string): Dashboard {
	const limpo = nome.trim() || "Novo dashboard";
	const dashboard: Dashboard = {
		id: novoId("d"),
		nome: limpo,
		// Nasce sem nota: o nome é da predefinição, não de um arquivo. Criar `${nome}.md` na
		// surdina geraria uma nota que ela não pediu — e o painel já oferece "Aplicar em…".
		caminhosNota: [],
		colunas: 3,
		largura: "leitura",
		quadrantes: [],
	};
	dados.dashboards.push(dashboard);
	return dashboard;
}

/**
 * O dashboard que já escreve nesta nota, se houver outro.
 *
 * Duas predefinições na mesma nota fariam uma sobrescrever a outra a cada salvamento —
 * silenciosamente, que é o pior jeito de perder trabalho. Continua valendo com a lista: o que
 * mudou é que agora a busca varre várias notas por dashboard.
 */
export function dashboardQueUsaNota(
	dados: DadosDashHome,
	caminho: string,
	excetoId: string,
): Dashboard | undefined {
	const alvo = caminho.trim().toLowerCase();
	if (!alvo) return undefined;
	return dados.dashboards.find(
		(d) => d.id !== excetoId && d.caminhosNota.some((c) => c.trim().toLowerCase() === alvo),
	);
}

/**
 * Remove o dashboard e reaponta o ativo se for preciso — o data.json nunca guarda id órfão.
 * Recusa remover o último: "nenhum dashboard" é um estado que a UI não precisa saber representar.
 * Não apaga a nota gerada: apagar arquivo da usuária sem ela pedir é destrutivo demais.
 */
export function removerDashboard(dados: DadosDashHome, id: string): boolean {
	if (dados.dashboards.length <= 1) return false;
	const i = dados.dashboards.findIndex((d) => d.id === id);
	if (i < 0) return false;
	dados.dashboards.splice(i, 1);
	if (dados.dashboardAtivoId === id) dados.dashboardAtivoId = dados.dashboards[0].id;
	return true;
}

export function criarQuadrante(dashboard: Dashboard, titulo: string): Quadrante {
	const quadrante: Quadrante = {
		id: novoId("q"),
		titulo: titulo.trim() || "Novo quadrante",
		botoes: [],
	};
	dashboard.quadrantes.push(quadrante);
	return quadrante;
}

/**
 * Cria um botão solto num quadrante.
 *
 * **Não é mais usado pelo painel** (s28): o quadrante só recebe botões da biblioteca, via
 * `usarBotaoSalvo`. Continua exportada porque o modelo aceita botão solto — é o que um botão
 * desvinculado vira, e o que a carga de um data.json antigo encontra antes de migrar.
 */
export function criarBotao(quadrante: Quadrante, texto: string): Botao {
	const botao: Botao = {
		id: novoId("b"),
		texto: texto.trim() || "Novo botão",
		tipo: "nota",
		destino: "",
	};
	quadrante.botoes.push(botao);
	return botao;
}

/**
 * Duplica um quadrante inteiro — com os botões, o estilo e a largura —, logo abaixo do original.
 *
 * Vale ainda mais que duplicar botão: um quadrante carrega a lista de botões, cada um com o seu
 * próprio estilo e as suas propriedades. Refazer isso à mão para um quadrante parecido é o trabalho
 * mais longo do painel.
 *
 * Ids novos em CADA nível (quadrante, botões, propriedades) — são chaves de acordeão no painel, e
 * repetidos fariam os dois quadrantes abrirem e fecharem juntos.
 */
export function duplicarQuadrante(dashboard: Dashboard, indice: number): Quadrante | undefined {
	const original = dashboard.quadrantes[indice];
	if (!original) return undefined;

	const copia: Quadrante = {
		...original,
		id: novoId("q"),
		titulo: `${original.titulo} (cópia)`,
		estilo: original.estilo ? { ...original.estilo } : undefined,
		estiloBotao: original.estiloBotao ? { ...original.estiloBotao } : undefined,
		separador: original.separador ? { ...original.separador } : undefined,
		botoes: original.botoes.map((b) => ({
			...b,
			id: novoId("b"),
			// Sem "(cópia)" no nome dos botões: eles vão para um quadrante novo, onde não há
			// nenhum homônimo ao lado — e é o rótulo que aparece no dashboard renderizado.
			estilo: b.estilo ? { ...b.estilo } : undefined,
			campo: b.campo ? { ...b.campo } : undefined,
				criar: b.criar ? { ...b.criar } : undefined,
			// `opcoes` é array: sem a cópia, editar a lista de uma mudaria a da outra.
			propriedades: b.propriedades?.map((p) => ({ ...p, id: novoId("p"), opcoes: p.opcoes ? [...p.opcoes] : undefined })),
		})),
	};

	dashboard.quadrantes.splice(indice + 1, 0, copia);
	return copia;
}

/**
 * Duplica um botão, inserindo a cópia logo abaixo do original.
 *
 * Existe porque montar um botão é trabalho: além do texto e do destino, ele carrega ícone, a
 * aparência própria (a terceira camada da herança) e a lista de propriedades. Uma fileira de
 * botões parecidos — o caso normal num quadrante — significava refazer tudo isso a cada um.
 *
 * A cópia é PROFUNDA e com ids NOVOS. Um spread raso deixaria estilo e propriedades compartilhados
 * entre os dois, e mexer num mudaria o outro — o mesmo cuidado de `clonarDashboard`. E o id é a
 * chave do acordeão no painel: repetido, os dois botões abririam e fechariam juntos.
 *
 * Logo ABAIXO do original, e não no fim da lista: quem duplica quer o par junto para editar a
 * diferença, e num quadrante com dez botões a cópia apareceria fora da vista.
 */
export function duplicarBotao(quadrante: Quadrante, indice: number): Botao | undefined {
	const original = quadrante.botoes[indice];
	if (!original) return undefined;

	const copia: Botao = {
		...original,
		id: novoId("b"),
		// "(cópia)" no nome porque dois botões idênticos lado a lado são indistinguíveis na lista
		// do painel — e ela ainda vai renomear este de qualquer forma.
		texto: `${original.texto} (cópia)`,
		estilo: original.estilo ? { ...original.estilo } : undefined,
		campo: original.campo ? { ...original.campo } : undefined,
		criar: original.criar ? { ...original.criar } : undefined,
		propriedades: original.propriedades?.map((p) => ({
			...p,
			id: novoId("p"),
			// `opcoes` é array: sem a cópia, editar a lista de uma mudaria a da outra.
			opcoes: p.opcoes ? [...p.opcoes] : undefined,
		})),
	};

	quadrante.botoes.splice(indice + 1, 0, copia);
	return copia;
}

/** Reordena um item dentro de uma lista (delta -1 = sobe, +1 = desce). Ignora movimentos fora da lista. */
export function mover<T>(lista: T[], indice: number, delta: number): void {
	const destino = indice + delta;
	if (destino < 0 || destino >= lista.length) return;
	const [item] = lista.splice(indice, 1);
	lista.splice(destino, 0, item);
}
