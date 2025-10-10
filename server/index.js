// index.js (server)
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
const connection = new IORedis(process.env.REDIS_URL ,{
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
const uploadedPdfFiles ={};

async function ensureCollections() {
  const config = { size: 768, distance: 'Cosine' };
  for (const col of [pdfCollectionName, audioCollectionName]) {
    try { await client.getCollection(col); console.log(`Collection '${col}' exists.`); }
    catch (err) {
      if (err.status === 404) { await client.createCollection(col, { vectors: config }); console.log(`Collection '${col}' created.`); }
      else { throw err; }
    }
  }
}
ensureCollections().catch(console.error);

const storage = multer.diskStorage({
  destination: (_, file, cb) => cb(null, 'uploads/'),
  filename: (_, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}-${file.originalname}`)
});
const upload = multer({ storage });

const app = express();
// allow x-session-id header

const corsOptions = {
  origin: [
    'https://docu-mind-scalable-rag-chatbot-with.vercel.app',
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


// PDF upload (unchanged)
app.post('/upload/pdf', upload.single('pdf'), async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  
  // Track PDF uploads by session
  if (!uploadedPdfFiles[sessionId]) {
    uploadedPdfFiles[sessionId] = [];
  }
  
  uploadedPdfFiles[sessionId].push({
    path: req.file.path,
    filename: req.file.originalname,
    status: 'processing',
    uploadedAt: Date.now()
  });

  await pdfQueue.add('file-ready', {
    filename: req.file.originalname,
    destination: req.file.destination,
    path: req.file.path,
    sessionId: sessionId  // Add session ID to the job
  });
  
  return res.json({ message: 'PDF uploaded and processing...' });
});

app.get('/pdf/status', (req, res) => {
  const sessionId = req.query.sessionId || req.headers['x-session-id'] || 'default';
  const files = uploadedPdfFiles[sessionId] || [];
  return res.json({ sessionId, files });
});

app.post('/pdf/complete', (req, res) => {
  try {
    const { sessionId = 'default', path, status = 'ready' } = req.body || {};
    
    if (!sessionId || !path) {
      return res.status(400).json({ error: 'sessionId and path required' });
    }
    
    // Initialize session array if it doesn't exist
    if (!uploadedPdfFiles[sessionId]) {
      uploadedPdfFiles[sessionId] = [];
    }
    
    const arr = uploadedPdfFiles[sessionId];
    const idx = arr.findIndex(f => f.path === path);
    
    if (idx === -1) {
      // If not found, add it
      arr.push({ 
        path, 
        filename: (req.body.filename || path.split('/').pop() || path), 
        status, 
        updatedAt: Date.now() 
      });
    } else {
      arr[idx].status = status;
      arr[idx].updatedAt = Date.now();
    }
    
    console.log(`PDF completion: Session ${sessionId}, File ${path}, Status: ${status}`);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Error in /pdf/complete:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Audio upload: register session, mark processing and push job with sessionId
app.post('/upload/audio', upload.single('audio'), async (req, res) => {
  const sessionId = req.headers['x-session-id'] || 'default';
  if (!uploadedAudioFiles[sessionId]) uploadedAudioFiles[sessionId] = [];

  uploadedAudioFiles[sessionId].push({
    path: req.file.path,
    filename: req.file.originalname,
    status: 'processing',
    uploadedAt: Date.now()
  });

  // Delay queue job slightly to ensure file is fully written
  setTimeout(async () => {
    await audioQueue.add('transcribe-ready', {
      filename: req.file.originalname,
      destination: req.file.destination,
      path: req.file.path,
      sessionId
    });
  }, 1000); // 1 second delay

  res.json({ message: 'Audio uploaded and queued for transcription...', status: 'processing' });
});

// Polling endpoint for frontend to see status
app.get('/audio/status', (req, res) => {
  const sessionId = req.query.sessionId || req.headers['x-session-id'] || 'default';
  const files = uploadedAudioFiles[sessionId] || [];
  return res.json({ sessionId, files });
});

// Endpoint worker calls after transcription is done
app.post('/audio/complete', (req, res) => {
  try {
    const { sessionId = 'default', path, transcript, status = 'ready' } = req.body || {};
    
    if (!sessionId || !path) {
      return res.status(400).json({ error: 'sessionId and path required' });
    }
    
    // Initialize session array if it doesn't exist
    if (!uploadedAudioFiles[sessionId]) {
      uploadedAudioFiles[sessionId] = [];
    }
    
    const arr = uploadedAudioFiles[sessionId];
    const idx = arr.findIndex(f => f.path === path);
    
    if (idx === -1) {
      // If not found, add it
      arr.push({ 
        path, 
        filename: (req.body.filename || path.split('/').pop() || path), 
        status, 
        transcript, 
        updatedAt: Date.now() 
      });
    } else {
      arr[idx].status = status;
      if (transcript) arr[idx].transcript = transcript;
      arr[idx].updatedAt = Date.now();
    }
    
    return res.json({ ok: true });
  } catch (error) {
    console.error('Error in /audio/complete:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Chat endpoint: only uses audio collection if there is at least one 'ready' file
app.get('/chat', async (req,res) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.query.sessionId || 'default';
    const userQuery = req.query.message || '';
    if (!userQuery) return res.status(400).json({ error: 'No query provided' });

    console.log(`Chat request - Session: ${sessionId}, Query: ${userQuery}`);

    const audioFiles = uploadedAudioFiles[sessionId] || [];
    const pdfFiles = uploadedPdfFiles[sessionId] || [];
    
    const hasReadyAudio = audioFiles.some(f => f.status === 'ready');
    const hasReadyPdf = pdfFiles.some(f => f.status === 'ready');
    const hasProcessingAudio = audioFiles.some(f => f.status === 'processing');

    console.log(`Session ${sessionId} - Ready audio: ${hasReadyAudio}, Ready PDF: ${hasReadyPdf}, Processing audio: ${hasProcessingAudio}`);

    // Priority: Audio > PDF
    let collectionName;
    let sourceType;
    
    if (hasReadyAudio) {
      collectionName = audioCollectionName;
      sourceType = 'audio';
      console.log('Using audio collection');
    } else if (hasReadyPdf) {
      collectionName = pdfCollectionName;
      sourceType = 'pdf';
      console.log('Using PDF collection');
    } else {
      return res.json({ 
        message: "I don't have any documents to search. Please upload a PDF or audio file first!", 
        docs: [] 
      });
    }
    console.log('Audio files:', audioFiles);
console.log('PDF files:', pdfFiles);
console.log(`Audio ready: ${hasReadyAudio}, PDF ready: ${hasReadyPdf}`);

    if (hasProcessingAudio && !hasReadyAudio && hasReadyPdf) {
      return res.status(202).json({ 
        message: 'Your audio is still being processed. Meanwhile, I can answer questions based on your PDF files.',
        processing: true,
        docs: []
      });
    }

    console.log(`Selected collection: ${collectionName} (${sourceType}) for session: ${sessionId}`);

    const embeddings = new HuggingFaceInferenceEmbeddings({
      apiKey: process.env.HUGGINGFACEHUB_API_TOKEN,
      model: "BAAI/bge-base-en-v1.5",
    });

    const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, { client, collectionName });
    
    let result;
    if (sourceType === 'audio') {
      // For audio, use session filtering
      console.log(`Searching audio docs for session: ${sessionId}`);
      try {
        const retriever = vectorStore.asRetriever({ 
          k: 6,
          filter: {
            must: [
              {
                key: "metadata.sessionId",
                match: { value: sessionId }
              }
            ]
          }
        });
        result = await retriever.invoke(userQuery);
      } catch (filterError) {
        console.log('Audio filter search failed, trying without filter:', filterError.message);
        const retriever = vectorStore.asRetriever({ k: 6 });
        result = await retriever.invoke(userQuery);
        result = result.filter(doc => doc.metadata.sessionId === sessionId);
      }
    } else {
      // For PDFs, search all documents in pdf-docs collection
      console.log('Searching PDF docs');
      const retriever = vectorStore.asRetriever({ k: 6 });
      result = await retriever.invoke(userQuery);
      
      // Optional: Filter PDF results by session if needed
      result = result.filter(doc => doc.metadata.sessionId === sessionId);
    }

    console.log(`Found ${result.length} relevant documents from ${sourceType}`);

    const context = result.map(doc => doc.pageContent).join("\n\n");
    console.log("Retrieved context length:", context.length);

    if (!context || context.trim().length === 0) {
      const message = sourceType === 'audio' 
        ? "I couldn't find relevant information in your audio files. Try asking about different topics from your uploaded audio." 
        : "I couldn't find relevant information in your PDF documents. Try asking about different topics from your uploaded PDFs.";
      return res.json({ message, docs: [] });
    }

    const llm = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: process.env.GOOGLE_API_KEY,
      maxTokens: 1500,
      temperature: 0.3,
    });

    const promptTemplate = sourceType === 'audio'
      ? `You are a helpful assistant that answers questions based on audio transcripts. Use the following context from the user's audio files to answer their question. Be specific and reference the content directly when possible.

Context from audio transcripts:
{context}

User Question: {question}

Provide a helpful answer based only on the audio context above:`
      : `You are a helpful assistant that answers questions based on PDF documents. Use the following context to answer the user's question.

Context from PDF:
{context}

User Question: {question}

Answer:`;

    const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);
    const chain = prompt.pipe(llm);

    const chatResult = await chain.invoke({ context, question: userQuery });
    return res.json({ 
      message: chatResult.content, 
      docs: result,
      source: sourceType
    });

  } catch (error) {
    console.error("Chat endpoint failed:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.listen(8000, ()=> console.log(`Server started on port 8000`));
