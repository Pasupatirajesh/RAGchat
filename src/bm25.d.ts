declare module 'bm25' {
    export class BM25 {
      constructor();
      addDocument(doc: string): void;
      search(query: string, documents: string[]): { score: number }[];
    }
  }