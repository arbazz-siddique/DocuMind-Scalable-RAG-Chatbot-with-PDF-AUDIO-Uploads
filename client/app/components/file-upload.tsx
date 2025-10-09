'use client'
import { Upload } from 'lucide-react'
import * as React from 'react'
import { motion } from 'framer-motion'

const FileUploadComponent: React.FC = () => {
    const handleFileUploadButtonClick = ()=>{
        const el = document.createElement('input')
        el.setAttribute('type', 'file')
        el.setAttribute('accept', 'application/pdf')
        el.addEventListener('change', async (ev)=>{
            if(el.files && el.files.length > 0){
                const file = el.files.item(0)
                if(file){
                  const formData = new FormData()
                formData.append('pdf', file)
                await fetch('http://localhost:8000/upload/pdf', {
                  method:'POST',
                  body: formData
                })
                console.log("file uploaded")
                }
            }
        })
        el.click()
    }
  return (
    <motion.div
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.98 }}
      className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 text-white shadow-2xl flex justify-center items-center p-8 rounded-2xl border-2 border-white/20 cursor-pointer transition-all duration-300"
    >
      <div onClick={handleFileUploadButtonClick} className="flex justify-center items-center flex-col space-y-3">
        <div className="bg-white/20 p-4 rounded-full">
          <Upload className="h-10 w-10 text-white" />
        </div>
        <h3 className="text-xl font-semibold tracking-wide">Upload PDF File</h3>
        <p className="text-sm text-white/70 text-center max-w-xs">
          Drag & drop your PDF here, or click to select a file
        </p>
      </div>
    </motion.div>
  )
}

export default FileUploadComponent
