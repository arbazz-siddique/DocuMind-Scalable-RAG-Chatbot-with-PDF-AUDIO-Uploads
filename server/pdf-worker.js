// pdf-worker.js
import { Worker } from "bullmq";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { QdrantVectorStore } from "@langchain/qdrant";
import { CharacterTextSplitter } from "@langchain/textsplitters";
import { QdrantClient } from "@qdrant/js-client-rest";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import fs from "fs/promises";
import 'dotenv/config';

// Helper to notify server
async function notifyServerComplete(sessionId, path, filename, status = 'ready') {
  const serverUrl = process.env.SERVER_URL ;
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
      console.log("PDF job received:", job.data);
      const data = typeof job.data === "string" ? JSON.parse(job.data) : job.data;
      console.log("Parsed PDF data:", data);
      const { sessionId, path, filename } = data;

      // Validate file exists
      try {
        await fs.access(path);
      } catch (err) {
        throw new Error(`PDF file not found: ${path}`);
      }

      console.log("Processing PDF:", path);

      // 1️⃣ Load PDF document
      const loader = new PDFLoader(path);
      const docs = await loader.load();
      console.log(`Loaded ${docs.length} pages from PDF`);

      if (docs.length === 0) {
        throw new Error('PDF is empty or could not be read');
      }

      // 2️⃣ Add session ID to metadata for each document
      docs.forEach(doc => {
        doc.metadata = {
          ...doc.metadata,
          source: filename,
          type: 'pdf',
          sessionId: sessionId,
          processedAt: new Date().toISOString()
        };
      });

      // 3️⃣ Split documents into chunks
      const splitter = new CharacterTextSplitter({ 
        chunkSize: 1000, 
        chunkOverlap: 200 
      });
      
      const splitDocs = await splitter.splitDocuments(docs);
      console.log(`Split PDF into ${splitDocs.length} chunks.`);

      console.log('PDF document metadata:', splitDocs.map(doc => ({
        contentLength: doc.pageContent.length,
        metadata: doc.metadata
      })));

      // 4️⃣ Initialize Qdrant
      const qClient = new QdrantClient({ 
        url: process.env.QDRANT_URL 
      });
      
      const collectionName = 'pdf-docs';
      try {
        await qClient.getCollection(collectionName);
        console.log('PDF Qdrant collection exists');
      } catch (err) {
        if (err.status === 404) {
          await qClient.createCollection(collectionName, { 
            vectors: { size: 768, distance: 'Cosine' } 
          });
          console.log('Created PDF Qdrant collection');
        } else {
          throw err;
        }
      }

      // 5️⃣ Add documents to Qdrant
      const embeddings = new HuggingFaceInferenceEmbeddings({
        apiKey: process.env.HUGGINGFACEHUB_AUDIO_KEY,
        model: "BAAI/bge-base-en-v1.5",
      });

      const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
        client: qClient,
        collectionName,
      });

      await vectorStore.addDocuments(splitDocs);
      console.log(`All ${splitDocs.length} PDF chunks added to Qdrant!`);

      // 6️⃣ Notify server that processing is done
      await notifyServerComplete(sessionId, path, filename, 'ready');

      // Delete PDF file after successful processing (optional)
      try {
        await fs.unlink(path);
        console.log('Deleted processed PDF file:', path);
      } catch (unlinkErr) {
        console.warn('Could not delete PDF file:', unlinkErr.message);
      }

    } catch (error) {
      console.error("PDF worker failed:", error.message);
      
      // Extract session info for error notification
      let sessionId, path, filename;
      try {
        const data = typeof job.data === "string" ? JSON.parse(job.data) : job.data;
        sessionId = data.sessionId;
        path = data.path;
        filename = data.filename;
      } catch (parseErr) {
        console.error('Could not parse job data for error notification');
      }
      
      if (sessionId && path && filename) {
        await notifyServerComplete(sessionId, path, filename, 'failed');
      }
      
      throw error; // let BullMQ handle retries
    }
  },
  {
    concurrency: 1,
    connection: { 
      host: process.env.REDIS_HOST ,
      port: process.env.REDIS_PORT 
    }
  }
);

// Add event listeners for better monitoring
worker.on('failed', (job, err) => {
  console.error(`PDF Job ${job?.id} failed:`, err.message);
});

worker.on('completed', (job) => {
  console.log(`PDF Job ${job.id} completed successfully`);
});

worker.on('error', (err) => {
  console.error('PDF Worker error:', err);
});

console.log("PDF worker started...");