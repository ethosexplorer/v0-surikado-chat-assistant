"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { MessageCircle, Send, Trash2, FileText } from "lucide-react"

interface Message {
  id: string
  type: "user" | "system" | "api" | "typing"
  content: string
  timestamp: Date
}

interface PollResult {
  status: "waiting" | "empty" | "processing" | "completed" | "none"
  message: string
  elapsedSeconds?: number
  completed: boolean
  success?: boolean
}

export default function SurikadoChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [showParsedJSON, setShowParsedJSON] = useState(false)
  const [parsedResume, setParsedResume] = useState<any>(null)
  const [toPhone, setToPhone] = useState("")
  const [isPolling, setIsPolling] = useState(false)

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hasStartedPollingRef = useRef(false) // New ref to track polling state

  const POLL_INTERVAL = 3000 // Poll every 3 seconds

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [])

  // Normalize WhatsApp number
  const normalizeWhatsApp = (raw: string): string => {
    if (!raw) return ""
    let n = String(raw).trim()
    if (n.toLowerCase().startsWith("whatsapp:")) n = n.slice(9)
    n = n.replace(/[^+\d]/g, "")
    if (!n.startsWith("+")) n = `+${n}`
    return `whatsapp:${n}`
  }

  // Check if message is about soft skills
  const isSoftSkillsQuestion = (message: string): boolean => {
    const text = message.toLowerCase()
    return (
      /soft\s*skills?/.test(text) ||
      /your\s+soft\s+skills?/.test(text) ||
      /list.*soft\s*skills?/.test(text) ||
      /what\s+soft\s+skills\s+do\s+you\s+excel\s+at/.test(text) ||
      (/teamwork/.test(text) && /problem-?solving/.test(text)) ||
      /communication/.test(text) ||
      /leadership/.test(text) ||
      /collaboration/.test(text)
    )
  }

  // Check if we should apply delay for follow-up soft skills messages
  const shouldDelayForSoftSkills = (msgs: Message[], currentMessage: string): boolean => {
    // Check if current message is about soft skills
    if (!isSoftSkillsQuestion(currentMessage)) {
      return false
    }

    // Check if there was a previous soft skills response in the conversation
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg.type === "api" && isSoftSkillsQuestion(msg.content)) {
        return true // This is a follow-up to a previous soft skills response
      }
    }
    
    return false
  }

  // Stop polling
  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    setIsPolling(false)
    setIsLoading(false)
    hasStartedPollingRef.current = false // Reset the flag
  }

  // Poll for response from server
  const pollForResponse = async () => {
    // Prevent multiple simultaneous polling calls
    if (!hasStartedPollingRef.current) {
      return
    }

    try {
      console.log("[Polling] Checking for response...")
      
      const response = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "poll",
          toPhone: normalizeWhatsApp(toPhone),
        }),
      })

      if (!response.ok) {
        const result = await response.json()
        console.error("[Polling] Error:", result)
        
        // Don't stop polling immediately on errors - retry
        setMessages((prev) => {
          const withoutTyping = prev.filter((msg) => msg.type !== "typing")
          return [
            ...withoutTyping,
            {
              id: `typing-${Date.now()}`,
              type: "typing",
              content: "🔄 Still processing...",
              timestamp: new Date(),
            },
          ]
        })
        return
      }

      const result: PollResult = await response.json()
      console.log("[Polling] Result:", result)

      // Handle different polling states
      switch (result.status) {
        case "empty":
          // Update typing indicator with new message
          console.log("[Polling] Empty message:", result.message)
          setMessages((prev) => {
            const withoutTyping = prev.filter((msg) => msg.type !== "typing")
            return [
              ...withoutTyping,
              {
                id: `typing-${Date.now()}`,
                type: "typing",
                content: result.message,
                timestamp: new Date(),
              },
            ]
          })
          break

        case "processing":
          // Show processing status
          console.log("[Polling] Processing webhook...")
          setMessages((prev) => {
            const withoutTyping = prev.filter((msg) => msg.type !== "typing")
            return [
              ...withoutTyping,
              {
                id: `typing-${Date.now()}`,
                type: "typing",
                content: result.message || "⚡ Processing your request...",
                timestamp: new Date(),
              },
            ]
          })
          break

        case "completed":
          // Final response received - stop polling
          console.log("[Polling] Completed! Message:", result.message)
          stopPolling()
          setMessages((prev) => [
            ...prev.filter((msg) => msg.type !== "typing"),
            {
              id: `${Date.now()}`,
              type: "api",
              content: result.message,
              timestamp: new Date(),
            },
          ])
          break

        case "waiting":
          // Still waiting - keep polling
          console.log("[Polling] Waiting... Elapsed:", result.elapsedSeconds)
          break

        case "none":
          // No active conversation - this might happen if cleanup occurred
          console.log("[Polling] No active conversation - stopping polling")
          stopPolling()
          setMessages((prev) => [
            ...prev.filter((msg) => msg.type !== "typing"),
            {
              id: `${Date.now()}`,
              type: "system",
              content: "No active conversation found. Please send a new message.",
              timestamp: new Date(),
            },
          ])
          break

        default:
          console.warn("[Polling] Unknown status:", result.status)
      }
    } catch (error) {
      console.error("[Polling] Exception:", error)
      // Don't stop polling on network errors - retry
      setMessages((prev) => {
        const withoutTyping = prev.filter((msg) => msg.type !== "typing")
        return [
          ...withoutTyping,
          {
            id: `typing-${Date.now()}`,
            type: "typing",
            content: "🔄 Still processing...",
            timestamp: new Date(),
          },
        ]
      })
    }
  }

  // Start polling process
  const startPolling = () => {
    // Prevent starting multiple polling instances
    if (hasStartedPollingRef.current) {
      console.log("[Polling] Already running, skipping...")
      return
    }

    console.log("[Polling] Starting...")
    setIsPolling(true)
    setIsLoading(true)
    hasStartedPollingRef.current = true

    // Add initial typing indicator
    setMessages((prev) => [
      ...prev,
      {
        id: `typing-${Date.now()}`,
        type: "typing",
        content: "🔄 Processing your response...",
        timestamp: new Date(),
      },
    ])

    // Start polling immediately - only call once
    pollForResponse()

    // Continue polling at intervals
    pollingIntervalRef.current = setInterval(() => {
      pollForResponse()
    }, POLL_INTERVAL)
  }

  // Send message to API
  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return
    if (!toPhone.trim()) {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}`,
          type: "system",
          content: "Please enter your WhatsApp number first.",
          timestamp: new Date(),
        },
      ])
      return
    }

    // Stop any existing polling before starting new request
    if (hasStartedPollingRef.current) {
      stopPolling()
    }

    // Add user message to UI
    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: inputMessage,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMessage])

    const messageToSend = inputMessage
    setInputMessage("")
    setIsLoading(true)

    // Check if this is a follow-up soft skills message that requires special handling
    const isFollowUpSoftSkills = shouldDelayForSoftSkills(messages, messageToSend)
    console.log("[Send] Is follow-up soft skills question:", isFollowUpSoftSkills)

    try {
      const response = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          message: messageToSend,
          toPhone: normalizeWhatsApp(toPhone),
          isSoftSkillsQuestion: isFollowUpSoftSkills,
        }),
      })

      const result = await response.json()
      console.log("[Send] API response:", result)

      if (response.ok) {
        if (result.isSoftSkillsResponse || result.requiresPolling) {
          // For responses that require polling, start the polling process
          console.log("[Send] Starting polling for delayed response")
          startPolling()
        } else {
          // Normal immediate response
          setIsLoading(false)
          if (result.message) {
            setMessages((prev) => [
              ...prev,
              {
                id: `${Date.now()}`,
                type: "api",
                content: result.message,
                timestamp: new Date(),
              },
            ])
          }
        }
      } else {
        // Error occurred
        setIsLoading(false)
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}`,
            type: "system",
            content: result.error || "Failed to send message",
            timestamp: new Date(),
          },
        ])
      }
    } catch (error) {
      console.error("[Send] Error:", error)
      setIsLoading(false)
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: "system",
          content: "Network error. Please check your connection and try again.",
          timestamp: new Date(),
        },
      ])
    }
  }

  // Parse chat history into resume JSON
  const handleParseJSON = async () => {
    console.log("[Parse] Starting parse process")

    if (messages.length === 0) {
      console.log("[Parse] No messages to parse")
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}`,
          type: "system",
          content: "No conversation history to parse yet.",
          timestamp: new Date(),
        },
      ])
      return
    }

    setIsParsing(true)

    try {
      const chatHistory = messages
        .map((msg) => `${msg.type}: ${msg.content}`)
        .join("\n")

      const response = await fetch("/api/parse-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatHistory }),
      })

      const result = await response.json()
      console.log("[Parse] Result:", result)

      if (response.ok) {
        setParsedResume(result.parsedResume)
        setShowParsedJSON(true)
        console.log("[Parse] Success")
        
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}`,
            type: "system",
            content: "✅ Resume parsed successfully! Check the JSON output below.",
            timestamp: new Date(),
          },
        ])
      } else {
        throw new Error(result.error || "Failed to parse resume")
      }
    } catch (error) {
      console.error("[Parse] Error:", error)
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: "system",
          content: `Parse Error: ${error instanceof Error ? error.message : "Failed to parse resume"}`,
          timestamp: new Date(),
        },
      ])
    } finally {
      setIsParsing(false)
    }
  }

  // Clear cache and reset conversation
  const handleClearCache = async () => {
    try {
      const sessionId = toPhone.trim() ? normalizeWhatsApp(toPhone) : ""
      
      if (sessionId) {
        // Call backend to clear chat history
        const response = await fetch(
          "https://surikado.hellodexter.com/webhook/delete-chat-history",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              specversion: "1.0",
              type: "com.twilio.messaging.inbound-message.received",
              source: "/some-path",
              id: `clear-${Date.now()}`,
              dataschema: "https://events-schemas.twilio.com/Messaging.InboundMessageV1/5",
              datacontenttype: "application/json",
              time: new Date().toISOString(),
              data: {
                numMedia: 0,
                timestamp: new Date().toISOString(),
                recipients: [],
                accountSid: "ACxxxx",
                messagingServiceSid: "MGxxxx",
                to: "whatsapp:+447418633913",
                numSegments: 1,
                messageSid: `clear-${Date.now()}`,
                eventName: "com.twilio.messaging.inbound-message.received",
                body: "Clear chat history",
                database: "surikadodb",
                collection: "n8n_chat_histories",
                sessionId,
              },
            }),
          }
        )

        if (!response.ok) {
          console.error("[Clear] Failed to delete chat history from server")
        } else {
          console.log("[Clear] Chat history cleared from server")
        }
      }
    } catch (error) {
      console.error("[Clear] Error calling delete API:", error)
    }

    // Clear local state
    stopPolling()
    setMessages([])
    setParsedResume(null)
    setShowParsedJSON(false)
    console.log("[Clear] Local cache cleared")
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 shadow-lg">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle className="w-8 h-8" />
            <div>
              <h1 className="text-xl font-semibold">Surikado Chat Assistant</h1>
              <p className="text-blue-100 text-sm">Your AI-powered job opportunity assistant</p>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <Input
              value={toPhone}
              onChange={(e) => setToPhone(e.target.value)}
              placeholder="WhatsApp: +1234567890"
              className="w-60 bg-white/10 text-white placeholder:text-blue-200 border-white/20"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleParseJSON}
              disabled={isParsing || messages.length === 0}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20"
            >
              <FileText className="w-4 h-4 mr-1" />
              {isParsing ? "Parsing..." : "Parse"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleClearCache}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Clear
            </Button>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="max-w-4xl mx-auto p-4 h-[calc(100vh-80px)]">
        <Card className="h-full p-4 shadow-lg flex flex-col">
          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto space-y-4 mb-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                  <MessageCircle className="w-8 h-8 text-blue-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-800 mb-2">
                  Welcome to Surikado!
                </h2>
                <p className="text-gray-600">
                  Start a conversation to find amazing job opportunities.
                </p>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        message.type === "user"
                          ? "bg-blue-600 text-white"
                          : message.type === "api"
                            ? "bg-green-100 text-green-800 border border-green-200"
                            : message.type === "typing"
                              ? "bg-gray-100 text-gray-600 border border-gray-200"
                              : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {message.type === "typing" ? (
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" />
                            <div
                              className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                              style={{ animationDelay: "0.1s" }}
                            />
                            <div
                              className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                              style={{ animationDelay: "0.2s" }}
                            />
                          </div>
                          <span className="text-sm">{message.content}</span>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                          <p className="text-xs opacity-70 mt-1">
                            {message.timestamp.toLocaleTimeString()}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Parsed JSON Display */}
          {showParsedJSON && parsedResume && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200 max-h-40 overflow-y-auto">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold text-sm">Parsed Resume JSON</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowParsedJSON(false)}
                  className="h-6 px-2"
                >
                  ✕
                </Button>
              </div>
              <pre className="text-xs overflow-x-auto">
                {JSON.stringify(parsedResume, null, 2)}
              </pre>
            </div>
          )}

          {/* Input Area */}
          <div className="flex gap-2">
            <Input
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Type your message..."
              onKeyPress={(e) => e.key === "Enter" && !isLoading && handleSendMessage()}
              className="flex-1"
              disabled={isLoading}
            />
            <Button onClick={handleSendMessage} disabled={isLoading || !inputMessage.trim()}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}