export class BM25 {
    private k1: number;
    private b: number;
    private documents: string[];
    private idfCache: Map<string, number>;
  
    constructor(k1 = 1.5, b = 0.75) {
      this.k1 = k1;
      this.b = b;
      this.documents = [];
      this.idfCache = new Map();
    }
  
    addDocument(doc: string) {
      this.documents.push(doc);
    }
  
    private termFrequency(term: string, doc: string): number {
      const words = doc.split(/\s+/);
      const termCount = words.filter(word => word === term).length;
      return termCount / words.length;
    }
  
    private inverseDocumentFrequency(term: string): number {
      if (this.idfCache.has(term)) {
        return this.idfCache.get(term)!;
      }
  
      const docCount = this.documents.length;
      const containingDocs = this.documents.filter(doc => doc.includes(term)).length;
      const idf = Math.log((docCount - containingDocs + 0.5) / (containingDocs + 0.5) + 1);
      this.idfCache.set(term, idf);
      return idf;
    }
  
    private score(query: string, doc: string): number {
      const terms = query.split(/\s+/);
      const docLength = doc.split(/\s+/).length;
      const avgDocLength = this.documents.reduce((sum, doc) => sum + doc.split(/\s+/).length, 0) / this.documents.length;
  
      return terms.reduce((score, term) => {
        const tf = this.termFrequency(term, doc);
        const idf = this.inverseDocumentFrequency(term);
        return score + idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (docLength / avgDocLength))));
      }, 0);
    }
  
    search(query: string): { doc: string, score: number }[] {
      return this.documents.map(doc => ({
        doc,
        score: this.score(query, doc)
      })).sort((a, b) => b.score - a.score);
    }
  }