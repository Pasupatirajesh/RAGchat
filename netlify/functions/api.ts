import { Handler } from "@netlify/functions";
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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set worker source
if (typeof pdfjsLib.GlobalWorkerOptions !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString();
}

const app = express();
app.use(cors());
app.use(express.json());

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

const handler: Handler = async (event) => {
  if (event.path === "/upload" && event.httpMethod === "POST") {
    try {
      const multerResult = await new Promise((resolve, reject) => {
        upload.single("document")(event.req, event.res, (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve({ req: event.req, res: event.res });
        });
      });

      // Access the uploaded file from the request object
      const file = multerResult.req.file;

      if (!file) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "No file uploaded" }),
        };
      }

      const extractedText = await extractTextFromFile(file);
      if (!extractedText) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Could not extract text from the file." }),
        };
      }

      const maxTokens = 8192;
      const chunks = chunkText(extractedText, maxTokens);

      for (const chunk of chunks) {
        const documents = [{ pageContent: chunk, metadata: { filename: file.originalname } }];
        await vectorStore.addDocuments(documents);
      }

      fs.unlinkSync(file.path);

      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Document processed and added to vector store successfully" }),
      };
    } catch (error) {
      console.error("Error processing document:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Failed to process document", details: error.message }),
      };
    }
  }

  if (event.path === "/query" && event.httpMethod === "POST") {
    try {
      const { query } = JSON.parse(event.body || "{}");

      if (!query) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Query is required" }),
        };
      }

      const results = await vectorStore.similaritySearch(query, 5);
      return {
        statusCode: 200,
        body: JSON.stringify({ results }),
      };
    } catch (error) {
      console.error("Error during similarity search:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Failed to perform similarity search", details: error.message }),
      };
    }
  }

  return {
    statusCode: 404,
    body: JSON.stringify({ error: "Not Found" }),
  };
};

export { handler };