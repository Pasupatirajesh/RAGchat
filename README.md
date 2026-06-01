A simple RAG-based chat application that allows users to upload documents, summarize content, and ask questions based on their files. The front end is built using React, while the backend leverages Retrieval-Augmented Generation (RAG) to provide accurate, context-aware answers.

User-uploaded documents are converted into vector embeddings using OpenAI's text embedding models. These embeddings are then stored in a Pinecone vector database, ensuring efficient retrieval of relevant information. By grounding responses in real data, the system minimizes hallucinations and improves reliability. The chat agent, powered by OpenAI's GPT-3.5 Turbo, retrieves and generates responses dynamically, enabling precise and fact-based answers.

The application is continuously deployed using Netlify, providing seamless updates and ensuring the latest version is always live. With automatic build and deploy pipelines, every change made to the codebase is automatically reflected in the production environment, making the deployment process fast and efficient.

The site lives here : https://glowing-bavarois-afec96.netlify.app/

**Application Architecture Diagram**

### **Frontend (Vite + React)**
- UI built with **React** and **Tailwind CSS**
- Communicates with backend via API routes

### **Backend (Netlify Functions - Lambda)**
- Handles API calls and application logic
- File processing:
  - **Multer** (File uploads)
  - **Mammoth** (DOCX parsing)
  - **pdf-parse** (PDF text extraction)
- Uses **OpenAI API** for:
  - Embeddings
  - GPT-3.5 Turbo / GPT-4o processing

### **Vector Database (Pinecone via LangChain)**
- Stores and retrieves vector embeddings for AI processing
- Enhances search and retrieval functions

### **Storage**
- Documents aren't stored just parsed into pinecone vectorstores

### **API & Integrations**
- **LangChain** for AI-powered text processing and retrieval
- **OpenAI API** for embedding generation and text-based AI responses

---

This structure ensures a scalable, serverless, and efficient document processing pipeline with AI-powered capabilities.




<img width="1235" alt="Screenshot 2025-02-21 at 5 37 54 PM" src="https://github.com/user-attachments/assets/fc49f0ad-ef10-4f72-9767-88af96a99d88" />
