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
  status: "waiting" | "processing" | "completed" | "none"
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
  
  // Request tracking
  const currentRequestIdRef = useRef<string>("")
  const isSendingRef = useRef(false)
  const isWaitingForResponseRef = useRef(false)

  const POLL_INTERVAL = 3000

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

  // Enhanced soft skills detection
  const isSoftSkillsMessage = (message: string): boolean => {
    const text = message.toLowerCase()
    
    // Soft skills QUESTIONS (from bot)
    const softSkillsQuestions = [
      "soft skills", "primary skills", "what soft skills",
      "teamwork", "problem-solving", "communication",
      "adaptability", "technical leadership", "what are your soft skills",
      "tell me about your skills", "what skills do you have",
      "what are your primary skills", "describe your skills"
    ]
    
    // Soft skills RESPONSES (from user) - expanded to include technical skills
    const softSkillsResponses = [
      "problem-solving", "adaptability", "technical leadership",
      "teamwork", "communication", "collaboration", "leadership",
      "critical thinking", "time management", "creativity",
      "java", "spring", "framework", "sql", "spring boot", "rest api",
      "git", "docker", "postgresql", "maven", "oracle", "kubernetes",
      "java ee", "python", "javascript", "react", "node", "aws",
      "azure", "cloud", "database", "api", "microservices", "devops",
      "agile", "scrum", "ci/cd", "testing", "debugging"
    ]
    
    const isQuestion = softSkillsQuestions.some(keyword => text.includes(keyword))
    const isResponse = softSkillsResponses.some(keyword => text.includes(keyword))
    
    console.log("[Detection] Soft skills - Question:", isQuestion, "Response:", isResponse, "Message:", message)
    
    // Detect if this looks like a skills list (multiple technical terms)
    const technicalTerms = text.split(/\s+/).filter(word => 
      softSkillsResponses.some(skill => word.includes(skill))
    )
    const isSkillsList = technicalTerms.length >= 2
    
    console.log("[Detection] Technical terms found:", technicalTerms, "Is skills list:", isSkillsList)
    
    return isQuestion || isResponse || isSkillsList
  }

  // Request validation
  const canMakeNewRequest = (): { canMake: boolean; message?: string } => {
    if (isSendingRef.current) {
      return { 
        canMake: false, 
        message: "Please wait, your previous message is being processed..." 
      }
    }
    
    if (isWaitingForResponseRef.current) {
      return { 
        canMake: false, 
        message: "Please wait for the current response to complete before sending another message." 
      }
    }
    
    return { canMake: true }
  }

  // Stop polling
  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    setIsPolling(false)
    setIsLoading(false)
    isWaitingForResponseRef.current = false
    isSendingRef.current = false
    currentRequestIdRef.current = ""
    console.log("[Polling] Stopped polling")
  }

  // Polling for response
  const pollForResponse = async () => {
    if (!isWaitingForResponseRef.current) {
      console.log("[Polling] No active request, stopping polling")
      stopPolling()
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
          requestId: currentRequestIdRef.current,
        }),
      })

      if (!response.ok) {
        const result = await response.json()
        console.error("[Polling] Error:", result)
        
        // Stop polling on server errors
        if (response.status >= 400) {
          stopPolling()
          setMessages((prev) => [
            ...prev.filter((msg) => msg.type !== "typing"),
            {
              id: `${Date.now()}`,
              type: "system",
              content: "Server error. Please try again.",
              timestamp: new Date(),
            },
          ])
        }
        return
      }

      const result: PollResult = await response.json()
      console.log("[Polling] Result:", result)

      switch (result.status) {
        case "processing":
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
          console.log("[Polling] ✅ Completed! Message:", result.message)
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

        case "none":
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
      // Stop polling on network errors
      stopPolling()
      setMessages((prev) => [
        ...prev.filter((msg) => msg.type !== "typing"),
        {
          id: `${Date.now()}`,
          type: "system",
          content: "Network error during polling. Please try again.",
          timestamp: new Date(),
        },
      ])
    }
  }

  // Start polling
  const startPolling = (requestId: string) => {
    // Always stop any existing polling first
    if (isWaitingForResponseRef.current) {
      console.log("[Polling] Stopping previous polling session")
      stopPolling()
    }

    console.log("[Polling] Starting polling for request:", requestId)
    currentRequestIdRef.current = requestId
    setIsPolling(true)
    setIsLoading(true)
    isWaitingForResponseRef.current = true

    setMessages((prev) => [
      ...prev,
      {
        id: `typing-${Date.now()}`,
        type: "typing",
        content: "🔄 Processing your response...",
        timestamp: new Date(),
      },
    ])

    // Start polling immediately and then set interval
    pollForResponse()
    pollingIntervalRef.current = setInterval(pollForResponse, POLL_INTERVAL)
  }

  // Send message with immediate processing for soft skills
  const handleSendMessage = async () => {
    const messageToSend = inputMessage.trim()
    if (!messageToSend) return
    
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

    // Enhanced validation
    const canRequest = canMakeNewRequest()
    if (!canRequest.canMake) {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}`,
          type: "system",
          content: canRequest.message!,
          timestamp: new Date(),
        },
      ])
      return
    }

    // Set flags BEFORE making request
    isSendingRef.current = true

    // Add user message to UI
    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: messageToSend,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMessage])

    setInputMessage("")
    setIsLoading(true)

    // Use enhanced detection for ALL soft skills messages
    const isSoftSkills = isSoftSkillsMessage(messageToSend)
    console.log("[Send] Is soft skills message:", isSoftSkills, "Message:", messageToSend)

    try {
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      
      console.log("[Send] Making API request to:", "/api/send-message")
      
      const response = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          message: messageToSend,
          toPhone: normalizeWhatsApp(toPhone),
          isSoftSkillsQuestion: isSoftSkills,
          requestId: requestId,
        }),
      })

      // Check if response is ok
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()
      console.log("[Send] API response:", result)

      if (response.ok) {
        if (result.isSoftSkillsResponse) {
          // For soft skills responses, start polling immediately
          console.log("[Send] Starting polling for soft skills response")
          startPolling(requestId)
        } else {
          // Normal immediate response
          setIsLoading(false)
          isSendingRef.current = false
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
        // Error occurred in API response
        console.error("[Send] API error:", result.error)
        setIsLoading(false)
        isSendingRef.current = false
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}`,
            type: "system",
            content: result.error || "Failed to send message. Please try again.",
            timestamp: new Date(),
          },
        ])
      }
    } catch (error) {
      console.error("[Send] Network error:", error)
      setIsLoading(false)
      isSendingRef.current = false
      
      // Enhanced error message based on error type
      let errorMessage = "Network error. Please check your connection and try again."
      
      if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
        errorMessage = "Unable to connect to the server. Please check if your development server is running on localhost:3000."
      } else if (error instanceof Error) {
        errorMessage = `Error: ${error.message}`
      }
      
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: "system",
          content: errorMessage,
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

  // Handle Enter key properly
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isLoading && !isSendingRef.current && !isWaitingForResponseRef.current) {
        handleSendMessage()
      }
    }
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
              disabled={isParsing || messages.length === 0 || isSendingRef.current || isWaitingForResponseRef.current}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20"
            >
              <FileText className="w-4 h-4 mr-1" />
              {isParsing ? "Parsing..." : "Parse"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleClearCache}
              disabled={isSendingRef.current || isWaitingForResponseRef.current}
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

          {/* Input Area */}
          <div className="flex gap-2">
            <Input
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Type your message..."
              onKeyPress={handleKeyPress}
              className="flex-1"
              disabled={isLoading || isSendingRef.current || isWaitingForResponseRef.current}
            />
            <Button 
              onClick={handleSendMessage} 
              disabled={isLoading || !inputMessage.trim() || isSendingRef.current || isWaitingForResponseRef.current}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}