import React, { useState } from 'react';
import { ChromaClient } from 'chroma-js';
import mammoth from 'mammoth';
import { PDFDocument } from 'pdf-lib';

const DocumentUploader = () => {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState('');

  const handleFileChange = (event) => {
    setFile(event.target.files[0]);
  };

  const extractTextFromFile = async (file) => {
    if (file.type === 'application/pdf') {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const text = await pdfDoc.getTextContent();
      return text.items.map(item => item.str).join(' ');
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    } else {
      throw new Error('Unsupported file type');
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setMessage('Please select a file to upload.');
      return;
    }

    try {
      const text = await extractTextFromFile(file);
      const client = new ChromaClient({ apiKey: 'YOUR_CHROMA_API_KEY' });
      const response = await client.uploadDocument({ text });
      if (response.success) {
        setMessage('File uploaded successfully!');
      } else {
        setMessage('Failed to upload file.');
      }
    } catch (error) {
      console.error('Error extracting text:', error);
      setMessage('An error occurred during file upload.');
    }
  };

  return (
    <div>
      <input type="file" onChange={handleFileChange} />
      <button onClick={handleUpload}>Upload</button>
      {message && <p>{message}</p>}
    </div>
  );
};

export default DocumentUploader;