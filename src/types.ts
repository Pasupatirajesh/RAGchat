export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Document {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, any>;
}