// pdf-worker.js
import { Worker } from "bullmq";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { QdrantVectorStore } from "@langchain/qdrant";
import { CharacterTextSplitter } from "@langchain/textsplitters";
import { QdrantClient } from "@qdrant/js-client-rest";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { writeFile, unlink } from "fs/promises";
import 'dotenv/config';

// Helper to notify server
async function notifyServerComplete(sessionId, filename, status = 'ready') {
  const serverUrl = process.env.SERVER_URL;
  try {
    await fetch(`${serverUrl}/pdf/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, filename, status })
    });
    console.log('Notified server of PDF completion for', filename);
  } catch (err) {
    console.error('Failed to notify server of PDF completion:', err);
  }
}

const worker = new Worker(
  "file-upload-queue",
  async (job) => {
    let tempPath = null;
    try {
      // console.log("PDF job received:", job.data);
      const data = typeof job.data === "string" ? JSON.parse(job.data) : job.data;
      // console.log("Parsed PDF data:", data);
      const { sessionId, filename, base64Data } = data;

      if (!base64Data) {
        throw new Error('No PDF data received');
      }

      // Convert base64 to buffer and save temporarily
      const fileBuffer = Buffer.from(base64Data, 'base64');
      tempPath = `/tmp/${Date.now()}-${filename}`;
      await writeFile(tempPath, fileBuffer);
      console.log("Saved PDF to temporary file:", tempPath);

      // 1️⃣ Load PDF document
      const loader = new PDFLoader(tempPath);
      const docs = await loader.load();
      // console.log(`Loaded ${docs.length} pages from PDF`);

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
        chunkSize: 800, 
        chunkOverlap: 150 ,
        separator: "\n", 
      });
      
      const splitDocs = await splitter.splitDocuments(docs);
      // console.log(`Split PDF into ${splitDocs.length} chunks.`);

      // console.log('PDF document metadata:', splitDocs.map(doc => ({
      //   contentLength: doc.pageContent.length,
      //   metadata: doc.metadata
      // })));
      splitDocs.forEach((doc, index) => {
  doc.metadata = {
    ...doc.metadata,
    source: filename,
    type: 'pdf',
    sessionId: sessionId,
    processedAt: new Date().toISOString(),
    chunkIndex: index,
    totalChunks: splitDocs.length,
    // Add content type hints
    contentType: doc.pageContent.includes('Experience') ? 'experience' :
                doc.pageContent.includes('Education') ? 'education' :
                doc.pageContent.includes('Skill') ? 'skills' : 'general'
  };
});


      // 4️⃣ Initialize Qdrant
      const qClient = new QdrantClient({ 
        url: process.env.QDRANT_URL,
        apiKey: process.env.QDRANT_API_KEY
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
      // console.log(`All ${splitDocs.length} PDF chunks added to Qdrant!`);

      // 6️⃣ Notify server that processing is done
      await notifyServerComplete(sessionId, filename, 'ready');

    } catch (error) {
      console.error("PDF worker failed:", error.message);
      
      // Notify server of failure
      if (job.data) {
        const data = typeof job.data === "string" ? JSON.parse(job.data) : job.data;
        const sessionId = data.sessionId;
        const filename = data.filename;
        
        if (sessionId && filename) {
          await notifyServerComplete(sessionId, filename, 'failed');
        }
      }
      
      throw error; // let BullMQ handle retries
    } finally {
      // Clean up temporary file
      if (tempPath) {
        try {
          await unlink(tempPath);
          console.log('Cleaned up temporary PDF file:', tempPath);
        } catch (unlinkErr) {
          console.warn('Could not delete temporary PDF file:', unlinkErr.message);
        }
      }
    }
  },
  {
    concurrency: 1,
    connection: { 
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      username: process.env.REDIS_USERNAME,
      password: process.env.REDIS_PASSWORD,
      tls: {} // Upstash requires TLS
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