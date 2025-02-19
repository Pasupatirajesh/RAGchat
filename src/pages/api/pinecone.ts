import { Pinecone } from "@pinecone-database/pinecone";
import { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });

    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX!);

    res.status(200).json({ message: "Pinecone connected!", index: pineconeIndex.name });
  } catch (error) {
    console.error("Pinecone connection error:", error);
    res.status(500).json({ error: "Failed to connect to Pinecone" });
  }
}

