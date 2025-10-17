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
    'http://localhost:3000',
    'https://localhost:3000'
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

 // Chat endpoint: search both collections and combine results
app.get('/chat', async (req,res) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.query.sessionId || 'default';
    const userQuery = req.query.message || '';
    
    if (!userQuery) return res.status(400).json({ error: 'No query provided' });

    console.log(`🔍 Chat request - Session: ${sessionId}, Query: "${userQuery}"`);

    const audioFiles = uploadedAudioFiles[sessionId] || [];
    const pdfFiles = uploadedPdfFiles[sessionId] || [];
    
    const hasReadyAudio = audioFiles.some(f => f.status === 'ready');
    const hasReadyPdf = pdfFiles.some(f => f.status === 'ready');

    console.log(`📊 Session ${sessionId} - Ready audio: ${hasReadyAudio}, Ready PDF: ${hasReadyPdf}`);

    // If no documents, return early
    if (!hasReadyAudio && !hasReadyPdf) {
      return res.json({ 
        message: "I don't have any documents to search. Please upload a PDF or audio file first!", 
        docs: [] 
      });
    }

    const embeddings = new HuggingFaceInferenceEmbeddings({
      apiKey: process.env.HUGGINGFACEHUB_API_TOKEN,
      model: "BAAI/bge-base-en-v1.5",
    });

    // SIMPLIFIED search function without problematic filters
    async function searchCollection(collectionName, sessionId, query, k = 6) {
      try {
        const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, { 
          client, 
          collectionName 
        });
        
        // Use simple retriever without filters to avoid Bad Request errors
        const retriever = vectorStore.asRetriever({ k: k * 2 }); // Get more results to filter client-side
        
        let result = await retriever.invoke(query);
        
        // Filter by sessionId client-side (more reliable)
        result = result.filter(doc => {
          // Handle different metadata structures
          const meta = doc.metadata || {};
          return meta.sessionId === sessionId;
        }).slice(0, k); // Take only the top k after filtering
        
        // Add source information to each document
        result.forEach(doc => {
          doc.metadata = doc.metadata || {};
          doc.metadata.source = collectionName === pdfCollectionName ? 'pdf' : 'audio';
        });
        
        console.log(`✅ ${collectionName}: Found ${result.length} documents after session filtering`);
        return result;
      } catch (error) {
        console.error(`❌ Error searching collection ${collectionName}:`, error.message);
        return [];
      }
    }

    // Search both collections in parallel
    const [pdfResults, audioResults] = await Promise.all([
      hasReadyPdf ? searchCollection(pdfCollectionName, sessionId, userQuery, 5) : [],
      hasReadyAudio ? searchCollection(audioCollectionName, sessionId, userQuery, 3) : []
    ]);

    console.log(`📚 Final results - PDF: ${pdfResults.length}, Audio: ${audioResults.length}`);

    // DEBUG: Log what we found
    if (pdfResults.length > 0) {
      console.log('📄 PDF content samples:');
      pdfResults.forEach((doc, i) => {
        console.log(`  ${i+1}. ${doc.pageContent.substring(0, 100)}...`);
      });
    }
    if (audioResults.length > 0) {
      console.log('🎵 Audio content samples:');
      audioResults.forEach((doc, i) => {
        console.log(`  ${i+1}. ${doc.pageContent.substring(0, 100)}...`);
      });
    }

    // IMPROVED CONTEXT HANDLING
    let context = "";
    
    if (pdfResults.length > 0 || audioResults.length > 0) {
      const pdfParts = pdfResults.map(doc => `[FROM PDF DOCUMENT] ${doc.pageContent}`);
      const audioParts = audioResults.map(doc => `[FROM AUDIO TRANSCRIPT] ${doc.pageContent}`);
      
      const allParts = [...pdfParts, ...audioParts];
      context = allParts.join("\n\n---\n\n");
    }

    console.log(`📝 Final context length: ${context.length} chars`);

    // If no documents found after all attempts
    if (!context.trim()) {
      console.log('❌ No relevant content found for this query');
      return res.json({ 
        message: "I couldn't find specific information about this topic in your uploaded documents. Try asking about different content or check if your files have been processed successfully.", 
        docs: [],
        source: 'none',
        pdfCount: 0,
        audioCount: 0
      });
    }

    // IMPROVED PROMPT TEMPLATE
    const llm = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: process.env.GOOGLE_API_KEY,
      maxTokens: 2000,
      temperature: 0.1,
    });

    const promptTemplate = `You are an expert document analysis assistant. Your role is to provide accurate, helpful answers based EXCLUSIVELY on the context provided from the user's uploaded files.

CONTEXT FROM UPLOADED FILES:
{context}

USER QUESTION: {question}

CRITICAL RESPONSE GUIDELINES:

1. **SOURCE FIDELITY**
   - Answer using ONLY the information in the provided context
   - NEVER invent, assume, or add information not present in the context
   - If crucial information is missing, acknowledge this limitation

2. **SOURCE ATTRIBUTION**
   - Clearly indicate when information comes from PDF documents
   - Clearly indicate when information comes from audio transcripts  
   - If both sources contain relevant information, synthesize it clearly
   - Use phrases like "Based on the PDF..." or "According to the audio transcript..."

3. **HANDLING UNCERTAINTY**
   - If the context doesn't contain relevant information, state: "The uploaded documents don't contain specific information about [topic]"
   - If you find partial information, say what you CAN answer from the available context
   - Never say "I don't know" - instead say "The documents don't cover this specific topic"

4. **RESPONSE QUALITY**
   - Provide comprehensive but concise answers
   - Structure complex information with bullet points when helpful
   - Focus on being helpful and accurate, not verbose
   - Prioritize clarity and usefulness

5. **SPECIAL CASES**
   - For "overview" requests: Provide a structured summary of key points
   - For "important points" requests: Extract and list the main takeaways
   - For comparison questions: Highlight similarities/differences between sources

Now, analyze the context carefully and provide the best possible answer to the user's question:`;


    const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);
    const chain = prompt.pipe(llm);

    console.log('🤖 Generating response with LLM...');
    const chatResult = await chain.invoke({ 
      context: context,
      question: userQuery 
    });
    
    // Determine source type for response
    let sourceType = 'none';
    if (pdfResults.length > 0 && audioResults.length > 0) {
      sourceType = 'both';
    } else if (pdfResults.length > 0) {
      sourceType = 'pdf';
    } else if (audioResults.length > 0) {
      sourceType = 'audio';
    }
    
    return res.json({ 
      message: chatResult.content, 
      docs: [...pdfResults, ...audioResults],
      source: sourceType,
      pdfCount: pdfResults.length,
      audioCount: audioResults.length,
      contextLength: context.length
    });

  } catch (error) {
    console.error("💥 Chat endpoint failed:", error.message);
    return res.status(500).json({ error: error.message });
  }
});


app.listen(8000, ()=> console.log(`Server started on port 8000`));
