'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import toast from 'react-hot-toast';
import { FileIcon, DownloadIcon, RefreshCw } from 'lucide-react';
import { AnimatedGridPattern } from '@/components/magicui/animated-grid-pattern';
import { LineShadowText } from '@/components/magicui/line-shadow-text';

// Enum for application states
const AppState = {
  UPLOAD: 'upload',
  UPLOADING: 'uploading',
  PROCESSING: 'processing',
  COMPLETE: 'complete',
  DOWNLOAD: 'download',
};

export default function Home() {
  const [appState, setAppState] = useState(AppState.UPLOAD);
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [convertedFileName, setConvertedFileName] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];

    if (!selectedFile) return;

    // Check file type
    if (
      !selectedFile.name.endsWith('.doc') &&
      !selectedFile.name.endsWith('.docx')
    ) {
      toast.error('Invalid file type, please upload a .doc or .docx file', {
        duration: 3000,
      });
      return;
    }

    // Check file size (10MB = 10 * 1024 * 1024 bytes)
    if (selectedFile.size > 10 * 1024 * 1024) {
      toast.error(
        'File size too large, please upload a file smaller than 10MB',
        {
          duration: 3000,
        }
      );
      return;
    }

    setFile(selectedFile);
  };

  const uploadFile = async () => {
    if (!file) return;

    setAppState(AppState.UPLOADING);
    setProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error('Upload failed');
      }

      const uploadData = await uploadResponse.json();

      if (uploadData.error) {
        throw new Error(uploadData.error);
      }

      setProgress(100);
      toast.success('File uploaded successfully', {
        duration: 3000,
      });

      // Move to processing state
      setTimeout(() => {
        setProgress(0);
        setAppState(AppState.PROCESSING);
        startProcessing();
      }, 1000);
    } catch (error) {
      toast.error('Failed to upload file', {
        duration: 3000,
      });
      setAppState(AppState.UPLOAD);
    }
  };

  const startProcessing = () => {
    // Simulate processing progress
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + 5;
      });
    }, 300);

    setTimeout(() => {
      clearInterval(interval);
      setProgress(100);
      setAppState(AppState.COMPLETE);

      // Move to download state after showing complete state
      setTimeout(() => {
        setConvertedFileName(file.name.replace(/\.docx?$/, '.pdf'));
        setAppState(AppState.DOWNLOAD);
      }, 1500);
    }, 6000);
  };

  const handleDownload = async () => {
    setIsDownloading(true);

    try {
      const response = await fetch(`/api/download/${convertedFileName}`);

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = convertedFileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);

      toast.success('File downloaded successfully', {
        duration: 3000,
      });

      toast.success('Your files deleted successfully from the server', {
        duration: 3000,
      });

      // Reset the app state
      setTimeout(() => {
        resetApp();
      }, 1500);
    } catch (error) {
      toast.error('Failed to download file', {
        duration: 3000,
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const resetApp = () => {
    setAppState(AppState.UPLOAD);
    setFile(null);
    setProgress(0);
    setConvertedFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gray-50">
      <AnimatedGridPattern
        numSquares={30}
        maxOpacity={0.1}
        duration={3}
        repeatDelay={1}
      />
      <div>
        <h1 className="text-5xl text-balance font-semibold leading-none tracking-tighter sm:text-6xl md:text-7xl lg:text-8xl z-50 mb-10">
          <LineShadowText className="italic pr-3">Superfast</LineShadowText>
          <LineShadowText className="italic pl-3">DOC to PDF</LineShadowText>
        </h1>
      </div>
      <div className="w-full max-w-md p-6 bg-gray-300 rounded-lg z-30">
        {appState === AppState.UPLOAD && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileIcon className="mx-auto h-12 w-12 text-gray-500" />
              <p className="mt-2 text-sm text-gray-600">
                Click to upload a .doc or .docx file
              </p>
              <p className="text-xs text-gray-800 mt-1">Max file size: 10MB</p>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".doc,.docx"
                onChange={handleFileChange}
              />
            </div>

            {file && (
              <div className="flex items-center justify-between p-2 bg-gray-100 rounded">
                <span className="text-sm truncate max-w-[200px]">
                  {file.name}
                </span>
                <Button onClick={uploadFile}>Upload</Button>
              </div>
            )}
          </div>
        )}

        {appState === AppState.UPLOADING && (
          <div className="space-y-4">
            <p className="text-center">Uploading file...</p>
            <Progress value={progress} className="h-2" />
            <p className="text-right text-sm text-gray-500">{progress}%</p>
          </div>
        )}

        {appState === AppState.PROCESSING && (
          <div className="space-y-4">
            <p className="text-center font-medium">Processing...</p>
            <Progress value={progress} className="h-2" />
            <p className="text-right text-sm text-gray-500">{progress}%</p>
          </div>
        )}

        {appState === AppState.COMPLETE && (
          <div className="space-y-4">
            <p className="text-center font-medium text-green-600">Complete</p>
            <Progress value={100} className="h-2 bg-gray-200" />
            <p className="text-right text-sm text-gray-500">100%</p>
          </div>
        )}

        {appState === AppState.DOWNLOAD && (
          <div className="space-y-4 text-center">
            <p className="font-medium">{convertedFileName}</p>
            <Button
              className="w-full"
              onClick={handleDownload}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  <DownloadIcon className="mr-2 h-4 w-4" />
                  Download
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
