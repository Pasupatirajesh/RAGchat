export interface Source {
  pageContent: string;
  metadata: Record<string, any>;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: Source[];
}

export interface Document {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, any>;
}

