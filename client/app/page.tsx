import FileUploadComponent from "./components/file-upload";
import ChatComponent from "./components/chat";

export default function Home() {
  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-black">
      {/* 🧾 Left Section (File Upload) */}
      <div className="w-full lg:w-[35vw] p-4 flex justify-center items-center min-h-[40vh] lg:min-h-screen">
        <FileUploadComponent />
      </div>

      {/* 💬 Right Section (Chat) */}
      <div className="w-full lg:w-[65vw] min-h-[60vh] lg:min-h-screen">
        <ChatComponent />
      </div>
    </div>
  );
}
