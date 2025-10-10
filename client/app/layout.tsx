import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from '@clerk/nextjs'
import { Toaster } from 'sonner'

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Document Assistant",
  description: "Chat with your PDFs and audio files using AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gradient-to-br from-slate-900 via-purple-900 to-indigo-900 min-h-screen`}
        >
          {/* Enhanced Header */}
          <header className="bg-white/10 backdrop-blur-lg border-b border-white/20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                {/* Logo/Brand */}
                <div className="flex items-center">
                  <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-2 rounded-2xl mr-3">
                    <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <span className="text-white font-bold text-xl bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    DocAI
                  </span>
                </div>

                {/* Auth Buttons */}
                <div className="flex items-center gap-3">
                  <SignedOut>
                    <SignInButton>
                      <button className="text-white/80 hover:text-white font-medium text-sm sm:text-base px-4 py-2 rounded-full hover:bg-white/10 transition-all duration-200 cursor-pointer">
                        Sign In
                      </button>
                    </SignInButton>
                    <SignUpButton>
                      <button className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-6 rounded-full cursor-pointer transition-all duration-200 shadow-lg shadow-purple-500/25">
                        Get Started
                      </button>
                    </SignUpButton>
                  </SignedOut>
                  <SignedIn>
                    <div className="flex items-center gap-4">
                      <span className="text-white/70 text-sm hidden sm:block">
                        Welcome back!
                      </span>
                      <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-full p-1">
                        <UserButton 
                          appearance={{
                            elements: {
                              userButtonAvatarBox: "w-8 h-8 sm:w-9 sm:h-9",
                            }
                          }}
                        />
                      </div>
                    </div>
                  </SignedIn>
                </div>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1">
            {children}
          </main>

          {/* Footer */}
          <footer className="bg-white/5 backdrop-blur-lg border-t border-white/20 mt-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-2 rounded-xl">
                    <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <span className="text-white font-semibold text-sm">
                    AI Document Assistant
                  </span>
                </div>
                <div className="text-white/60 text-xs sm:text-sm">
                  © 2024 DocAI. All rights reserved.
                </div>
              </div>
            </div>
          </footer>

          {/* Toast Component */}
          <Toaster 
            position="top-center"
            theme="dark"
            toastOptions={{
              style: {
                background: 'rgba(30, 41, 59, 0.8)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'white',
              },
              className: 'bg-slate-800/80 backdrop-blur-md border border-white/10',
            }}
          />
        </body>
      </html>
    </ClerkProvider>
  );
}