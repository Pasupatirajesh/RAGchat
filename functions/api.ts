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
// import pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = `./pdf.worker.min.js`


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/pdfjs", express.static("public/pdfjs"));

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

const extractTextFromFile = async (file) => {
    try {
        if (!fs.existsSync(file.path)) {
            throw new Error(`File not found: ${file.path}`);
        }

        const fileBuffer = fs.readFileSync(file.path);

        if (file.mimetype === 'text/plain') {
            return fileBuffer.toString('utf-8');
        } else if (file.mimetype === 'application/pdf') {
            // Extract text from PDF using pdfjs-dist
            // Load the PDF document
            const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer) }).promise;
            let fullText = "";

            // Iterate over each page in the PDF
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();

                // Extract the text items from the content
                const pageText = textContent.items.map(item => item.str).join(" ");
                fullText += pageText + "\n";
            }

            return fullText;
        } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            // Extract text from DOCX using Mammoth
            const docxData = await mammoth.extractRawText({ buffer: fileBuffer });
            return docxData.value;
        }

        throw new Error("Unsupported file type. Only .txt, .pdf, and .docx files are supported.");
    } catch (error) {
        console.error("Error extracting text:", error);
        throw error;
    }
};
// Function to Chunk Text
const chunkText = (text, maxTokens) => {
    const words = text.split(' ');
    const chunks = [];
    let chunk = [];

    for (const word of words) {
        if (chunk.join(' ').length + word.length + 1 > maxTokens) {
            chunks.push(chunk.join(' '));
            chunk = [];
        }
        chunk.push(word);
    }

    if (chunk.length > 0) {
        chunks.push(chunk.join(' '));
    }

    return chunks;
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

    // Chunk the extracted text
    const maxTokens = 8192; // Maximum token limit for the embedding model
    const chunks = chunkText(extractedText, maxTokens);

    // Add each chunk to the vector store
    for (const chunk of chunks) {
      const documents = [{ pageContent: chunk, metadata: { filename: file.originalname } }];
      await vectorStore.addDocuments(documents);
    }

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