
import FileUploadComponent from "./components/file-upload";
import ChatComponent from "./components/chat";
import AudioUploadComponent from "./components/AudioUploadComponent";

export default function Home() {
  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-gradient-to-br from-slate-900 via-purple-900 to-indigo-900">
      {/* 🧾 Left Section (File Uploads) */}
      <div className="w-full lg:w-[40vw] xl:w-[35vw] p-4 lg:p-6 flex flex-col gap-4 lg:gap-6 min-h-[50vh] lg:min-h-screen">
        <div className="flex flex-col sm:flex-row lg:flex-col gap-4 lg:gap-6">
          <FileUploadComponent />
          <AudioUploadComponent />
        </div>
        
        {/* Upload Status Info */}
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4 lg:p-6 mt-4">
          <h3 className="text-white font-semibold text-sm lg:text-base mb-2">📋 Upload Status</h3>
          <div className="text-white/60 text-xs lg:text-sm space-y-1">
            <p>• PDF files are processed for text extraction</p>
            <p>• Audio files are transcribed automatically</p>
            <p>• Chat with both uploaded content types</p>
          </div>
        </div>
      </div>

      {/* 💬 Right Section (Chat) */}
      <div className="w-full lg:w-[60vw] xl:w-[65vw] min-h-[50vh] lg:min-h-screen">
        <ChatComponent />
      </div>
    </div>
  );
}