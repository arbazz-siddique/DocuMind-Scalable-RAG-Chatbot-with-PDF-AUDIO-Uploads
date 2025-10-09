'use client'
import { Upload, CheckCircle, XCircle } from 'lucide-react'
import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const FileUploadComponent: React.FC = () => {
  const [uploadedFile, setUploadedFile] = React.useState<File | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [isUploaded, setIsUploaded] = React.useState(false)

  const handleFileUploadButtonClick = () => {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = 'application/pdf'

    el.addEventListener('change', async () => {
      if (el.files && el.files.length > 0) {
        const file = el.files[0]
        if (file) {
          setIsUploading(true)
          const formData = new FormData()
          formData.append('pdf', file)

          try {
            const res = await fetch('http://localhost:8000/upload/pdf', {
              method: 'POST',
              body: formData,
            })

            const data = await res.json()

            if (res.ok && data.message === 'uploaded') {
              setUploadedFile(file)
              setIsUploaded(true)
              console.log('✅ File uploaded successfully:', file.name)
            } else {
              console.error('❌ Upload failed:', data)
            }
          } catch (err) {
            console.error('⚠️ Error uploading file:', err)
          } finally {
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
  }

  return (
    <div className="relative flex justify-center items-center min-h-screen w-full overflow-hidden">
      {/* 🌈 YouTube Video Background */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <iframe
  className="absolute -top-40 left-0 w-full h-full object-cover"
  src="https://www.youtube.com/embed/nGnX6GkrOgk?autoplay=1&mute=1&loop=1&playlist=nGnX6GkrOgk&controls=0&showinfo=0&modestbranding=1"
  allow="autoplay;  fullscreen"
/>
        <div className="absolute inset-0 bg-black/50 backdrop-blur-xs"></div>
      </div>

      {/* 🌟 Upload UI */}
      <motion.div
         whileHover={{ scale: !isUploaded ? 1.02 : 1 }}
  whileTap={{ scale: !isUploaded ? 0.97 : 1 }}
  className={`relative z-10 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 text-white shadow-2xl 
  flex justify-center items-center flex-col p-6 sm:p-8 rounded-2xl border-2 border-white/20 
  transition-all duration-300 max-w-[90vw] sm:max-w-md md:max-w-lg ${
    isUploaded ? 'cursor-default' : 'cursor-pointer'
  }`}
        onClick={!isUploaded ? handleFileUploadButtonClick : undefined}
      >
        {/* Upload Idle State */}
        {!isUploaded && !isUploading && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col justify-center items-center space-y-3 text-center"
          >
            <div className="bg-white/20 p-4 rounded-full">
              <Upload className="h-10 w-10 text-white" />
            </div>
            <h3 className="text-xl font-semibold tracking-wide">Upload PDF File</h3>
            <p className="text-sm text-white/70 max-w-xs">
              Click to select your PDF and upload it
            </p>
          </motion.div>
        )}

        {/* Uploading Loader */}
        {isUploading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center text-white/90 space-y-3"
          >
            <div className="animate-spin border-4 border-white/30 border-t-white rounded-full h-10 w-10 mx-auto"></div>
            <p className="text-sm">Uploading PDF...</p>
          </motion.div>
        )}

        {/* Uploaded Success State */}
        <AnimatePresence>
          {isUploaded && uploadedFile && (
            <motion.div
              key="uploaded"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col justify-center items-center space-y-3 text-center"
            >
              <CheckCircle className="h-12 w-12 text-green-400" />
              <div>
                <h3 className="text-lg font-semibold">{uploadedFile.name}</h3>
                <p className="text-sm text-white/70">Successfully uploaded</p>
              </div>
              <button
                onClick={handleRemoveFile}
                className="mt-2 bg-white/20 hover:bg-white/30 text-sm px-4 py-2 rounded-full flex items-center gap-2 transition"
              >
                <XCircle className="h-4 w-4" /> Remove & Upload Another
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

export default FileUploadComponent
