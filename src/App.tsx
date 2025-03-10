// import React, { useState, useRef, useEffect } from 'react';
// import { Send } from 'lucide-react';
// import { ChatMessage } from './components/ChatMessage';
// import { Message } from './types';
// import OpenAI from 'openai';
// import { ConversationSummaryMemory } from "langchain/memory";
// import { ChatOpenAI } from "@langchain/openai";
// import { FileUpload } from './components/FileUpload';
// import { v4 as uuidv4 } from 'uuid';

// const API_BASE_URL = "http://localhost:8888/.netlify/functions/api";

// const openai = new OpenAI({
//   apiKey: import.meta.env.VITE_OPENAI_API_KEY,
//   dangerouslyAllowBrowser: true // REMOVE THIS IN PRODUCTION
// });

// const llm = new ChatOpenAI({
//   openAIApiKey: import.meta.env.VITE_OPENAI_API_KEY,
//   modelName: "gpt-4o",
//   temperature: 0.7,
// });

// const memory = new ConversationSummaryMemory({
//   llm: llm,
// });

// function App() {
//   const [messages, setMessages] = useState<Message[]>([
//     { role: 'system', content: 'Welcome! Upload documents or start chatting.' }
//   ]);
//   const [input, setInput] = useState('');
//   const [isProcessing, setIsProcessing] = useState(false);
//   const [error, setError] = useState<string | null>(null);
//   const messagesEndRef = useRef<HTMLDivElement>(null);
//   const [file, setFile] = useState<File | null>(null);
//   const [isLoading] = useState(false);
//   const [isUploading, setIsUploading] = useState(false);
//   const [latestDocId, setLatestDocId] = useState<string | null>(null);
//   const [documents, setDocuments] = useState<{ id: string, name: string }[]>([]);
//   const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

//   // Generate or retrieve session ID
//   const sessionId = useRef<string>(localStorage.getItem('sessionId') || uuidv4());
//   useEffect(() => {
//     localStorage.setItem('sessionId', sessionId.current);
//   }, []);

//   useEffect(() => {
//     messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
//   }, [messages]);

//   useEffect(() => {
//     fetchDocuments();
//   }, []);

//   const fetchDocuments = async () => {
//     try {
//       const response = await fetch(`${API_BASE_URL}/documents`, {
//         method: 'GET',
//         headers: { 
//           'Accept': 'application/json',
//           'session-id': sessionId.current
//         }
//       });

//       if (!response.ok) {
//         throw new Error('Failed to fetch documents');
//       }

//       const result = await response.json();
//       setDocuments(result.documents);
//     } catch (error) {
//       console.error('Fetch documents error:', error);
//       setError(error instanceof Error ? error.message : 'Unknown error');
//     }
//   };

//   const handleFileUpload = async (file: File) => {
//     setFile(file);
//     if (!file) {
//       setError("No file selected. Please choose a file before uploading.");
//       return;
//     }
    
//     setIsUploading(true);
 
//     const formData = new FormData();
//     formData.append('document', file);
//     formData.append('sessionId', sessionId.current);

//     try {
//       const response = await fetch(`${API_BASE_URL}/upload`, {
//         method: 'POST',
//         body: formData,
//         headers: { 
//           'Accept': 'application/json',
//           'session-id': sessionId.current
//         }
//       });

//       if (!response.ok) {
//         throw new Error('Failed to upload document');
//       }

//       const result = await response.json();
//       console.log(result.message);

//       if (result.documentId) {
//         setLatestDocId(result.documentId);
//         setSelectedDocId(result.documentId);
//         setDocuments(prev => [...prev, { id: result.documentId, name: file.name }]);
//         // Clear context and reset messages
//         setMessages([{ role: 'system', content: `Successfully uploaded and processed ${file.name}. You can now ask questions about it!` }]);
//       }

//     } catch (error) {
//       console.error('Upload error:', error);
//       setError(error instanceof Error ? error.message : 'Unknown error');
//       setMessages(prev => [...prev, { role: 'system', content: `Error uploading ${file.name}: ${error}` }]);
//     } finally {
//       setIsUploading(false);
//     }
//   };

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault();
//     if (!input.trim() || isProcessing || !selectedDocId) return;

//     const userMessage: Message = { role: 'user', content: input };
//     setMessages(prev => [...prev, userMessage]);
//     setInput('');
//     setIsProcessing(true);

//     try {
//         const conversationHistory = await memory.loadMemoryVariables({});
//         console.log('Generating embedding for input:', input);
//         const queryEmbedding = await generateEmbedding(input);

//         const response = await fetch(`${API_BASE_URL}/query`, {
//             method: 'POST',
//             headers: {
//                 'Content-Type': 'application/json',
//                 'session-id': sessionId.current
//             },
//             body: JSON.stringify({ query: input, embedding: queryEmbedding, documentId: selectedDocId }),
//         });

//         if (!response.ok) {
//             throw new Error('Failed to query documents');
//         }

