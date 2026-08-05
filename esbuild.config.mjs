import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import builtins from "builtin-modules";

const banner = `/*
Dash Cards - plugin Obsidian
Gerado por esbuild, não editar main.js diretamente.
*/`;

const prod = process.argv[2] === "production";

// Esta pasta é o código-fonte de desenvolvimento. O Obsidian carrega o plugin de dentro de
// .obsidian/plugins/<id> (pasta real do vault) — são pastas separadas, não a mesma. Sem essa
// cópia, o build fica "pronto" mas o Obsidian continua rodando a versão antiga.
//
// O id vem do manifest, e não escrito à mão aqui: quando o plugin foi renomeado de dash-home para
// dash-cards, uma string fixa neste arquivo teria copiado o build para a pasta ERRADA — com o
// build passando, o que faz a falha parecer bug do plugin.
const raiz = path.dirname(fileURLToPath(import.meta.url));
const idPlugin = JSON.parse(fs.readFileSync(path.join(raiz, "manifest.json"), "utf8")).id;
const pastaVaultPlugin = path.join(raiz, "..", "..", ".obsidian", "plugins", idPlugin);

function copiarParaVault() {
	if (!fs.existsSync(pastaVaultPlugin)) fs.mkdirSync(pastaVaultPlugin, { recursive: true });
	for (const arquivo of ["main.js", "styles.css", "manifest.json"]) {
		const origem = path.join(raiz, arquivo);
		if (fs.existsSync(origem)) {
			fs.copyFileSync(origem, path.join(pastaVaultPlugin, arquivo));
		}
	}
}

const plugins = [
	{
		name: "copiar-para-vault",
		setup(build) {
			build.onEnd(() => copiarParaVault());
		},
	},
];

const context = await esbuild.context({
	banner: { js: banner },
	entryPoints: ["src/main.ts"],
	bundle: true,
	plugins,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: prod,
});

if (prod) {
	await context.rebuild();
	copiarParaVault();
	process.exit(0);
} else {
	await context.watch();
}
