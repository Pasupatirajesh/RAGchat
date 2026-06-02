import React, { useState, useRef, useEffect } from 'react';
import { Send, Plus, History, ChevronRight, Trash2 } from 'lucide-react';
import { ChatMessage } from './components/ChatMessage';
import { Message, Source } from './types';
import { FileUpload } from './components/FileUpload';
import { v4 as uuidv4 } from 'uuid';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

interface Conversation {
  id: string;
  sessionId: string;
  documentId: string | null;
  documentName: string | null;
  createdAt: string;
  messages: Message[];
}

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
  const [documents, setDocuments] = useState<{ id: string, name: string }[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedDocName, setSelectedDocName] = useState<string | null>(null);
  const [hasRestoredSelection, setHasRestoredSelection] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showDemoBanner, setShowDemoBanner] = useState(() => {
    return localStorage.getItem('demoBannerDismissed') !== 'true';
  });

  const dismissDemoBanner = () => {
    setShowDemoBanner(false);
    localStorage.setItem('demoBannerDismissed', 'true');
  };

  const sessionId = useRef<string>(localStorage.getItem('sessionId') || uuidv4());
  useEffect(() => {
    localStorage.setItem('sessionId', sessionId.current);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    fetchDocuments();
    fetchConversations();
  }, []);

  useEffect(() => {
    if (documents.length > 0 && !hasRestoredSelection) {
      const lastDocId = localStorage.getItem('lastSelectedDocId');
      if (lastDocId) {
        const doc = documents.find((d) => d.id === lastDocId);
        if (doc) {
          setSelectedDocId(doc.id);
          setSelectedDocName(doc.name);
        }
      }
      setHasRestoredSelection(true);
    }
  }, [documents, hasRestoredSelection]);

  useEffect(() => {
    if (selectedDocId) {
      localStorage.setItem('lastSelectedDocId', selectedDocId);
    }
  }, [selectedDocId]);

  const fetchDocuments = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/documents?sessionId=${sessionId.current}`);
      if (!response.ok) throw new Error('Failed to fetch documents');
      const result = await response.json();
      setDocuments(result.documents);
    } catch (error) {
      console.error('Fetch documents error:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const fetchConversations = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/conversations?sessionId=${sessionId.current}`);
      if (!response.ok) throw new Error('Failed to fetch conversations');
      const result = await response.json();
      setConversations(result.conversations);
    } catch (error) {
      console.error('Fetch conversations error:', error);
    }
  };

  const loadConversation = async (conversationId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`);
      if (!response.ok) throw new Error('Failed to load conversation');
      const result = await response.json();
      const conversation = result.conversation;

      setActiveConversationId(conversation.id);
      setSelectedDocId(conversation.documentId);
      setSelectedDocName(conversation.documentName);

      // Map backend messages to frontend format
      const loadedMessages: Message[] = conversation.messages.map((m: any) => ({
        role: m.role,
        content: m.content,
        sources: m.sources,
      }));

      setMessages(loadedMessages.length > 0 ? loadedMessages : [
        { role: 'system', content: `Continuing conversation about ${conversation.documentName || 'your document'}.` }
      ]);
    } catch (error) {
      console.error('Load conversation error:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const startNewChat = () => {
    setActiveConversationId(null);
    setMessages([{ role: 'system', content: 'Welcome! Upload documents or start chatting.' }]);
    setSelectedDocId(null);
    setSelectedDocName(null);
    localStorage.removeItem('lastSelectedDocId');
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

    try {
      const response = await fetch(`${API_BASE_URL}/upload`, {
        
        method: 'POST',
        headers: { 'x-session-id': sessionId.current },
        body: formData,
      });

      if (!response.ok) throw new Error('Failed to upload document');

      const result = await response.json();
      if (result.documentId) {
        setSelectedDocId(result.documentId);
        setSelectedDocName(file.name);
        setDocuments(prev => [...prev, { id: result.documentId, name: file.name }]);
        setMessages([{ role: 'system', content: `Successfully uploaded and processed ${file.name}. You can now ask questions about it!` }]);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
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
      const placeholderMessage: Message = { role: 'assistant', content: '', sources: [] };
      setMessages(prev => [...prev, placeholderMessage]);

      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: input,
          documentId: selectedDocId,
          documentName: selectedDocName,
          sessionId: sessionId.current,
          conversationId: activeConversationId,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start chat stream');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let currentSources: Source[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6);
          if (dataStr.trim() === '') continue;

          try {
            const data = JSON.parse(dataStr);
            if (data.type === 'token') {
              fullContent += data.content;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: fullContent, sources: currentSources };
                return updated;
              });
            } else if (data.type === 'sources') {
              currentSources = data.sources;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: fullContent, sources: currentSources };
                return updated;
              });
            } else if (data.type === 'done') {
              // Stream complete — refresh conversations list
              fetchConversations();
            }
          } catch (parseError) {
            // Ignore malformed SSE lines
          }
        }
      }

    } catch (error) {
      console.error('Error:', error);
      setError(error instanceof Error ? error.message : 'An error occurred.');
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error}` }]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Demo Banner */}
      {showDemoBanner && (
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-3 shadow-lg flex-shrink-0">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xl">👋</span>
              <div>
                <p className="font-semibold text-sm">Welcome to RAGchat Demo</p>
                <p className="text-xs text-blue-100">Documents are saved per browser session. Clearing cookies or switching devices will reset your data.</p>
              </div>
            </div>
            <button
              onClick={dismissDemoBanner}
              className="ml-4 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-md text-sm font-medium transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={`${showSidebar ? 'w-64' : 'w-0'} transition-all duration-300 overflow-hidden bg-white border-r flex flex-col`}>
        <div className="p-4 border-b">
          <button
            onClick={startNewChat}
            className="flex items-center gap-2 w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => loadConversation(conv.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors ${
                activeConversationId === conv.id
                  ? 'bg-blue-50 text-blue-700'
                  : 'hover:bg-gray-100 text-gray-700'
              }`}
            >
              <div className="font-medium truncate">{conv.documentName || 'Untitled'}</div>
              <div className="text-xs text-gray-400">{new Date(conv.createdAt).toLocaleDateString()}</div>
            </button>
          ))}
          {conversations.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No conversations yet</p>
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-6 py-4 bg-white border-b shadow-sm">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Toggle conversation history"
            >
              {showSidebar ? <ChevronRight className="w-5 h-5" /> : <History className="w-5 h-5" />}
            </button>
            <h1 className="text-xl font-semibold text-gray-800">RAG Chat System</h1>
          </div>
          <div className="flex items-center gap-3">
            {activeConversationId && (
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                Conversation active
              </span>
            )}
            <FileUpload onUpload={handleFileUpload} isUploading={isUploading} />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((message, index) => (
            <ChatMessage key={index} message={message} />
          ))}
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
                  setSelectedDocId(e.target.value || null);
                  setSelectedDocName(selectedDoc ? selectedDoc.name : null);
                }}
                className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Select a document</option>
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>{doc.name}</option>
                ))}
              </select>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isProcessing ? "Generating response..." : "Type your message..."}
                className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                disabled={isProcessing}
              />
              <button
                type="submit"
                disabled={isProcessing || !input.trim() || !selectedDocId}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </form>
        </footer>
      </div>
    </div>
  </div>
);
}

export default App;
