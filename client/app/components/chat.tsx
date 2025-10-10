'use client'
import { Send, User, Bot, Loader2, Paperclip, Mic } from 'lucide-react'
import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthToast } from '@/hooks/useAuthToast'

interface Message {
  role: 'user' | 'bot'
  content: string
}

const ChatComponent: React.FC = () => {
  const [messages, setMessages] = React.useState<Message[]>([])
  const [input, setInput] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const { showAuthToast, isSignedIn } = useAuthToast()

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  React.useEffect(scrollToBottom, [messages])

  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return
  if (!isSignedIn) {
      showAuthToast('chat with documents')
      return
    }
     const userMessage: Message = { role: 'user', content: input }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try  {
      const sessionId = localStorage.getItem('sessionId') || 'default';
      const response = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/chat?message=${encodeURIComponent(input)}`, {
        method: 'GET',
        headers: {
          'x-session-id': sessionId
        }
      })
      const data = await response.json()
      const botMessage: Message = { role: 'bot', content: data.message || 'Sorry, I could not generate a response.' }
      setMessages(prev => [...prev, botMessage])
    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage: Message = { role: 'bot', content: 'Sorry, something went wrong. Please try again.' }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-indigo-900 text-white"
    >
      {/* Header */}
      <motion.header
        initial={{ y: -50 }}
        animate={{ y: 0 }}
        className="bg-white/10 backdrop-blur-lg border-b border-white/20 p-4 sm:p-6 flex items-center justify-between"
      >
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-2 rounded-2xl">
            <Bot className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wide">AI Assistant</h1>
            <p className="text-white/60 text-sm">Ask about your uploaded files</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-white/40">
          <Paperclip className="h-4 w-4" />
          <Mic className="h-4 w-4" />
        </div>
      </motion.header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 space-y-4 h-[60vh] sm:h-auto">
        <AnimatePresence>
          {messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center text-gray-300 flex flex-col items-center justify-center h-full min-h-[400px] space-y-6"
            >
              <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-6 rounded-3xl">
                <Bot className="h-16 w-16 text-white" />
              </div>
              <div className="space-y-2 max-w-md">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  Hello! I'm your AI Assistant
                </h2>
                <p className="text-gray-400 text-sm sm:text-base">
                  Upload PDFs or audio files, then ask me anything about their content
                </p>
              </div>
              <div className="flex gap-4 text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  <Paperclip className="h-3 w-3" />
                  <span>PDF Support</span>
                </div>
                <div className="flex items-center gap-1">
                  <Mic className="h-3 w-3" />
                  <span>Audio Transcription</span>
                </div>
              </div>
            </motion.div>
          )}
          {messages.map((msg, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: msg.role === 'user' ? 50 : -50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-xs xs:max-w-sm sm:max-w-md md:max-w-2xl p-4 rounded-3xl shadow-lg backdrop-blur-sm ${
                msg.role === 'user'
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-600 rounded-br-md'
                  : 'bg-white/10 border border-white/20 rounded-bl-md'
              }`}>
                <div className="flex items-start space-x-3">
                  {msg.role === 'bot' && (
                    <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-1 rounded-full flex-shrink-0 mt-0.5">
                      <Bot className="h-4 w-4 text-white" />
                    </div>
                  )}
                  <p className="text-sm sm:text-base leading-relaxed whitespace-pre-wrap flex-1">
                    {msg.content}
                  </p>
                  {msg.role === 'user' && (
                    <div className="bg-white/20 p-1 rounded-full flex-shrink-0">
                      <User className="h-4 w-4 text-white" />
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="bg-white/10 backdrop-blur-sm border border-white/20 p-4 rounded-3xl rounded-bl-md max-w-xs xs:max-w-sm sm:max-w-md">
                <div className="flex items-center space-x-3">
                  <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-1 rounded-full">
                    <Loader2 className="h-4 w-4 text-white animate-spin" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-purple-300 font-medium">Thinking...</p>
                    <div className="flex space-x-1">
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ repeat: Infinity, duration: 1, delay: 0 }}
                        className="w-1 h-1 bg-purple-400 rounded-full"
                      />
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                        className="w-1 h-1 bg-purple-400 rounded-full"
                      />
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                        className="w-1 h-1 bg-purple-400 rounded-full"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <motion.footer
        initial={{ y: 50 }}
        animate={{ y: 0 }}
        className="bg-white/10 backdrop-blur-lg border-t border-white/20 p-4 sm:p-6"
      >
        <div className="flex space-x-3 max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask about your documents..."
              className="w-full bg-white/10 border border-white/20 rounded-2xl px-4 sm:px-6 py-3 sm:py-4 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent backdrop-blur-sm text-sm sm:text-base"
              disabled={isLoading}
            />
          </div>
          <motion.button
            whileHover={{ scale: input.trim() && !isLoading ? 1.05 : 1 }}
            whileTap={{ scale: input.trim() && !isLoading ? 0.95 : 1 }}
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white p-3 sm:p-4 rounded-2xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center shadow-lg shadow-purple-500/25"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </motion.button>
        </div>
        <div className="text-center mt-3">
          <p className="text-white/40 text-xs">
            Press Enter to send • Shift + Enter for new line
          </p>
        </div>
      </motion.footer>
    </motion.div>
  )
}

export default ChatComponent