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
    if (file.mimetype === 'text/plain') {
      return fs.readFileSync(file.path, 'utf-8');
    } else {
      throw new Error("Unsupported file type. Only .txt files are supported.");
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

// Upload Endpoint (Handles File Upload, Extraction, and Vector Store Addition)
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

    const documents = [{ pageContent: extractedText, metadata: { filename: file.originalname } }];
    await vectorStore.addDocuments(documents);

    // Clean up the uploaded file after processing
    fs.unlink(file.path, (err) => {
      if (err) {
        console.error("Error deleting file:", err);
      } else {
        console.log("File deleted successfully");
      }
    });

    res.json({ message: "Document processed and added to vector store successfully" });
  } catch (error) {
    console.error("Error processing document:", error);
    res.status(500).json({ error: "Failed to process document", details: error.message });
  }
});

// Query Endpoint (Performs Similarity Search)
app.post("/query", async (req, res) => {
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }

  try {
    const results = await vectorStore.similaritySearch(query, 5);
    res.json({ results });
  } catch (error) {
    console.error("Error during similarity search:", error);
    res.status(500).json({ error: "Failed to perform similarity search", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));