//         const result = await response.json();
//         const relevantChunks = result.results
//                               .filter((doc: any) => doc.metadata.documentId === selectedDocId)  // Ensure only latest doc data
//                               .map((doc: any) => doc.pageContent)
//                               .slice(0, 5)
//                               .join("\n\n");
        
//         console.log(`Retrieved ${result.results.length} relevant chunks`);

//         const systemPrompt = { 
//           role: "system", 
//           content: `You are an AI assistant answering questions about the uploaded document: "${file?.name || 'Latest Document'}". 
//           Only use the context provided below and do NOT guess or make up information. If the answer is not in the document, reply with: 
//           "I could not find relevant information in the document." 
        
//           Context:\n${relevantChunks}`
//         };
        
//         // Ensure conversationHistory.history is an array
//         const history = Array.isArray(conversationHistory.history) ? conversationHistory.history : [];

//         // Construct the messages array for OpenAI
//         const messagesForOpenAI = [
//             systemPrompt,
//             ...history.map((msg: any) => ({ role: msg.role, content: msg.content })), // Ensure each message is an object
//             userMessage
//           ];

//         const completion = await openai.chat.completions.create({
//             model: "gpt-3.5-turbo",
//             messages: messagesForOpenAI
//         });

//         const assistantMessage: Message = {
//             role: 'assistant',
//             content: completion.choices[0].message.content || 'I apologize, but I was unable to generate a response.'
//         };
//         setMessages(prev => [...prev, assistantMessage]);

//         await memory.saveContext({ human: input }, { ai: assistantMessage.content }); // Save the interaction

//     } catch (error) {
//         console.error('Error:', error);
//         setError(error instanceof Error ? error.message : 'An error occurred.');
//         setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error}` }]);
//     } finally {
//         setIsProcessing(false);
//     }
//   };

//   const generateEmbedding = async (text: string): Promise<number[]> => {
//     try {
//       const response = await openai.embeddings.create({
//         model: 'text-embedding-ada-002',
//         input: [text], // Ensure input is an array of strings
//       });
//       return response.data[0].embedding;
//     } catch (error) {
//       console.error('Error generating embeddings:', error);
//       throw new Error('Failed to generate embeddings');
//     }
//   };

//   return (
//     <div className="flex flex-col h-screen bg-gray-50">
//       <header className="flex items-center justify-between px-6 py-4 bg-white border-b shadow-sm">
//         <h1 className="text-xl font-semibold text-gray-800">RAG Chat System</h1>
//         <div>
//          <FileUpload onUpload={handleFileUpload} isUploading={isUploading} /> 
//          {file && <p className="mt-4 text-green-600">Selected File: {file.name}</p>}
//         </div>
//       </header>

//       <main className="flex-1 overflow-y-auto p-6 space-y-4">
//         {messages.length === 0 ? (
//           <div className="flex items-center justify-center h-full">
//             <p className="text-gray-500">No messages yet. Start a conversation!</p>
//           </div>
//         ) : (
//           messages.map((message, index) => (
//             <ChatMessage key={index} message={message} />
//           ))
//         )}
//         <div ref={messagesEndRef} />
//       </main>

//       {error && (
//         <div className="px-6 py-2 bg-red-50 border-t border-red-200">
//           <p className="text-red-600 text-sm">{error}</p>
//         </div>
//       )}

//       <footer className="border-t bg-white p-4">
//         <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
//           <div className="flex gap-4">
//             <select
//               value={selectedDocId || ''}
//               onChange={(e) => setSelectedDocId(e.target.value)}
//               className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
//             >
//               <option value="" disabled>Select a document</option>
//               {documents.map((doc) => (
//                 <option key={doc.id} value={doc.id}>{doc.name}</option>
//               ))}
//             </select>
//             <input
//               type="text"
//               value={input}
//               onChange={(e) => setInput(e.target.value)}
//               placeholder={isLoading ? "Processing..." : "Type your message..."}
//               className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
//               disabled={isLoading}
//             />
//             <button
//               type="submit"
//               disabled={isLoading || !input.trim()}
//               className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
//             >
//               <Send className="w-5 h-5" />
//             </button>
//           </div>
//         </form>
//       </footer>
//     </div>
//   );
// }

import React, { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { ChatMessage } from './components/ChatMessage';
import { Message } from './types';
import OpenAI from 'openai';
import { ConversationSummaryMemory } from "langchain/memory";
import { ChatOpenAI } from "@langchain/openai";
import { FileUpload } from './components/FileUpload';
import { v4 as uuidv4 } from 'uuid';

// const API_BASE_URL = "http://localhost:8888/.netlify/functions/api";
const API_BASE_URL = "https://glowing-bavarois-afec96.netlify.app/.netlify/functions/api";


const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true // REMOVE THIS IN PRODUCTION
});

