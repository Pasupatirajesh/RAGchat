import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Message } from '../types';
import { Bot, User, ChevronDown, ChevronUp } from 'lucide-react';

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isStreaming = message.role === 'assistant' && message.content === '';
  const [showSources, setShowSources] = useState(false);

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
        isUser ? 'bg-blue-500' : 'bg-gray-600'
      }`}>
        {isUser ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
      </div>
      <div className={`flex-1 px-4 py-2 rounded-lg ${
        isUser ? 'bg-blue-500 text-white' : 'bg-gray-100'
      }`}>
        {isStreaming ? (
          <div className="flex items-center gap-1 text-gray-500">
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : (
          <div>
            <ReactMarkdown className="prose max-w-none">
              {message.content}
            </ReactMarkdown>

            {/* Sources Panel */}
            {!isUser && message.sources && message.sources.length > 0 && (
              <div className="mt-3 border-t border-gray-200 pt-2"
              >
                <button
                  onClick={() => setShowSources(!showSources)}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
                >
                  {showSources ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showSources ? 'Hide sources' : `Show sources (${message.sources.length})`}
                </button>

                {showSources && (
                  <div className="mt-2 space-y-2">
                    {message.sources.map((source, idx) => {
                      const isWeb = source.metadata?.source === 'web';
                      return (
                        <div key={idx} className="text-xs bg-gray-50 border border-gray-200 rounded p-2"
                        >
                          <div className="font-medium text-gray-600 mb-1 flex items-center gap-1"
                          >
                            {isWeb ? (
                              <>
                                <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Web</span>
                                <a href={source.metadata?.url} target="_blank" rel="noopener noreferrer" className="hover:underline truncate max-w-[200px]">
                                  {source.metadata?.title || 'Web result'}
                                </a>
                              </>
                            ) : (
                              <>
                                Chunk {source.metadata?.chunkIndex ?? idx + 1} — {source.metadata?.filename || 'Document'}
                              </>
                            )}
                          </div>
                          <div className="text-gray-700 line-clamp-3"
                          >
                            {source.pageContent}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
