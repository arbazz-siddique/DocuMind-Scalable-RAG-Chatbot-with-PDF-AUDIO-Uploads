import 'dotenv/config';
import express from "express";
import cors from "cors";
import multer from "multer";
import { Queue } from "bullmq";
import { QdrantClient } from "@qdrant/js-client-rest";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf"; 
import { QdrantVectorStore } from "@langchain/qdrant";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL, {
  tls: {}, // required for Upstash (TLS)
});

// ✅ BullMQ Queues
const pdfQueue = new Queue("file-upload-queue", { connection });
const audioQueue = new Queue("audio-upload-queue", { connection });

// ✅ Qdrant Client with API key support
const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const pdfCollectionName = 'pdf-docs';
const audioCollectionName = 'audio-docs';

// sessionId -> [{ path, filename, status: 'processing'|'ready'|'failed', transcript?: string }]
const uploadedAudioFiles = {};
const uploadedPdfFiles = {};

async function ensureCollections() {
  const config = { size: 768, distance: 'Cosine' };
  for (const col of [pdfCollectionName, audioCollectionName]) {
    try { 
      await client.getCollection(col); 
      console.log(`Collection '${col}' exists.`); 
    } catch (err) {
      if (err.status === 404) { 
        await client.createCollection(col, { vectors: config }); 
        console.log(`Collection '${col}' created.`); 
      } else { 
        throw err; 
      }
    }
  }
}
ensureCollections().catch(console.error);

// Use memory storage instead of disk storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    // Allow both PDF and audio files
    if (file.mimetype.startsWith('audio/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only audio and PDF files are allowed'));
    }
  }
});


const app = express();
// allow x-session-id header

