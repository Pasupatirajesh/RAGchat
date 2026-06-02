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
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// Initialize Supabase client (backend uses service role key for full access)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
let supabase;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("Supabase client initialized");
} else {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY - persistence will fail");
}

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

// Function to Extract Text from File
const extractTextFromFile = async (file) => {
  try {
    const ext = path.extname(file.originalname).toLowerCase();

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

// Pinecone Connection Endpoint
app.get("/pinecone", async (req, res) => {
  try {
    res.json({ message: "Connected to Pinecone", index: pineconeIndex.name });
  } catch (error) {
    console.error("Pinecone connection failed:", error);
    res.status(500).json({ error: "Failed to connect to Pinecone" });
  }
});

// Upload Endpoint
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

    // Split text into chunks
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const chunks = await textSplitter.createDocuments([extractedText]);

    // Attach metadata to each chunk
    const documents = chunks.map((chunk, index) => ({
      pageContent: chunk.pageContent,
      metadata: { filename: file.originalname, documentId, chunkIndex: index },
    }));

    await vectorStore.addDocuments(documents);
    console.log(`[Upload] Stored ${documents.length} chunks for documentId=${documentId}, filename=${file.originalname}`);

    // Save document metadata to Supabase
    if (supabase) {
      const { error } = await supabase
        .from('documents')
        .insert([{ id: documentId, name: file.originalname }]);
      if (error) {
        console.error("Error saving document to Supabase:", error);
      }
    }

    // Clean up uploaded file
    fs.unlink(file.path, (err) => {
      if (err) console.error("Error deleting file:", err);
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
    if (!supabase) {
      return res.status(500).json({ error: "Supabase not configured" });
    }
    const { data: documents, error } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Error fetching documents:", error);
      return res.status(500).json({ error: "Failed to fetch documents", details: error.message });
    }

    res.json({ documents: documents || [] });
  } catch (error) {
    console.error("Error fetching documents:", error);
    res.status(500).json({ error: "Failed to fetch documents", details: error.message });
  }
});

// Query Endpoint
app.post("/query", async (req, res) => {
  const { query, documentId } = req.body;

  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }

  try {
    const filter = documentId ? { documentId: { $eq: documentId } } : undefined;
    console.log(`[Query] documentId=${documentId}, filter=${JSON.stringify(filter)}, query="${query}"`);
    let results = await vectorStore.similaritySearch(query, 5, filter);
    console.log(`[Query] Filtered results count: ${results.length}`);

    if (results.length === 0 && documentId) {
      const unfilteredResults = await vectorStore.similaritySearch(query, 5);
      console.log(`[Query] Unfiltered results count: ${unfilteredResults.length}`);
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
    // Search for relevant chunks
    const filter = documentId ? { documentId: { $eq: documentId } } : undefined;
    const searchResultsWithScore = await vectorStore.similaritySearchWithScore(query, 5, filter);

    const SCORE_THRESHOLD = 0.8;
    let sources = searchResultsWithScore
      .filter(([_, score]) => score >= SCORE_THRESHOLD)
      .map(([doc]) => ({
        pageContent: doc.pageContent,
        metadata: doc.metadata,
      }));

    console.log(`[Chat] Found ${searchResultsWithScore.length} chunks, ${sources.length} above score ${SCORE_THRESHOLD} for query: "${query}"`);

    let contextOrigin = "document";

    if (sources.length === 0 && process.env.TAVILY_API_KEY) {
      console.log(`[Chat] No document chunks found. Falling back to web search for: "${query}"`);
      const webResults = await searchWeb(query);
      if (webResults && webResults.length > 0) {
        sources = webResults;
        contextOrigin = "web";
      }
    }

    const relevantChunks = sources.map((s) => s.pageContent).join("\n\n");

    // Build system prompt
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

    // Setup SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    // Stream LLM response
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

    // Send sources as final event
    res.write(`data: ${JSON.stringify({ type: "sources", sources })}\n\n`);

    // Send done event
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();

    // Persist conversation asynchronously to Supabase
    if (supabase) {
      try {
        let conversationId = existingConversationId;
        let existingMessages = [];

        // If conversation exists, fetch current messages
        if (conversationId) {
          const { data: existingConv } = await supabase
            .from('conversations')
            .select('messages')
            .eq('id', conversationId)
            .single();
          if (existingConv) {
            existingMessages = existingConv.messages || [];
          }
        } else {
          // Create new conversation
          conversationId = crypto.randomUUID();
          const { error: insertError } = await supabase
            .from('conversations')
            .insert([{
              id: conversationId,
              session_id: sessionId || "anonymous",
              document_id: documentId,
              document_name: documentName || null,
              messages: [],
            }]);
          if (insertError) {
            console.error("Error creating conversation:", insertError);
          }
        }

        // Append new messages
        const updatedMessages = [
          ...existingMessages,
          { role: "user", content: query, sources: [] },
          { role: "assistant", content: fullContent, sources }
        ];

        const { error: updateError } = await supabase
          .from('conversations')
          .update({ messages: updatedMessages })
          .eq('id', conversationId);

        if (updateError) {
          console.error("Error updating conversation:", updateError);
        }
      } catch (persistError) {
        console.error("Error persisting conversation:", persistError);
      }
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
    if (!supabase) {
      return res.status(500).json({ error: "Supabase not configured" });
    }
    const sessionId = req.query.sessionId;

    let query = supabase
      .from('conversations')
      .select('*')
      .order('created_at', { ascending: false });

    if (sessionId) {
      query = query.eq('session_id', sessionId);
    }

    const { data: conversations, error } = await query;

    if (error) {
      console.error("Error fetching conversations:", error);
      return res.status(500).json({ error: "Failed to fetch conversations" });
    }

    res.json({ conversations: conversations || [] });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Single Conversation Endpoint
app.get("/conversations/:id", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: "Supabase not configured" });
    }
    const { data: conversation, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !conversation) {
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
