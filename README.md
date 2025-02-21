A simple RAG-based chat application that allows users to upload documents, summarize content, and ask questions based on their files. The front end is built using React, while the backend leverages Retrieval-Augmented Generation (RAG) to provide accurate, context-aware answers.

User-uploaded documents are converted into vector embeddings using OpenAI's text embedding models. These embeddings are then stored in a Pinecone vector database, ensuring efficient retrieval of relevant information. By grounding responses in real data, the system minimizes hallucinations and improves reliability. The chat agent, powered by OpenAI's GPT-3.5 Turbo, retrieves and generates responses dynamically, enabling precise and fact-based answers.


<img width="1235" alt="Screenshot 2025-02-21 at 5 37 54 PM" src="https://github.com/user-attachments/assets/fc49f0ad-ef10-4f72-9767-88af96a99d88" />
