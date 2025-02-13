import React, { useCallback } from 'react';
import { Upload, Loader2 } from 'lucide-react';

interface FileUploadProps {
  onUpload: (file: File) => Promise<void>;
  isUploading: boolean;
}

export function FileUpload({ onUpload, isUploading }: FileUploadProps) {
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await onUpload(file);
      e.target.value = ''; // Reset input
    }
  }, [onUpload]);

  return (
    <label className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 cursor-pointer">
      {isUploading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Upload className="w-4 h-4" />
      )}
      {isUploading ? 'Uploading...' : 'Upload Documents'}
      <input
        type="file"
        className="hidden"
        accept=".txt,.md,.pdf"
        onChange={handleFileChange}
        disabled={isUploading}
      />
    </label>
  );
}