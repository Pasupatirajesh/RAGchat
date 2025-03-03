import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone';
import { PineconeStore } from '@langchain/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import * as fs from 'fs';
import * as path from 'path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import dotenv from 'dotenv';
import multer from 'multer';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid'; // Import UUID for generating unique document IDs

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
      const data = await pdfParse(file); // `file` should be a Buffer or Uint8Array
      return data.text;
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
      const sessionId = req.headers['session-id'];
      if (!file || !sessionId) {
        return resolve({
          statusCode: 400,
          body: JSON.stringify({ error: 'No file or session ID provided' }),
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

        // Generate a unique document ID
        const documentId = uuidv4();

        // Chunk the extracted text
        const maxTokens = 8192;
        const chunks = chunkText(extractedText, maxTokens);

        // Add all chunks to the vector store concurrently
        await Promise.all(
          chunks.map((chunk) => {
            const documents = [{ pageContent: chunk, metadata: { filename: file.originalname, documentId, sessionId } }];
            return vectorStore.addDocuments(documents);
          })
        );

        // Respond with success and return the document ID
        resolve({
          statusCode: 200,
          body: JSON.stringify({ message: 'Document processed and added to vector store successfully', documentId }),
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
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const { query, documentId } = body;
  if (!query) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Query is required' }),
    };
  }

  if (!documentId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Document ID is required' }),
    };
  }

  try {
    const results = await vectorStore.similaritySearch(query, 5);
    const filteredResults = results.filter((doc: any) => doc.metadata.documentId === documentId);

    return {
      statusCode: 200,
      body: JSON.stringify({ results: filteredResults }),
    };
  } catch (error) {
    console.error('Error during similarity search:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to perform similarity search', details: error.message }),
    };
  }
};

// Handler for fetching documents
const fetchDocumentsHandler: Handler = async (event: HandlerEvent, context: HandlerContext): Promise<HandlerResponse> => {
  const sessionId = event.headers['session-id'];
  if (!sessionId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Session ID is required' }),
    };
  }

  try {
    const results = await vectorStore.similaritySearch('', 1000); // Fetch all documents
    const filteredResults = results.filter((doc: any) => doc.metadata.sessionId === sessionId);

    const documents = filteredResults.map((doc: any) => ({
      id: doc.metadata.documentId,
      name: doc.metadata.filename,
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ documents }),
    };
  } catch (error) {
    console.error('Error fetching documents:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch documents', details: error.message }),
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
  } else if (path === '/.netlify/functions/api/documents') {
    return fetchDocumentsHandler(event, context);
  } else {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Not Found' }),
    };
  }
};