'use client'
import { Mic, CheckCircle, XCircle, Loader2, AlertCircle, Volume2 } from 'lucide-react'
import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthToast } from '@/hooks/useAuthToast'
import sessionManager from '@/utils/session';

interface AudioFileStatus {
  filename: string
  status: 'processing' | 'ready' | 'failed'
  transcript?: string
  uploadedAt: number
  updatedAt: number
}

interface StatusResponse {
  sessionId: string
  files: AudioFileStatus[]
}

const AudioUploadComponent: React.FC = () => {
  const [uploadedAudio, setUploadedAudio] = React.useState<File | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [isUploaded, setIsUploaded] = React.useState(false)
  const [isProcessing, setIsProcessing] = React.useState(false)
  const [isFailed, setIsFailed] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [errorMessage, setErrorMessage] = React.useState<string>('')
  const { showAuthToast, isSignedIn } = useAuthToast()

  // Get or create session ID
  const sessionId = sessionManager.getSessionId();

  // Poll backend for transcription status
  async function waitUntilProcessed(filename: string) {
    return new Promise<void>((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          console.log('🔄 Polling audio status for session:', sessionId);
          console.log('🔍 Looking for filename:', filename);
          
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_SERVER_URL}/audio/status?sessionId=${encodeURIComponent(sessionId)}`
          );
          
          if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
          }
          
          const data: StatusResponse = await res.json();
          const files: AudioFileStatus[] = data.files || [];
          
          console.log('📊 Full status response:', data);
          console.log('📁 All files in session:', files);

          const currentFile = files.find(f => f.filename === filename);

          if (!currentFile) {
            console.log('❌ Audio file not found in status response');
            return;
          }

          console.log('✅ Found file:', currentFile);
          console.log('📋 Current file status:', currentFile.status);

          if (currentFile.status === 'ready') {
            console.log('🎉 Audio processing completed!');
            clearInterval(interval);
            setIsProcessing(false);
            setIsUploaded(true);
            setIsFailed(false);
            resolve();
          } else if (currentFile.status === 'failed') {
            console.log('💥 Audio processing failed');
            clearInterval(interval);
            setIsProcessing(false);
            setIsUploaded(false);
            setIsFailed(true);
            setErrorMessage('Audio processing failed. Please try again with a different file.');
            reject(new Error('Audio processing failed'));
          }
          // Continue polling if status is 'processing'
        } catch (err) {
          console.error('❌ Audio status poll error', err);
          // Don't clear interval on temporary errors
        }
      }, 3000);

      // Timeout after 10 minutes
      setTimeout(() => {
        console.log('⏰ Audio processing timeout');
        clearInterval(interval);
        setIsProcessing(false);
        setIsUploaded(false);
        setIsFailed(true);
        setErrorMessage('Processing timeout. Please try again.');
        reject(new Error('Processing timeout'));
      }, 10 * 60 * 1000);
    });
  }

  const handleFileUploadButtonClick = () => {
    if (!isSignedIn) {
      showAuthToast('upload audio files')
      return
    }
    
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'audio/*';

    el.addEventListener('change', async () => {
      if (el.files && el.files.length > 0) {
        const file = el.files[0];
        
        // Basic file validation
        if (file.size > 50 * 1024 * 1024) {
          alert('File too large. Please select a file smaller than 50MB.');
          return;
        }

        if (!file.type.startsWith('audio/')) {
          alert('Please select an audio file.');
          return;
        }

        console.log('📤 Starting upload for file:', file.name);
        console.log('📝 File details:', {
          name: file.name,
          size: file.size,
          type: file.type
        });

        setIsUploading(true);
        setProgress(0);
        setIsUploaded(false);
        setIsProcessing(false);
        setIsFailed(false);
        setErrorMessage('');
        setUploadedAudio(file);

        try {
          const formData = new FormData();
          formData.append('audio', file);

          // Simulate upload progress
          const progressInterval = setInterval(() => {
            setProgress(prev => {
              if (prev >= 90) {
                clearInterval(progressInterval);
                return 90;
              }
              return prev + 10;
            });
          }, 200);

          const res = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/upload/audio`, {
            method: 'POST',
            body: formData,
            headers: {
              'x-session-id': sessionId
            }
          });

          clearInterval(progressInterval);
          setProgress(100);

          if (res.ok) {
            const result = await res.json();
            console.log('✅ Upload successful, server response:', result);
            
            setIsUploading(false);
            setIsProcessing(true);
            
            console.log('Audio uploaded, waiting for processing ⏳');
            
            await waitUntilProcessed(file.name);
            
            console.log('Audio processed successfully ✅');
          } else {
            const errorText = await res.text();
            console.error('❌ Upload failed with status:', res.status, 'Response:', errorText);
            setIsUploading(false);
            setIsFailed(true);
            setErrorMessage('Upload failed. Please try again.');
          }
        } catch (err) {
          console.error('❌ Error uploading or processing audio:', err);
          setIsUploading(false);
          setIsFailed(true);
          setErrorMessage('Upload or processing failed. Please try again.');
        }
      }
    });

    el.click();
  };

  const handleRemoveAudio = () => {
    setUploadedAudio(null);
    setIsUploaded(false);
    setIsProcessing(false);
    setIsFailed(false);
    setErrorMessage('');
    setProgress(0);
  };

  return (
    <motion.div
      whileHover={{ scale: !isUploaded && !isUploading && !isProcessing && !isFailed ? 1.02 : 1 }}
      whileTap={{ scale: !isUploaded && !isUploading && !isProcessing && !isFailed ? 0.98 : 1 }}
      className={`relative bg-gradient-to-br from-green-600 via-blue-600 to-purple-600 text-white shadow-2xl shadow-blue-500/20 
        flex justify-center items-center p-6 rounded-3xl border-2 border-white/20 transition-all duration-300 
        backdrop-blur-sm hover:shadow-blue-500/30 ${
          isUploaded || isUploading || isProcessing || isFailed ? 'cursor-default' : 'cursor-pointer hover:bg-gradient-to-br hover:from-green-700 hover:via-blue-700 hover:to-purple-700'
        }`}
      onClick={!isUploaded && !isUploading && !isProcessing && !isFailed ? handleFileUploadButtonClick : undefined}
    >
      {/* Idle State */}
      {!isUploaded && !isUploading && !isProcessing && !isFailed && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col justify-center items-center space-y-4 text-center w-full"
        >
          <div className="bg-white/20 p-4 rounded-2xl backdrop-blur-sm">
            <Mic className="h-8 w-8 sm:h-10 sm:w-10 text-white" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg sm:text-xl font-bold tracking-wide">Upload Audio</h3>
            <p className="text-white/70 text-sm sm:text-base max-w-xs">
              Click to select audio file
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Volume2 className="h-3 w-3" />
            <span>MP3, WAV, etc. • Max 50MB</span>
          </div>
        </motion.div>
      )}

      {/* Uploading State */}
      {isUploading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center text-white/90 space-y-4 w-full max-w-xs"
        >
          <div className="space-y-2">
            <div className="bg-white/20 rounded-full h-3 w-full overflow-hidden backdrop-blur-sm">
              <motion.div
                className="bg-gradient-to-r from-green-400 to-blue-400 rounded-full h-3"
                initial={{ width: '0%' }}
                animate={{ width: `${progress}%` }}
                transition={{ ease: 'easeOut', duration: 0.2 }}
              />
            </div>
            <p className="text-sm font-medium">{progress}% uploaded</p>
          </div>
          <p className="text-xs text-white/60">Uploading your audio file...</p>
        </motion.div>
      )}

      {/* Processing State */}
      {isProcessing && !isUploaded && !isFailed && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col justify-center items-center space-y-4 text-center w-full"
        >
          <Loader2 className="h-12 w-12 animate-spin text-white" />
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Transcribing Audio</h3>
            <p className="text-white/70 text-sm">Converting speech to text...</p>
          </div>
          <div className="w-24 h-1 bg-white/20 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-white rounded-full"
              animate={{ x: [-50, 50] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
            />
          </div>
        </motion.div>
      )}

      {/* Uploaded Successfully */}
      <AnimatePresence>
        {isUploaded && uploadedAudio && (
          <motion.div
            key="uploaded"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col justify-center items-center space-y-4 text-center w-full"
          >
            <div className="relative">
              <CheckCircle className="h-12 w-12 text-green-400" />
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full animate-ping"></div>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold truncate max-w-[200px] sm:max-w-[250px]">
                {uploadedAudio.name}
              </h3>
              <p className="text-white/70 text-sm">Transcribed successfully</p>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleRemoveAudio}
              className="mt-2 bg-white/20 hover:bg-white/30 text-sm px-4 py-2 rounded-full flex items-center gap-2 transition-all duration-200 backdrop-blur-sm"
            >
              <XCircle className="h-4 w-4" /> Upload New
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Failed State */}
      <AnimatePresence>
        {isFailed && uploadedAudio && (
          <motion.div
            key="failed"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col justify-center items-center space-y-4 text-center w-full"
          >
            <AlertCircle className="h-12 w-12 text-red-400" />
            <div className="space-y-2">
              <h3 className="text-lg font-semibold truncate max-w-[200px] sm:max-w-[250px]">
                {uploadedAudio.name}
              </h3>
              <p className="text-white/70 text-sm">Processing failed</p>
              {errorMessage && (
                <p className="text-xs text-white/50 mt-1 max-w-xs">{errorMessage}</p>
              )}
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleRemoveAudio}
              className="mt-2 bg-white/20 hover:bg-white/30 text-sm px-4 py-2 rounded-full flex items-center gap-2 transition-all duration-200 backdrop-blur-sm"
            >
              <XCircle className="h-4 w-4" /> Try Again
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default AudioUploadComponent;