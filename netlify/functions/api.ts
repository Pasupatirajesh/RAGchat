import { Handler, Context } from "@netlify/functions";
import express from "express";
import cors from "cors";
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import multer from "multer";
import dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";
import serverless from "serverless-http";

dotenv.config();

let __dirname: string;
try {
  __dirname = path.dirname(fileURLToPath(import.meta.url));
} catch (error) {
  __dirname = process.cwd(); // Fallback for environments without import.meta.url
}

// Set worker source
if (typeof pdfjsLib.GlobalWorkerOptions !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString();
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: "/tmp/uploads/" }); // Use /tmp for Netlify Functions

// Initialize Pinecone and Embeddings
const pineconeClient = new PineconeClient();
const pineconeIndex = pineconeClient.Index(process.env.PINECONE_INDEX);
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "text-embedding-ada-002",
});

let vectorStore: PineconeStore;

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

const extractTextFromFile = async (file: Express.Multer.File): Promise<string> => {
  try {
    if (!fs.existsSync(file.path)) {
      throw new Error(`File not found: ${file.path}`);
    }

    const fileBuffer = fs.readFileSync(file.path);

    if (file.mimetype === "text/plain") {
      return fileBuffer.toString("utf-8");
    } else if (file.mimetype === "application/pdf") {
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
    } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const docxData = await mammoth.extractRawText({ buffer: fileBuffer });
      return docxData.value;
    }

    throw new Error("Unsupported file type. Only .txt, .pdf, and .docx files are supported.");
  } catch (error) {
    console.error("Error extracting text:", error);
    throw error;
  }
};

const chunkText = (text: string, maxTokens: number): string[] => {
  const words = text.split(" ");
  const chunks: string[] = [];
  let chunk: string[] = [];

  for (const word of words) {
    if (chunk.join(" ").length + word.length + 1 > maxTokens) {
      chunks.push(chunk.join(" "));
      chunk = [];
    }
    chunk.push(word);
  }

  if (chunk.length > 0) {
    chunks.push(chunk.join(" "));
  }

  return chunks;
};

app.post("upload", upload.single("document"), async (req: any, res: any): Promise<void> => {
  console.log("Received /upload request");
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  console.log("Uploaded file details:", req.file);

  try {
    const file = req.file;
    const extractedText = await extractTextFromFile(file);

    if (!extractedText) {
      res.status(400).json({ error: "Could not extract text from the file." });
      return;
    }

    // Chunk the extracted text
    const maxTokens = 8192;
    const chunks = chunkText(extractedText, maxTokens);

    // Concurrently add all chunks to the vector store
    await Promise.all(chunks.map(chunk => {
      const documents = [{ pageContent: chunk, metadata: { filename: file.originalname } }];
      return vectorStore.addDocuments(documents);
    }));

    // Delete the uploaded file
    await fs.promises.unlink(file.path);
    console.log("File deleted successfully");

    res.status(200).json({ message: "Document processed and added to vector store successfully" });
  } catch (error) {
    console.error("Error processing document:", error);
    res.status(500).json({ error: "Failed to process document", details: error.message });
  }
});

app.post("query", async (req: any, res: any) => {
  const { query } = req.body;

  if (!query) {
    res.status(400).json({ error: "Query is required" });
    return;
  }

  try {
    const results = await vectorStore.similaritySearch(query, 5);
    res.status(200).json({ results });
  } catch (error) {
    console.error("Error during similarity search:", error);
    res.status(500).json({ error: "Failed to perform similarity search", details: error.message });
  }
});

const handler = serverless(app);

export { handler };