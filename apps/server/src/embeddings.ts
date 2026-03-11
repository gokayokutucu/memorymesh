import { Ollama } from "ollama";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "localhost";
const OLLAMA_PORT = process.env.OLLAMA_PORT ?? "11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";

const client = new Ollama({ host: `http://${OLLAMA_HOST}:${OLLAMA_PORT}` });

export async function embed(text: string): Promise<number[]> {
  const response = await client.embeddings({
    model: EMBEDDING_MODEL,
    prompt: text,
  });
  return response.embedding;
}
