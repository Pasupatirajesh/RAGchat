import React, { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { ChatMessage } from './components/ChatMessage';
import { FileUpload } from './components/FileUpload';
import { Message } from './types';
import { supabase } from './lib/supabase';
import OpenAI from 'openai';
import { PDFDocument, utf16Decode } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { BM25 } from './utils/bm25.ts';

import { GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

GlobalWorkerOptions.workerSrc = pdfWorker;



// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true // Note: In production, you should use a backend service
});

function App() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'Welcome! You can start chatting or upload documents to get started.' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const bm25 = new BM25();

  const generateEmbedding = async (text: string) => {
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: text,
      });
      console.log('Embedding response:', response);
      // return response.data.map(item => item.embedding);
      return response.data[0].embedding;
    } catch (error) {
      console.error('Error generating embeddings:', error);
      throw new Error('Failed to generate embeddings');
    }
  };


  const searchDocuments = async (query: string, embedding: number[]) => {
    // Retrieve documents from Supabase
    const { data: documents, error } = await supabase
      .from('documents')
      .select('id, content, embedding');

    if (error) throw error;

    // Compute similarity scores using embeddings
    const embeddingScores = documents.map((doc) => {
      const similarity = cosineSimilarity(embedding, doc.embedding);
      return { id: doc.id, content: doc.content, score: similarity };
    });

    // Compute BM25 scores
    bm25.documents = documents.map(doc => doc.content);
    const bm25Scores = bm25.search(query); // ERROR: `query` is not defined in this function!

    // Combine scores
    const combinedScores = documents.map((doc, index) => {
      const embeddingScore = embeddingScores[index].score;
      const bm25Score = bm25Scores.find(bm25Doc => bm25Doc.doc === doc.content)?.score || 0;
      const combinedScore = embeddingScore + bm25Score;
      return { id: doc.id, content: doc.content, score: combinedScore };
    });

    // Sort documents by combined score
    combinedScores.sort((a, b) => b.score - a.score);

    return combinedScores;
  };


  const cosineSimilarity = (a, b) => {
    const dotProduct = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  };

  const chunkText = (text: string, chunkSize: number = 1024, overlap: number = 256): string[] => {
    const words = text.split(/\s+/);
    const chunks: string[] = [];

    for (let i = 0; i < words.length; i += chunkSize - overlap) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      chunks.push(chunk);
    }

    return chunks;
  };

  const extractTextFromFile = async (file: File): Promise<string[]> => {
    try {
      console.log('Extracting text from file:', file.name);
      if (file.type !== 'application/pdf') {
        const text = await file.text();
        return chunkText(text, 1024); // Chunk plain text
      }

      // Convert file to an ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      const allText = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ');
        allText.push(pageText);
      }
      // Join all page text and chunk it
      return chunkText(allText.join('\n'), 1024);
    } catch (error) {
      console.error('Error extracting text:', error);
      throw new Error(`Failed to extract text from ${file.name}`);
    }
  };

  const handleFileUpload = async (file: File) => {
    console.log('Uploading file:', file);
    setIsUploading(true);
    setError(null);

    try {
      // Extract and chunk text
      const textChunks = await extractTextFromFile(file);
      console.log('Extracted text chunks:', textChunks);

      // Generate embeddings for each chunk
      const chunkEmbeddings = await Promise.all(
        textChunks.map(chunk => generateEmbedding(chunk))
      );

      for (let i = 0; i < textChunks.length; i++) {
        // Ensure embedding is an array of floats (not a JSON string)
        const embeddingArray = chunkEmbeddings[i];

        const { error: uploadError } = await supabase
          .from('documents')
          .insert([{
            content: textChunks[i],
            embedding: embeddingArray,
            metadata: {
              filename: file.name,
              type: file.type,
              size: file.size,
              chunk_index: i
            }
          }]);

        if (uploadError) throw uploadError;
      }

      setMessages(prev => [...prev, {
        role: 'system',
        content: `Successfully uploaded and processed ${file.name} (${textChunks.length} chunks)`
      }]);

    } catch (error) {
      console.error('Upload error:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
      setMessages(prev => [...prev, { role: 'system', content: `Error uploading ${file.name}` }]);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      console.log('Generating embedding for input:', input);
      const queryEmbedding = await generateEmbedding(input);

      console.log('Searching for relevant document chunks...');
      const relevantChunks = await searchDocuments(input, queryEmbedding);

      const context = relevantChunks.map(doc => doc.content).join('\n\n');
      console.log('Prepared context:', context);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: `You are an AI assistant specialized in extracting and verifying author information from academic documents. Your primary task is to accurately identify the author(s) of the document provided in the context below. Follow these guidelines:
      
          1. Author information is typically found at the beginning of the document, often near the title.
          2. If multiple authors are listed, provide all names in the order they appear.
          3. Only extract names that are explicitly stated as authors in the text.
          4. Do not infer or guess author names based on other mentions in the text.
          5. If you cannot find any clear author information, respond with "Author information not found in the provided context."
      
          Process:
          1. Carefully read the entire context provided.
          2. Look for explicit author attributions (e.g., "by [Name]", "Author: [Name]", "[Name] et al.").
          3. Verify that the names you've identified are indeed presented as authors of the document.
          4. If author information is found, extract and report it exactly as it appears in the text.
          5. If no clear author information is present, report that it's not found.
      
          Remember: Accuracy is crucial. It's better to report no author found than to provide incorrect information.
      
          Context:
          ${context}
      
          Now, please identify the author(s) of this document based solely on the information provided in the context above.` },
          ...messages.slice(-5),
          userMessage
        ]
      });
      
    


      const assistantMessage: Message = {
        role: 'assistant',
        content: completion.choices[0].message.content || 'I apologize, but I was unable to generate a response.'
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error:', error);
      setError(error instanceof Error ? error.message : 'An error occurred.');
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b shadow-sm">
        <h1 className="text-xl font-semibold text-gray-800">RAG Chat System</h1>
        <FileUpload onUpload={handleFileUpload} isUploading={isUploading} />
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500">No messages yet. Start a conversation!</p>
          </div>
        ) : (
          messages.map((message, index) => (
            <ChatMessage key={index} message={message} />
          ))
        )}
        <div ref={messagesEndRef} />
      </main>

      {error && (
        <div className="px-6 py-2 bg-red-50 border-t border-red-200">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      <footer className="border-t bg-white p-4">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
          <div className="flex gap-4">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isLoading ? "Processing..." : "Type your message..."}
              className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </form>
      </footer>
    </div>
  );
}

export default App;