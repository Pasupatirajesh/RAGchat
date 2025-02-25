import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone';
import { PineconeStore } from '@langchain/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import * as fs from 'fs';
import * as path from 'path';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import dotenv from 'dotenv';
import multer from 'multer';
import { Readable } from 'stream';

dotenv.config();

// Initialize Pinecone and OpenAI embeddings
const pineconeClient = new PineconeClient();
const pineconeIndex = pineconeClient.Index(process.env.PINECONE_INDEX);
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: 'text-embedding-ada-002',
});

let vectorStore: PineconeStore;

// Initialize vector store
const initVectorStore = async () => {
  try {
    vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      maxConcurrency: 5,
    });
    console.log('Vector store initialized successfully!');
  } catch (error) {
    console.error('Error initializing vector store:', error);
  }
};
initVectorStore();

// Helper function to extract text from uploaded file
const extractTextFromFile = async (file: Buffer, mimetype: string): Promise<string> => {
  try {
    if (mimetype === 'text/plain') {
      return file.toString('utf-8');
    } else if (mimetype === 'application/pdf') {
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(file) }).promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str).join(' ');
        fullText += pageText + '\n';
      }
      return fullText;
    } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const docxData = await mammoth.extractRawText({ buffer: file });
      return docxData.value;
    }

    throw new Error('Unsupported file type. Only .txt, .pdf, and .docx files are supported.');
  } catch (error) {
    console.error('Error extracting text:', error);
    throw error;
  }
};

// Helper function to chunk the extracted text
const chunkText = (text: string, maxTokens: number): string[] => {
  const words = text.split(' ');
  const chunks: string[] = [];
  let chunk: string[] = [];

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

// Multer setup
const storage = multer.memoryStorage();
const upload = multer({ storage }).single('document');

// Convert Netlify event to a format that multer can understand
const bufferToStream = (buffer: Buffer) => {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
};

// Handler for the upload route
const uploadHandler: Handler = async (event: HandlerEvent, context: HandlerContext): Promise<HandlerResponse> => {
  return new Promise((resolve, reject) => {
    const req = bufferToStream(Buffer.from(event.body || '', 'base64'));
    req.headers = event.headers;
    req.method = event.httpMethod;
    req.url = event.path;

    const res = {
      statusCode: 200,
      headers: {},
      body: '',
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      end(body: string) {
        this.body = body;
        resolve(this);
      },
    };

    upload(req, res, async (err: any) => {
      if (err) {
        return resolve({
          statusCode: 400,
          body: JSON.stringify({ error: 'Error uploading file', details: err.message }),
        });
      }

      const file = req.file;
      if (!file) {
        return resolve({
          statusCode: 400,
          body: JSON.stringify({ error: 'No file uploaded' }),
        });
      }

      try {
        const extractedText = await extractTextFromFile(file.buffer, file.mimetype);

        if (!extractedText) {
          return resolve({
            statusCode: 400,
            body: JSON.stringify({ error: 'Could not extract text from the file.' }),
          });
        }

        // Chunk the extracted text
        const maxTokens = 8192;
        const chunks = chunkText(extractedText, maxTokens);

        // Add all chunks to the vector store concurrently
        await Promise.all(
          chunks.map((chunk) => {
            const documents = [{ pageContent: chunk, metadata: { filename: file.originalname } }];
            return vectorStore.addDocuments(documents);
          })
        );

        // Respond with success
        resolve({
          statusCode: 200,
          body: JSON.stringify({ message: 'Document processed and added to vector store successfully' }),
        });
      } catch (error) {
        console.error('Error processing document:', error);
        resolve({
          statusCode: 500,
          body: JSON.stringify({ error: 'Failed to process document', details: error.message }),
        });
      }
    });
  });
};

// Handler for the query route
const queryHandler: Handler = async (event: HandlerEvent, context: HandlerContext): Promise<HandlerResponse> => {
  const { query } = JSON.parse(event.body || '{}');
  if (!query) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Query is required' }),
    };
  }

  try {
    const results = await vectorStore.similaritySearch(query, 5);
    return {
      statusCode: 200,
      body: JSON.stringify({ results }),
    };
  } catch (error) {
    console.error('Error during similarity search:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to perform similarity search', details: error.message }),
    };
  }
};

// Main handler to route requests
export const handler: Handler = async (event: HandlerEvent, context: HandlerContext): Promise<HandlerResponse> => {
  const { path } = event;

  if (path === '/.netlify/functions/api/upload') {
    return uploadHandler(event, context);
  } else if (path === '/.netlify/functions/api/query') {
    return queryHandler(event, context);
  } else {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Not Found' }),
    };
  }
};