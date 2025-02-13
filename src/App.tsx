import React, { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { ChatMessage } from './components/ChatMessage';
import { FileUpload } from './components/FileUpload';
import { Message } from './types';
import { supabase } from './lib/supabase';
import OpenAI from 'openai';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;



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

  const generateEmbedding = async (text: string) => {
    try {
      console.log('Generating embedding for text:', text);
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });
      console.log('Embedding response:', response);
      return response.data[0].embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw new Error('Failed to generate embedding');
    }
  };

  const searchDocuments = async (embedding: number[]) => {
    try {
      const { data: documents, error } = await supabase.rpc('match_documents', {
        query_embedding: embedding,
        match_threshold: 0.7,
        match_count: 5
      });
  
      if (error) throw error;
      console.log('Relevant chunks:', documents);
      return documents;
    } catch (error) {
      console.error('Error searching documents:', error);
      throw new Error('Failed to search documents');
    }
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
      const relevantChunks = await searchDocuments(queryEmbedding);
  
      const context = relevantChunks.map(doc => doc.content).join('\n\n');
      console.log('Prepared context:', context);
  
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: `Use the context below to answer the user's question.\n\nContext:\n${context}` },
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