A simple RAG based chat application to summarize and ask questions about your files. This application is built with the react framework for the front end.
The Q&A chat application makes use of Retrieval Augumented Generation to answer questions based on user uploaded documents. A vector database is used to store
vectors obtained from user documents. A pinecone database is running in the background to store user documents. This is useful for answering user questions grounded
in reality without letting the chat agent hallucinate. Before the vectors are stored in the database; embeddings are generated using openAI's text embedding models.
The retrievar chat agent is based on open AI's GPT 3.5 turbo to answer user questions. <img width="1235" alt="Screenshot 2025-02-21 at 5 35 04 PM" src="https://github.com/user-attachments/assets/729c3bfe-8ac8-4b64-b1f1-2756deede438" />
