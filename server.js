import express from "express";
import cors from "cors";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { OpenAI } from "openai";
import multer from "multer";
import dotenv from "dotenv";
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// Initialize Pinecone and Embeddings
const pineconeClient = new PineconeClient();

const pineconeIndex = pineconeClient.Index(process.env.PINECONE_INDEX);
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "text-embedding-ada-002",
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Tavily Web Search helper
const searchWeb = async (query) => {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        include_answer: false,
        max_results: 5,
      }),
    });

    if (!response.ok) {
      console.error("Tavily search failed:", response.statusText);
      return null;
    }

    const data = await response.json();
    if (!data.results || data.results.length === 0) return null;

    return data.results.map((r) => ({
      pageContent: r.content || r.snippet || "",
      metadata: {
        source: "web",
        title: r.title || "Web result",
        url: r.url || "",
        chunkIndex: -1,
      },
    }));
  } catch (error) {
    console.error("Error during web search:", error);
    return null;
  }
};

let vectorStore;
const DOCUMENTS_FILE = path.join(__dirname, 'documents.json');
const CONVERSATIONS_FILE = path.join(__dirname, 'conversations.json');

const loadDocuments = () => {
  try {
    if (fs.existsSync(DOCUMENTS_FILE)) {
      const data = fs.readFileSync(DOCUMENTS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading documents file:", error);
  }
  return [];
};

const saveDocuments = (docs) => {
  try {
    fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(docs, null, 2));
  } catch (error) {
    console.error("Error saving documents file:", error);
  }
};

const loadConversations = () => {
  try {
    if (fs.existsSync(CONVERSATIONS_FILE)) {
      const data = fs.readFileSync(CONVERSATIONS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading conversations file:", error);
  }
  return [];
};

const saveConversations = (conversations) => {
  try {
    fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(conversations, null, 2));
  } catch (error) {
    console.error("Error saving conversations file:", error);
  }
};

const documentsStore = loadDocuments();

const initVectorStore = async () => {
  try {
    vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      maxConcurrency: 5,
    });
    console.log("Vector store initialized successfully!");
  } catch (error) {
    console.error("Error initializing vector store:", error);
  }
};

initVectorStore();

// Function to Extract Text from File (Now in Backend)
const extractTextFromFile = async (file) => {
  try {
    const ext = path.extname(file.originalname).toLowerCase();

    // Handle by extension or mimetype
    if (ext === '.txt' || ext === '.md' || file.mimetype === 'text/plain' || file.mimetype === 'text/markdown') {
      return fs.readFileSync(file.path, 'utf-8');
    } else if (ext === '.pdf' || file.mimetype === 'application/pdf') {
      const buffer = fs.readFileSync(file.path);
      const data = await pdfParse(buffer);
      return data.text;
    } else if (ext === '.docx' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ path: file.path });
      return result.value;
    } else {
      throw new Error(`Unsupported file type: ${ext || file.mimetype}. Supported types: .txt, .md, .pdf, .docx`);
    }
  } catch (error) {
    console.error("Error extracting text:", error);
    throw error;
  }
};

// Pinecone Connection Endpoint (No changes needed)
app.get("/pinecone", async (req, res) => {
  try {
    res.json({ message: "Connected to Pinecone", index: pineconeIndex.name });
  } catch (error) {
    console.error("Pinecone connection failed:", error);
    res.status(500).json({ error: "Failed to connect to Pinecone" });
  }
});

// Upload Endpoint (Handles File Upload, Extraction, Chunking, and Vector Store Addition)
app.post("/upload", upload.single('document'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const file = req.file;
    const extractedText = await extractTextFromFile(file);

    if (!extractedText) {
      return res.status(400).json({ error: "Could not extract text from the file." });
    }

    const documentId = crypto.randomUUID();

    // Split text into chunks for better retrieval accuracy
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const chunks = await textSplitter.createDocuments([extractedText]);

    // Attach metadata to each chunk with index
    const documents = chunks.map((chunk, index) => ({
      pageContent: chunk.pageContent,
      metadata: { filename: file.originalname, documentId, chunkIndex: index },
    }));

    await vectorStore.addDocuments(documents);
    console.log(`[Upload] Stored ${documents.length} chunks for documentId=${documentId}, filename=${file.originalname}`);

    documentsStore.push({ id: documentId, name: file.originalname });
    saveDocuments(documentsStore);

    // Clean up the uploaded file after processing
    fs.unlink(file.path, (err) => {
      if (err) {
        console.error("Error deleting file:", err);
      } else {
        console.log("File deleted successfully");
      }
    });

    res.json({ message: "Document processed and added to vector store successfully", documentId });
  } catch (error) {
    console.error("Error processing document:", error);
    res.status(500).json({ error: "Failed to process document", details: error.message });
  }
});

// Documents Endpoint (Lists uploaded documents)
app.get("/documents", async (req, res) => {
  try {
    res.json({ documents: documentsStore });
  } catch (error) {
    console.error("Error fetching documents:", error);
    res.status(500).json({ error: "Failed to fetch documents", details: error.message });
  }
});