const llm = new ChatOpenAI({
  openAIApiKey: import.meta.env.VITE_OPENAI_API_KEY,
  modelName: "gpt-4o",
  temperature: 0.7,
});

const memory = new ConversationSummaryMemory({
  llm: llm,
});

function App() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'Welcome! Upload documents or start chatting.' }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [latestDocId, setLatestDocId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<{ id: string, name: string }[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedDocName, setSelectedDocName] = useState<string | null>(null);

  // Generate or retrieve session ID
  const sessionId = useRef<string>(localStorage.getItem('sessionId') || uuidv4());
  useEffect(() => {
    localStorage.setItem('sessionId', sessionId.current);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/documents`, {
        method: 'GET',
        headers: { 
          'Accept': 'application/json',
          'session-id': sessionId.current
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }

      const result = await response.json();
      setDocuments(result.documents);
    } catch (error) {
      console.error('Fetch documents error:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const handleFileUpload = async (file: File) => {
    setFile(file);
    if (!file) {
      setError("No file selected. Please choose a file before uploading.");
      return;
    }
    
    setIsUploading(true);
 
    const formData = new FormData();
    formData.append('document', file);
    formData.append('sessionId', sessionId.current);

    try {
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
        headers: { 
          'Accept': 'application/json',
          'session-id': sessionId.current
        }
      });

      if (!response.ok) {
        throw new Error('Failed to upload document');
      }

      const result = await response.json();
      console.log(result.message);

      if (result.documentId) {
        setLatestDocId(result.documentId);
        setSelectedDocId(result.documentId);
        setSelectedDocName(file.name);
        setDocuments(prev => [...prev, { id: result.documentId, name: file.name }]);
        // Clear context and reset messages
        setMessages([{ role: 'system', content: `Successfully uploaded and processed ${file.name}. You can now ask questions about it!` }]);
      }

    } catch (error) {
      console.error('Upload error:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
      setMessages(prev => [...prev, { role: 'system', content: `Error uploading ${file.name}: ${error}` }]);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing || !selectedDocId) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsProcessing(true);

    try {
        const conversationHistory = await memory.loadMemoryVariables({});
        console.log('Generating embedding for input:', input);
        const queryEmbedding = await generateEmbedding(input);

        const response = await fetch(`${API_BASE_URL}/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'session-id': sessionId.current
            },
            body: JSON.stringify({ query: input, embedding: queryEmbedding, documentId: selectedDocId }),
        });

        if (!response.ok) {
            throw new Error('Failed to query documents');
        }

        const result = await response.json();
        const relevantChunks = result.results
                              .filter((doc: any) => doc.metadata.documentId === selectedDocId)  // Ensure only latest doc data
                              .map((doc: any) => doc.pageContent)
                              .slice(0, 5)
                              .join("\n\n");
        
        console.log(`Retrieved ${result.results.length} relevant chunks`);

        const systemPrompt = { 
          role: "system", 
          content: `You are an AI assistant answering questions about the uploaded document: "${selectedDocName}". 
          Only use the context provided below and do NOT guess or make up information. If the answer is not in the document, reply with: 
          "I could not find relevant information in the document." 
        
          Context:\n${relevantChunks}`
        };
        
        // Ensure conversationHistory.history is an array
        const history = Array.isArray(conversationHistory.history) ? conversationHistory.history : [];

        // Construct the messages array for OpenAI
        const messagesForOpenAI = [
            systemPrompt,
            ...history.map((msg: any) => ({ role: msg.role, content: msg.content })), // Ensure each message is an object
            userMessage
          ];

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: messagesForOpenAI
        });

        const assistantMessage: Message = {
            role: 'assistant',
            content: completion.choices[0].message.content || 'I apologize, but I was unable to generate a response.'
        };
        setMessages(prev => [...prev, assistantMessage]);

        await memory.saveContext({ human: input }, { ai: assistantMessage.content }); // Save the interaction

    } catch (error) {
        console.error('Error:', error);
        setError(error instanceof Error ? error.message : 'An error occurred.');
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error}` }]);
    } finally {
        setIsProcessing(false);
    }
  };

  const generateEmbedding = async (text: string): Promise<number[]> => {
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: [text], // Ensure input is an array of strings
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error('Error generating embeddings:', error);
      throw new Error('Failed to generate embeddings');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b shadow-sm">
        <h1 className="text-xl font-semibold text-gray-800">RAG Chat System</h1>
        <div>
         <FileUpload onUpload={handleFileUpload} isUploading={isUploading} /> 
         {file && <p className="mt-4 text-green-600">Selected File: {file.name}</p>}
        </div>
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
            <select
              value={selectedDocId || ''}
              onChange={(e) => {
                const selectedDoc = documents.find(doc => doc.id === e.target.value);
                setSelectedDocId(e.target.value);
                setSelectedDocName(selectedDoc ? selectedDoc.name : null);
              }}
              className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="" disabled>Select a document</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>{doc.name}</option>
              ))}
            </select>
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