import 'dotenv/config';  // Load .env first

import express from "express";
import cors from "cors";
import multer from "multer";
import { Queue } from "bullmq";
import { QdrantClient } from "@qdrant/js-client-rest";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf"; 
import { QdrantVectorStore } from "@langchain/qdrant";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";  // Correct: Chat model for Gemini
import { ChatPromptTemplate } from "@langchain/core/prompts";  // For chat prompt (LCEL)

const queue = new Queue("file-upload-queue", 
   {
     connection:{
        host:'localhost',
        port:'6379'
    }
   }
);

const client = new QdrantClient({ url: process.env.QDRANT_URL });
const collectionName = 'pdf-docs';

// Ensure collection exists on startup
async function ensureCollection() {
  const vectorSize = 768;  // For BAAI/bge-base-en-v1.5
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
}
ensureCollection().catch(console.error);

const storage = multer.diskStorage({
    destination: function(req,file, cb){
        cb(null, 'uploads/')
    },
    filename: function(req, file, cb){
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
        cb(null, `${uniqueSuffix} - ${file.originalname}`)
    }
});

const upload = multer({storage: storage});
const app = express();
app.use(cors());

app.get('/', (req,res)=>{
    res.json({status:'running fine.'});
});

app.post('/upload/pdf', upload.single('pdf'), async (req, res)=>{
    await queue.add('file-ready', JSON.stringify({
        filename: req.file.originalname,
        destination: req.file.destination,
        path: req.file.path
    }));
    return res.json({message:'uploaded'});
});

app.get('/chat', async (req,res)=>{
    try {
        const userQuery = req.query.message
        console.log("Chat query:", userQuery);
        
        const embeddings = new HuggingFaceInferenceEmbeddings({
            apiKey: process.env.HUGGINGFACEHUB_API_TOKEN,
            model: "BAAI/bge-base-en-v1.5",  // Free embeddings (works)
        });
        
        const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
            client,
            collectionName,
        });
        
        const retriever = vectorStore.asRetriever({
            k: 6,  // Top 4 relevant docs for better context
        });
        
        // Retrieve relevant docs
        const result = await retriever.invoke(userQuery);
        const context = result.map((doc) => doc.pageContent).join("\n\n");
        console.log("Retrieved context length:", context.length);
        
        if (context.length === 0) {
            return res.json({ message: "I don't have info on that yet—upload a relevant PDF!", docs: [] });
        }
        
        // Free Gemini LLM (replaces OpenAI/HF generation)
        const llm = new ChatGoogleGenerativeAI({
            model: "gemini-2.0-flash",  // Free tier model (fast, high-quality)
            apiKey: process.env.GOOGLE_API_KEY,
            maxTokens: 500,  // Allow longer responses (free tier supports)
            temperature: 0.3,  // Lower for more focused, detailed output
        });
        
        // Q&A Prompt Template (tuned for Gemini: concise, relevant)
        const promptTemplate = `You are a helpful assistant answering questions about PDFs. Use only the following context to answer. accurate, and focus on the most relevant details. If the context is irrelevant, say "I don't have info on that yet—upload a relevant PDF!".

        Context: {context}

        Question: {question}

        Answer:`;
        
        const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);
        
        // LCEL Chain: Prompt + LLM (modern, no deprecation)
        const chain = prompt.pipe(llm);
        
        const chatResult = await chain.invoke({ 
            context, 
            question: userQuery 
        });
        
        const message = chatResult.content;  // Gemini chat output is AIMessage with .content
        
        return res.json({ message, docs: result });  // Return answer + docs
    } catch (error) {
        console.error("Chat endpoint failed:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

app.listen(8000, ()=> console.log(`server started  on port: ${8000}`));