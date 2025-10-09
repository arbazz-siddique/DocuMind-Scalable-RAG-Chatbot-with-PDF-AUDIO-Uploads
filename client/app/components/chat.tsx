
'use client'
import { Send, User, Bot, Loader2 } from 'lucide-react'
import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'

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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  React.useEffect(scrollToBottom, [messages])

  React.useEffect(() => {
    inputRef.current?.focus()  // Auto-focus input
  }, [])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = { role: 'user', content: input }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch(`http://localhost:8000/chat?message=${encodeURIComponent(input)}`)  // Fixed: Use 'q' param, no extra }
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
        className="bg-white/10 backdrop-blur-md border-b border-white/20 p-4 flex items-center space-x-3"
      >
        <Bot className="h-6 w-6 text-purple-300" />
        <h1 className="text-xl font-bold tracking-wide">PDF RAG Chatbot</h1>
      </motion.header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 h-[60vh] sm:h-auto">
        <AnimatePresence>
          {messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center text-gray-300 flex flex-col items-center justify-center h-full"
            >
              <Bot className="h-16 w-16 mb-4 opacity-50" />
              <h2 className="text-lg font-semibold mb-2">Hello! Upload a PDF to start chatting.</h2>
              <p className="text-sm">Ask anything about your document.</p>
            </motion.div>
          )}
          {messages.map((msg, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: msg.role === 'user' ? 50 : -50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-xs md:max-w-md lg:max-w-lg p-4 rounded-2xl shadow-lg ${
                msg.role === 'user'
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-600 rounded-br-sm'
                  : 'bg-white/10 backdrop-blur-md rounded-bl-sm border border-white/20'
              }`}>
                <div className="flex items-start space-x-2 mb-2">
                  {msg.role === 'bot' && <Bot className="h-5 w-5 text-purple-300 flex-shrink-0 mt-0.5" />}
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
                {msg.role === 'user' && <User className="h-5 w-5 text-white/70 absolute -top-2 -right-2" />}
              </div>
            </motion.div>
          ))}
          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="bg-white/10 p-4 rounded-2xl rounded-bl-sm border border-white/20">
                <div className="flex items-center space-x-2">
                  <Loader2 className="h-5 w-5 text-purple-300 animate-spin" />
                  <p className="text-sm text-purple-300">Thinking...</p>
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
  className="bg-white/10 backdrop-blur-md border-t border-white/20 p-3 sm:p-4"
      >
        <div className="flex space-x-2 sm:space-x-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask about your PDF..."
            className="flex-1 bg-white/10 border border-white/20 rounded-full px-3 py-2 sm:px-4 sm:py-3 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            disabled={isLoading}
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white p-3 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center"
          >
            <Send className="h-5 w-5" />
          </motion.button>
        </div>
      </motion.footer>
    </motion.div>
  )
}

export default ChatComponent