import { Worker } from "bullmq";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";  // Same import, but use Inference class
import { QdrantVectorStore } from "@langchain/qdrant";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { CharacterTextSplitter } from "@langchain/textsplitters";  // Optional
import { QdrantClient } from "@qdrant/js-client-rest";

import 'dotenv/config';  // Loads .env in ES modules

const worker = new Worker(
  "file-upload-queue",
  async (job) => {
    try {
      console.log("Job received:", job.data);
      const data = JSON.parse(job.data);
      console.log("Parsed data:", data);

      // 1️⃣ Create/ensure Qdrant collection exists (for bge-base-en-v1.5: 768 dims)
      const client = new QdrantClient({ url: process.env.QDRANT_URL });
      const collectionName = 'pdf-docs';
      const vectorSize = 768;  // Updated for this model
      const distance = 'Cosine';

      try {
        await client.getCollection(collectionName);
        console.log(`Collection '${collectionName}' already exists.`);
      } catch (err) {
        if (err.status === 404) {
          console.log(`Creating collection '${collectionName}'...`);
          await client.createCollection(collectionName, {
            vectors: { size: vectorSize, distance }
          });
          console.log(`Collection '${collectionName}' created.`);
        } else {
          throw err;
        }
      }

      // 2️⃣ Load PDF
      console.log("Loading PDF from:", data.path);
      const loader = new PDFLoader(data.path);
      const docs = await loader.load();
      console.log(`Loaded ${docs.length} document(s) from PDF.`);

      // Optional: Split docs (uncomment for large PDFs)
      // const splitter = new CharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
      // const splitDocs = await splitter.splitDocuments(docs);
      // const docsToAdd = splitDocs;
      const docsToAdd = docs;  // Use original if no split

      // 3️⃣ HF Inference Embeddings and add to vector store
      console.log("Initializing HF Inference embeddings...");
      const embeddings = new HuggingFaceInferenceEmbeddings({
        apiKey: process.env.HUGGINGFACEHUB_API_TOKEN,  // Corrected env var
        model: "BAAI/bge-base-en-v1.5",  // Strong free model (768 dims)
      });

      console.log("Initializing vector store...");
      const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
        client,  // Reuse client
        collectionName,
      });
      
      console.log("Adding documents...");
      await vectorStore.addDocuments(docsToAdd);
      console.log(`All ${docsToAdd.length} docs added to vector store!`);
    } catch (error) {
      console.error("Worker job failed:", error.message);
      console.error("Full error:", error);
      throw error;
    }
  },
  {
    concurrency: 5,  // Keep low for free tier
    connection: {
      host: "localhost",
      port: 6379,
    },
  }
);