'use client'
import { Upload, CheckCircle, XCircle, Loader2, FileText } from 'lucide-react'
import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthToast } from '@/hooks/useAuthToast'

interface PdfFileStatus {
  filename: string
  status: 'processing' | 'ready' | 'failed'
  // Remove path since we're using filename now
}

const FileUploadComponent: React.FC = () => {
  const [uploadedFile, setUploadedFile] = React.useState<File | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [isUploaded, setIsUploaded] = React.useState(false)
  const [isProcessing, setIsProcessing] = React.useState(false)
  const { showAuthToast, isSignedIn } = useAuthToast()
  
  // Get or create session ID
  const getSessionId = () => {
    if (typeof window === 'undefined') return 'default';
    
    let sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      localStorage.setItem('sessionId', sessionId);
    }
    return sessionId;
  };

  const sessionId = getSessionId();

  // Poll backend for PDF processing status - UPDATED
  async function waitUntilProcessed() {
    return new Promise<void>((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_SERVER_URL}/pdf/status?sessionId=${encodeURIComponent(sessionId)}`
          );
          
          if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
          }
          
          const data = await res.json();
          const files: PdfFileStatus[] = data.files || [];
          
          // FIXED: Use filename only for matching
          const currentFile = files.find(f => f.filename === uploadedFile?.name);

          if (!currentFile) {
            console.log('PDF file not found in status response');
            return;
          }

          if (currentFile.status === 'ready') {
            clearInterval(interval);
            setIsProcessing(false);
            setIsUploaded(true);
            resolve();
          } else if (currentFile.status === 'failed') {
            clearInterval(interval);
            setIsProcessing(false);
            setIsUploaded(false);
            reject(new Error('PDF processing failed'));
          }
          // Continue polling if still processing
        } catch (err) {
          console.error('PDF status poll error', err);
          clearInterval(interval);
          setIsProcessing(false);
          setIsUploaded(false);
          reject(err);
        }
      }, 2000); // Check every 2 seconds

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(interval);
        setIsProcessing(false);
        setIsUploaded(false);
        reject(new Error('PDF processing timeout'));
      }, 5 * 60 * 1000);
    });
  }

  const handleFileUploadButtonClick = () => {
    if (!isSignedIn) {
      showAuthToast('upload PDF files')
      return
    }
    const el = document.createElement('input')
    el.setAttribute('type', 'file')
    el.setAttribute('accept', 'application/pdf')

    el.addEventListener('change', async () => {
      if (el.files && el.files.length > 0) {
        const file = el.files.item(0)
        if (file) {
          setIsUploading(true)
          setIsUploaded(false)
          setIsProcessing(false)
          const formData = new FormData()
          formData.append('pdf', file)

          try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/upload/pdf`, {
              method: 'POST',
              body: formData,
              headers: {
                'x-session-id': sessionId
              }
            })

            if (res.ok) {
              setUploadedFile(file)
              setIsUploading(false)
              setIsProcessing(true)
              
              console.log('PDF uploaded, waiting for processing ⏳')
              await waitUntilProcessed()
              
              console.log('PDF processed successfully ✅')
            } else {
              console.error('Upload failed ❌')
              setIsUploading(false)
            }
          } catch (err) {
            console.error('Error uploading file:', err)
            setIsUploading(false)
          }
        }
      }
    })

    el.click()
  }

  const handleRemoveFile = () => {
    setUploadedFile(null)
    setIsUploaded(false)
    setIsProcessing(false)
  }

  return (
    <motion.div
      whileHover={{ scale: !isUploaded && !isUploading && !isProcessing ? 1.02 : 1 }}
      whileTap={{ scale: !isUploaded && !isUploading && !isProcessing ? 0.98 : 1 }}
      className={`relative bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white shadow-2xl shadow-purple-500/20 
        flex justify-center items-center p-6 rounded-3xl border-2 border-white/20 transition-all duration-300 
        backdrop-blur-sm hover:shadow-purple-500/30 ${
        isUploaded || isUploading || isProcessing ? 'cursor-default' : 'cursor-pointer hover:bg-gradient-to-br hover:from-indigo-700 hover:via-purple-700 hover:to-pink-600'
      }`}
      onClick={!isUploaded && !isUploading && !isProcessing ? handleFileUploadButtonClick : undefined}
    >
      {/* File Upload Idle State */}
      {!isUploaded && !isUploading && !isProcessing && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col justify-center items-center space-y-4 text-center w-full"
        >
          <div className="bg-white/20 p-4 rounded-2xl backdrop-blur-sm">
            <Upload className="h-8 w-8 sm:h-10 sm:w-10 text-white" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg sm:text-xl font-bold tracking-wide">Upload PDF</h3>
            <p className="text-white/70 text-sm sm:text-base max-w-xs">
              Click to select a PDF document
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/50">
            <FileText className="h-3 w-3" />
            <span>PDF files only</span>
          </div>
        </motion.div>
      )}

      {/* Uploading State */}
      {isUploading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center text-white/90 space-y-4 w-full"
        >
          <div className="relative">
            <div className="animate-spin border-4 border-white/30 border-t-white rounded-full h-12 w-12 mx-auto"></div>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Uploading PDF...</p>
            <p className="text-xs text-white/60">Please wait</p>
          </div>
        </motion.div>
      )}

      {/* Processing State */}
      {isProcessing && !isUploaded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col justify-center items-center space-y-4 text-center w-full"
        >
          <Loader2 className="h-12 w-12 animate-spin text-white" />
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Processing PDF</h3>
            <p className="text-white/70 text-sm">Extracting text content...</p>
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

      {/* Uploaded State */}
      <AnimatePresence>
        {isUploaded && uploadedFile && (
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
                {uploadedFile.name}
              </h3>
              <p className="text-white/70 text-sm">Ready for chatting</p>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleRemoveFile}
              className="mt-2 bg-white/20 hover:bg-white/30 text-sm px-4 py-2 rounded-full flex items-center gap-2 transition-all duration-200 backdrop-blur-sm"
            >
              <XCircle className="h-4 w-4" /> Upload New
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default FileUploadComponent