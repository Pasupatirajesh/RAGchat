import express from "express";
import cors from "cors";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
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
app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// Initialize Pinecone and Embeddings
const pineconeClient = new PineconeClient();

const pineconeIndex = pineconeClient.Index(process.env.PINECONE_INDEX);
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "text-embedding-ada-002",
});

let vectorStore;
const DOCUMENTS_FILE = path.join(__dirname, 'documents.json');

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

    // Attach metadata to each chunk
    const documents = chunks.map((chunk) => ({
      pageContent: chunk.pageContent,
      metadata: { filename: file.originalname, documentId },
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));