// Query Endpoint (Performs Similarity Search)
app.post("/query", async (req, res) => {
  const { query, documentId } = req.body;

  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }

  try {
    // Search only within vectors belonging to the selected document
    const filter = documentId ? { documentId: { $eq: documentId } } : undefined;
    console.log(`[Query] documentId=${documentId}, filter=${JSON.stringify(filter)}, query="${query}"`);
    let results = await vectorStore.similaritySearch(query, 5, filter);
    console.log(`[Query] Filtered results count: ${results.length}`);

    // Fallback: if filtered search returns nothing, try unfiltered
    if (results.length === 0 && documentId) {
      const unfilteredResults = await vectorStore.similaritySearch(query, 5);
      console.log(`[Query] Unfiltered results count: ${unfilteredResults.length}`);
      if (unfilteredResults.length > 0) {
        console.log(`[Query] First unfiltered result metadata:`, unfilteredResults[0].metadata);
      }
    }

    res.json({ results });
  } catch (error) {
    console.error("Error during similarity search:", error);
    res.status(500).json({ error: "Failed to perform similarity search", details: error.message });
  }
});

// Chat Endpoint (SSE Streaming with Sources)
app.post("/chat", async (req, res) => {
  const { query, documentId, documentName, sessionId, conversationId: existingConversationId } = req.body;

  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }

  try {
    // 1. Search for relevant chunks in the document
    const filter = documentId ? { documentId: { $eq: documentId } } : undefined;
    const searchResultsWithScore = await vectorStore.similaritySearchWithScore(query, 5, filter);

    // Only keep chunks with a relevance score above threshold
    const SCORE_THRESHOLD = 0.8;
    let sources = searchResultsWithScore
      .filter(([_, score]) => score >= SCORE_THRESHOLD)
      .map(([doc]) => ({
        pageContent: doc.pageContent,
        metadata: doc.metadata,
      }));

    console.log(`[Chat] Found ${searchResultsWithScore.length} chunks, ${sources.length} above score ${SCORE_THRESHOLD} for query: "${query}"`);
    if (searchResultsWithScore.length > 0) {
      console.log(`[Chat] Top scores: ${searchResultsWithScore.map(([_, s]) => s.toFixed(3)).join(', ')}`);
    }

    let contextOrigin = "document";

    // 2. Fallback to web search if document has no relevant chunks
    if (sources.length === 0 && process.env.TAVILY_API_KEY) {
      console.log(`[Chat] No document chunks found. Falling back to web search for: "${query}"`);
      const webResults = await searchWeb(query);
      if (webResults && webResults.length > 0) {
        sources = webResults;
        contextOrigin = "web";
      }
    }

    const relevantChunks = sources.map((s) => s.pageContent).join("\n\n");

    // 3. Build system prompt
    let systemPromptContent;
    if (contextOrigin === "web") {
      systemPromptContent = `You are an AI assistant answering questions. The uploaded document did not contain relevant information, so web search results are provided below. Use these web results to answer the question. Cite sources naturally (e.g., "According to..."). If the web results still don't answer the question, say so.

Web search results:\n${relevantChunks}`;
    } else {
      systemPromptContent = `You are an AI assistant answering questions about the uploaded document: "${documentName || 'Document'}".
Use only the context provided below to answer. You may summarize, paraphrase, or infer straightforward relationships from the text, but do NOT introduce facts, names, or details that are not present in the context. If the context truly does not contain enough information to answer the question, reply with: "I could not find relevant information in the document."

Context:\n${relevantChunks}`;
    }

    const systemPrompt = {
      role: "system",
      content: systemPromptContent,
    };

    const messagesForOpenAI = [systemPrompt, { role: "user", content: query }];

    // 3. Setup SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    // 4. Stream LLM response
    const stream = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messagesForOpenAI,
      stream: true,
    });

    let fullContent = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";
      if (delta) {
        fullContent += delta;
        res.write(`data: ${JSON.stringify({ type: "token", content: delta })}\n\n`);
      }
    }

    // 5. Send sources as final event
    res.write(`data: ${JSON.stringify({ type: "sources", sources })}\n\n`);

    // 6. Send done event
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();

    // 7. Persist conversation asynchronously (after response is sent)
    try {
      const conversations = loadConversations();
      let conversation;

      if (existingConversationId) {
        conversation = conversations.find((c) => c.id === existingConversationId);
      }

      if (!conversation) {
        conversation = {
          id: existingConversationId || crypto.randomUUID(),
          sessionId: sessionId || "anonymous",
          documentId,
          documentName: documentName || null,
          createdAt: new Date().toISOString(),
          messages: [],
        };
        conversations.push(conversation);
      }

      conversation.messages.push(
        { role: "user", content: query, sources: [] },
        { role: "assistant", content: fullContent, sources }
      );

      saveConversations(conversations);
    } catch (persistError) {
      console.error("Error persisting conversation:", persistError);
    }
  } catch (error) {
    console.error("Error during chat:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to generate response", details: error.message }));
  }
});

// Conversations Endpoint (Lists conversations for a session)
app.get("/conversations", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    const conversations = loadConversations();
    const filtered = sessionId
      ? conversations.filter((c) => c.sessionId === sessionId)
      : conversations;
    res.json({ conversations: filtered });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Single Conversation Endpoint (Gets messages for a conversation)
app.get("/conversations/:id", async (req, res) => {
  try {
    const conversations = loadConversations();
    const conversation = conversations.find((c) => c.id === req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    res.json({ conversation });
  } catch (error) {
    console.error("Error fetching conversation:", error);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
