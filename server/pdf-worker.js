import { Worker } from "bullmq";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { QdrantVectorStore } from "@langchain/qdrant";
import { CharacterTextSplitter } from "@langchain/textsplitters";
import { QdrantClient } from "@qdrant/js-client-rest";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import fs from "fs/promises";
import IORedis from "ioredis";
import 'dotenv/config';

const connection = new IORedis(process.env.REDIS_URL, { tls: {} });

async function notifyServerComplete(sessionId, path, filename, status = 'ready') {
  const serverUrl = process.env.SERVER_URL || 'http://localhost:8000';
  try {
    await fetch(`${serverUrl}/pdf/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, path, filename, status })
    });
    console.log('Notified server of PDF completion for', path);
  } catch (err) {
    console.error('Failed to notify server of PDF completion:', err);
  }
}

const worker = new Worker(
  "file-upload-queue",
  async (job) => {
    try {
      const { sessionId, path, filename } = job.data;
      await fs.access(path);

      const loader = new PDFLoader(path);
      const docs = await loader.load();
      if (!docs.length) throw new Error("PDF empty");

      docs.forEach(doc => doc.metadata = { ...doc.metadata, sessionId, source: filename });
      const splitter = new CharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
      const splitDocs = await splitter.splitDocuments(docs);

      const qClient = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY });
      const collectionName = 'pdf-docs';
      try { await qClient.getCollection(collectionName); }
      catch { await qClient.createCollection(collectionName, { vectors: { size: 768, distance: 'Cosine' } }); }

      const embeddings = new HuggingFaceInferenceEmbeddings({
        apiKey: process.env.HUGGINGFACEHUB_API_TOKEN,
        model: "BAAI/bge-base-en-v1.5",
      });

      const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, { client: qClient, collectionName });
      await vectorStore.addDocuments(splitDocs);

      await notifyServerComplete(sessionId, path, filename, 'ready');
      await fs.unlink(path).catch(()=>{}); // optional cleanup
    } catch (err) {
      console.error("PDF worker failed:", err.message);
      const { sessionId, path, filename } = job.data || {};
      if (sessionId && path && filename) await notifyServerComplete(sessionId, path, filename, 'failed');
    }
  },
  { connection }
);

worker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err?.message));
worker.on('completed', job => console.log(`Job ${job.id} completed successfully`));

console.log("PDF worker started...");