const corsOptions = {
  origin: [
    'https://docu-mind-scalable-rag-chatbot-with.vercel.app',
    'docu-mind-scalable-rag-cha-git-42f7d5-arbazz-siddiques-projects.vercel.app',
    'docu-mind-scalable-rag-chatbot-with-pdf-audio-upload-f0d8cvmkh.vercel.app',
    'https://docu-mind-scalable-rag-chatbot-with-zeta.vercel.app',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); 

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

app.get('/', (_, res) => res.json({status:'running fine.'}));

// PDF upload - UPDATED to use base64
app.post('/upload/pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
    
    const sessionId = req.headers['x-session-id'] || 'default';
    
    // console.log('📤 PDF upload received:', {
    //   sessionId,
    //   originalname: req.file.originalname,
    //   size: req.file.size,
    //   mimetype: req.file.mimetype
    // });
    
    // Convert file buffer to base64
    const base64Data = req.file.buffer.toString('base64');
    
    // Track PDF uploads by session
    if (!uploadedPdfFiles[sessionId]) {
      uploadedPdfFiles[sessionId] = [];
    }
    
    // Store file info without path (since we're using base64)
    const fileInfo = {
      filename: req.file.originalname,
      status: 'processing',
      uploadedAt: Date.now()
    };
    
    uploadedPdfFiles[sessionId].push(fileInfo);

    // console.log('📝 Stored file info for session:', sessionId, fileInfo);
    // console.log('📊 Current files for session:', uploadedPdfFiles[sessionId]);

    // Send base64 data to queue instead of file path
    await pdfQueue.add('file-ready', {
      filename: req.file.originalname,
      base64Data: base64Data,
      sessionId: sessionId,
      mimetype: req.file.mimetype
    });
    
    // console.log('✅ PDF job added to queue');
    
    return res.json({ message: 'PDF uploaded and processing...' });
  } catch (err) {
    console.error('Upload PDF failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/pdf/status', (req, res) => {
  const sessionId = req.query.sessionId || req.headers['x-session-id'] || 'default';
  let files = uploadedPdfFiles[sessionId] || [];
  
  // console.log('📊 Status check for session:', sessionId);
  // console.log('📁 Current files:', files);
  
  // Ensure consistent response format
  files = files.map(file => ({
    filename: file.filename || 'unknown',
    status: file.status || 'processing',
    uploadedAt: file.uploadedAt || Date.now(),
    updatedAt: file.updatedAt || Date.now()
  }));
  
  return res.json({ 
    sessionId, 
    files 
  });
});

app.post('/pdf/complete', (req, res) => {
  try {
    const { sessionId = 'default', filename, status = 'ready' } = req.body || {};
    
    if (!sessionId || !filename) {
      return res.status(400).json({ error: 'sessionId and filename required' });
    }
    
    // Initialize session array if it doesn't exist
    if (!uploadedPdfFiles[sessionId]) {
      uploadedPdfFiles[sessionId] = [];
    }
    
    const arr = uploadedPdfFiles[sessionId];
    const idx = arr.findIndex(f => f.filename === filename);
    
    if (idx === -1) {
      // If not found, add it
      arr.push({ 
        filename, 
        status, 
        updatedAt: Date.now() 
      });
    } else {
      arr[idx].status = status;
      arr[idx].updatedAt = Date.now();
    }
    
    // console.log(`PDF completion: Session ${sessionId}, File ${filename}, Status: ${status}`);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Error in /pdf/complete:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Audio upload - ALSO NEEDS TO BE UPDATED similarly
app.post('/upload/audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio uploaded' });
    
    const sessionId = req.headers['x-session-id'] || 'default';
    
    // console.log('📤 Audio upload received:', {
    //   sessionId,
    //   originalname: req.file.originalname,
    //   size: req.file.size,
    //   mimetype: req.file.mimetype
    // });
    
    // Convert file buffer to base64
    const base64Data = req.file.buffer.toString('base64');
    
    // Track audio uploads by session
    if (!uploadedAudioFiles[sessionId]) {
      uploadedAudioFiles[sessionId] = [];
    }
    
    // Store file info without path (since we're using base64)
    const fileInfo = {
      filename: req.file.originalname,
      status: 'processing',
      uploadedAt: Date.now()
    };
    
    uploadedAudioFiles[sessionId].push(fileInfo);

    // console.log('📝 Stored audio file info for session:', sessionId, fileInfo);
    // console.log('📊 Current audio files for session:', uploadedAudioFiles[sessionId]);

    // Send base64 data to queue instead of file path
    await audioQueue.add('transcribe-ready', {
      filename: req.file.originalname,
      base64Data: base64Data,
      sessionId: sessionId,
      mimetype: req.file.mimetype
    });
    
    // console.log('✅ Audio job added to queue');
    
    return res.json({ message: 'Audio uploaded and processing...', status: 'processing' });
  } catch (err) {
    console.error('Upload audio failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Polling endpoint for frontend to see status
app.get('/audio/status', (req, res) => {
  const sessionId = req.query.sessionId || req.headers['x-session-id'] || 'default';
  let files = uploadedAudioFiles[sessionId] || [];
  
  // console.log('📊 Audio status check for session:', sessionId);
  // console.log('📁 Current audio files:', files);
  
  // Ensure consistent response format
  files = files.map(file => ({
    filename: file.filename || 'unknown',
    status: file.status || 'processing',
    uploadedAt: file.uploadedAt || Date.now(),
    updatedAt: file.updatedAt || Date.now(),
    transcript: file.transcript || null
  }));
  
  return res.json({ 
    sessionId, 
    files 
  });
});


app.post('/audio/complete', (req, res) => {
  try {
    const { sessionId = 'default', filename, transcript, status = 'ready' } = req.body || {};
    
    if (!sessionId || !filename) {
      return res.status(400).json({ error: 'sessionId and filename required' });
    }
    
    // console.log('✅ Audio completion received:', { sessionId, filename, status });
    
    // Initialize session array if it doesn't exist
    if (!uploadedAudioFiles[sessionId]) {
      uploadedAudioFiles[sessionId] = [];
    }
    
    const arr = uploadedAudioFiles[sessionId];
    const idx = arr.findIndex(f => f.filename === filename);
    
    if (idx === -1) {
      // If not found, add it
      arr.push({ 
        filename, 
        status, 
        transcript,
        updatedAt: Date.now() 
      });
      // console.log('📝 Added new audio file to tracking:', filename);
    } else {
      arr[idx].status = status;
      arr[idx].updatedAt = Date.now();
      if (transcript) arr[idx].transcript = transcript;
      // console.log('📝 Updated audio file status:', filename, '->', status);
    }
    
    // console.log(`Audio completion: Session ${sessionId}, File ${filename}, Status: ${status}`);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Error in /audio/complete:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// Chat endpoint: only uses audio collection if there is at least one 'ready' file
app.get('/debug/session-content', async (req, res) => {
  try {
    const sessionId = req.query.sessionId || req.headers['x-session-id'] || 'default';
    
    const embeddings = new HuggingFaceInferenceEmbeddings({
      apiKey: process.env.HUGGINGFACEHUB_API_TOKEN,
      model: "BAAI/bge-base-en-v1.5",
    });

    // Check PDF collection
    const pdfVectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, { 
      client, 
      collectionName: pdfCollectionName 
    });
    
    const pdfRetriever = pdfVectorStore.asRetriever({ k: 50 });
    const allPdfDocs = await pdfRetriever.invoke("");
    const sessionPdfDocs = allPdfDocs.filter(doc => doc.metadata.sessionId === sessionId);
    
    // Check Audio collection
    const audioVectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, { 
      client, 
      collectionName: audioCollectionName 
    });
    
    const audioRetriever = audioVectorStore.asRetriever({ k: 50 });
    const allAudioDocs = await audioRetriever.invoke("");
    const sessionAudioDocs = allAudioDocs.filter(doc => doc.metadata.sessionId === sessionId);

    res.json({
      sessionId,
      pdf: {
        totalDocuments: sessionPdfDocs.length,
        documents: sessionPdfDocs.map(doc => ({
          contentPreview: doc.pageContent.substring(0, 200) + '...',
          metadata: doc.metadata,
          contentLength: doc.pageContent.length
        }))
      },
      audio: {
        totalDocuments: sessionAudioDocs.length,
        documents: sessionAudioDocs.map(doc => ({
          contentPreview: doc.pageContent.substring(0, 200) + '...',
          metadata: doc.metadata,
          contentLength: doc.pageContent.length
        }))
      }
    });
  } catch (error) {
    console.error('Debug endpoint failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(8000, ()=> console.log(`Server started on port 8000`));
