// Função do servidor (Vercel): lê e grava as avaliações no arquivo
// dados/avaliacoes.json do próprio repositório do GitHub.
//
// Variáveis de ambiente (configuradas no painel da Vercel):
//   GITHUB_TOKEN  token com permissão de escrita em "Contents" deste repositório
//   GITHUB_REPO   no formato "usuario/repositorio"
//   GITHUB_BRANCH (opcional) branch onde o arquivo fica; padrão "main"

const API = process.env.GITHUB_API || "https://api.github.com";
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const BRANCH = process.env.GITHUB_BRANCH || "main";
const ARQUIVO = "dados/avaliacoes.json";
const MAXIMO = 500; // guarda só as 500 mais recentes

function github(query, opcoes = {}) {
  return fetch(`${API}/repos/${REPO}/contents/${ARQUIVO}${query}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bom-prato-site",
      ...(opcoes.headers || {})
    }
  });
}

async function lerArquivo() {
  const r = await github(`?ref=${encodeURIComponent(BRANCH)}`);
  if (r.status === 404) return { lista: [], sha: null };
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status} ao ler`);
  const j = await r.json();
  const texto = Buffer.from(j.content, "base64").toString("utf8");
  const lista = JSON.parse(texto || "[]");
  return { lista: Array.isArray(lista) ? lista : [], sha: j.sha };
}

async function gravarArquivo(lista, sha) {
  const corpo = {
    message: "Nova avaliação de cliente",
    content: Buffer.from(JSON.stringify(lista, null, 2), "utf8").toString("base64"),
    branch: BRANCH
  };
  if (sha) corpo.sha = sha;
  return github("", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo)
  });
}

function validar(b) {
  if (!b || typeof b !== "object") return null;
  const nome = typeof b.nome === "string" ? b.nome.trim() : "";
  const comentario = typeof b.comentario === "string" ? b.comentario.trim() : "";
  const nota = Number(b.nota);
  if (!nome || nome.length > 40) return null;
  if (!comentario || comentario.length > 300) return null;
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) return null;
  return { nome, nota, comentario, data: new Date().toISOString() };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!TOKEN || !REPO) {
    return res.status(500).json({ erro: "Servidor sem GITHUB_TOKEN ou GITHUB_REPO configurados." });
  }
  try {
    if (req.method === "GET") {
      const { lista } = await lerArquivo();
      return res.status(200).json(lista);
    }
    if (req.method === "POST") {
      let corpo = req.body;
      if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch { corpo = null; } }
      const nova = validar(corpo);
      if (!nova) return res.status(400).json({ erro: "Dados inválidos." });

      // Tenta algumas vezes: se duas pessoas avaliarem ao mesmo tempo, o GitHub recusa uma delas
      for (let tentativa = 0; tentativa < 4; tentativa++) {
        const { lista, sha } = await lerArquivo();
        lista.unshift(nova);
        const r = await gravarArquivo(lista.slice(0, MAXIMO), sha);
        if (r.ok) return res.status(201).json(nova);
        if (r.status !== 409 && r.status !== 422) throw new Error(`GitHub respondeu ${r.status} ao gravar`);
      }
      return res.status(503).json({ erro: "Muitas avaliações ao mesmo tempo. Tente de novo." });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ erro: "Método não permitido." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Erro no servidor." });
  }
};