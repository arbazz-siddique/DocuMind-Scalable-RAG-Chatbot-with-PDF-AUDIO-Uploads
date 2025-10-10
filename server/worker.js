// worker.js
import { Worker } from "bullmq";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { QdrantVectorStore } from "@langchain/qdrant";
import { CharacterTextSplitter } from "@langchain/textsplitters";
import { QdrantClient } from "@qdrant/js-client-rest";
import { InferenceClient } from "@huggingface/inference";
import fs from "fs/promises";
import { Blob } from "buffer";
import 'dotenv/config';

// HF client
const hf = new InferenceClient(process.env.HUGGINGFACEHUB_AUDIO_KEY);
// console.log("HF client initialized with token:", !!process.env.HUGGINGFACEHUB_AUDIO_KEY ? "YES" : "MISSING!");

// helper to notify server
async function notifyServerComplete(sessionId, path, filename, transcript, status = 'ready') {
  const serverUrl = process.env.SERVER_URL;
  try {
    await fetch(`${serverUrl}/audio/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, path, filename, transcript, status })
    });
    console.log('Notified server of completion for', path);
  } catch (err) {
    console.error('Failed to notify server of audio completion:', err);
  }
}

// Enhanced transcription function with multiple model fallbacks
async function transcribeWithRetry(audioBlob, maxRetries = 3) {
  const models = [
    "openai/whisper-large-v3",  // Primary model
    "openai/whisper-large-v2",  // Fallback 1
    "openai/whisper-base",      // Fallback 2
  ];

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const modelIndex = Math.min(attempt - 1, models.length - 1);
    const currentModel = models[modelIndex];
    
    try {
      console.log(`Transcription attempt ${attempt} with model: ${currentModel}`);
      
      const transcriptionResponse = await hf.automaticSpeechRecognition({
        model: currentModel,
        data: audioBlob,
        // REMOVED: provider: "hf-inference" - Let HF handle provider selection automatically
      });
      
      console.log("Transcription response received for model:", currentModel);
      
      if (transcriptionResponse?.text) {
        return transcriptionResponse;
      } else {
        throw new Error('Transcription returned empty text');
      }
      
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt} with model ${currentModel} failed:`, error.message);
      
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
        console.log(`Retrying in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('All transcription attempts failed');
}

const worker = new Worker(
  "audio-upload-queue",
  async (job) => {
    try {
      console.log("Audio job received:", job.data);
      const data = typeof job.data === "string" ? JSON.parse(job.data) : job.data;
      console.log("Parsed data:", data);
      const { sessionId, path, filename } = data;

      // Validate file exists
      try {
        await fs.access(path);
      } catch (err) {
        throw new Error(`Audio file not found: ${path}`);
      }

      console.log("Transcribing:", path);
      const audioBuffer = await fs.readFile(path);
      console.log("Audio buffer loaded (size:", audioBuffer.length, "bytes)");

      // Check file size (Hugging Face has limits)
      const fileSizeMB = audioBuffer.length / (1024 * 1024);
if (fileSizeMB > 50) {
  const errorMsg = `File too large (${fileSizeMB.toFixed(2)}MB). Maximum size is 50MB. Please use a smaller file.`;
  await notifyServerComplete(sessionId, path, filename, null, 'failed');
  throw new Error(errorMsg);
}

      const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });

      // Use enhanced transcription with retry logic
      const transcriptionResponse = await transcribeWithRetry(audioBlob, 3);

      if (!transcriptionResponse || !transcriptionResponse.text) {
        await notifyServerComplete(sessionId, path, filename, null, 'failed');
        throw new Error(`Transcription failed: ${JSON.stringify(transcriptionResponse)}`);
      }

      const transcript = transcriptionResponse.text;
      console.log("Transcription complete (length:", transcript.length, "characters)");

      // Validate transcript isn't empty
      if (transcript.trim().length === 0) {
        throw new Error('Transcription returned empty content');
      }

      // split and add to Qdrant
      const docs = [{ 
        pageContent: transcript, 
        metadata: { 
          source: filename, 
          type: 'audio-transcript',
          sessionId: sessionId,
          processedAt: new Date().toISOString()
        } 
      }];
      
      const splitter = new CharacterTextSplitter({ 
        chunkSize: 1000, 
        chunkOverlap: 200 
      });
      
      const splitDocs = await splitter.splitDocuments(docs);
      console.log(`Split into ${splitDocs.length} chunks.`);

console.log('Document metadata:', splitDocs.map(doc => ({
  contentLength: doc.pageContent.length,
  metadata: doc.metadata
})));
      // Initialize Qdrant
      const qClient = new QdrantClient({ 
        url: process.env.QDRANT_URL ,
        apiKey: process.env.QDRANT_API_KEY, 
      });
      
      const collectionName = 'audio-docs';
      try {
        await qClient.getCollection(collectionName);
        console.log('Qdrant collection exists');
      } catch (err) {
        if (err.status === 404) {
          await qClient.createCollection(collectionName, { 
            vectors: { size: 768, distance: 'Cosine' } 
          });
          console.log('Created Qdrant collection');
        } else {
          throw err;
        }
      }

      const embeddings = new HuggingFaceInferenceEmbeddings({
        apiKey: process.env.HUGGINGFACEHUB_AUDIO_KEY,
        model: "BAAI/bge-base-en-v1.5",
      });

      const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
        client: qClient,
        collectionName,
      });

      await vectorStore.addDocuments(splitDocs);
      console.log(`All ${splitDocs.length} chunks added to Qdrant!`);

      // notify server that processing is done and attach transcript
      await notifyServerComplete(sessionId, path, filename, transcript, 'ready');

      // delete audio file
      try {
        await fs.unlink(path);
        console.log('Deleted processed audio file:', path);
      } catch (unlinkErr) {
        console.warn('Could not delete audio file:', unlinkErr.message);
      }

    } catch (error) {
      console.error("Audio worker failed:", error.message);
      
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
        await notifyServerComplete(sessionId, path, filename, null, 'failed');
      }
      
      throw error; // let BullMQ handle retries
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
  console.error(`Job ${job?.id} failed:`, err.message);
});

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

worker.on('error', (err) => {
  console.error('Worker error:', err);
});

console.log("Audio worker started...");