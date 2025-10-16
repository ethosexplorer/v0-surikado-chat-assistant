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

export default function SurikadoChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [showParsedJSON, setShowParsedJSON] = useState(false)
  const [parsedResume, setParsedResume] = useState<any>(null)
  const [toPhone, setToPhone] = useState("")

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [pollAttempts, setPollAttempts] = useState(0)
  const [currentPollInterval, setCurrentPollInterval] = useState(3000)
  const [isRapidPolling, setIsRapidPolling] = useState(false)
  const [waitingForApiCall, setWaitingForApiCall] = useState(false)
  const [secondsUntilApiCall, setSecondsUntilApiCall] = useState(0)

  const MAX_POLL_ATTEMPTS = 200 // Increased for longer soft skills wait

  const POLL_INTERVAL_NORMAL = 3000
  const POLL_INTERVAL_RAPID = 1000

  const shouldDelayForSoftSkills = (msgs: Message[]) => {
    const userMessage = msgs[msgs.length - 1]?.content || ""
    const message = userMessage.toLowerCase()
    
    // Check for soft skills related keywords
    const softSkillsKeywords = [
      'soft skills', 'softskills', 'teamwork', 'communication', 
      'leadership', 'problem solving', 'problemsolving', 'collaboration',
      'adaptability', 'time management', 'creativity', 'critical thinking',
      'what soft skills', 'list soft skills', 'my soft skills',
      'strengths', 'weaknesses', 'abilities', 'personal skills'
    ]
    
    return softSkillsKeywords.some(keyword => message.includes(keyword))
  }

  const normalizeWhatsApp = (raw: string) => {
    if (!raw) return ""
    let n = String(raw).trim()
    if (n.toLowerCase().startsWith("whatsapp:")) n = n.slice(9)
    n = n.replace(/[^+\d]/g, "")
    if (!n.startsWith("+")) n = `+${n}`
    return `whatsapp:${n}`
  }

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    setIsPolling(false)
    setIsLoading(false)
    setIsRapidPolling(false)
    setWaitingForApiCall(false)
    setSecondsUntilApiCall(0)
    setPollAttempts(0)
    setCurrentPollInterval(POLL_INTERVAL_NORMAL)
  }

  const startRapidPolling = () => {
    if (!isRapidPolling) {
      console.log("[polling] 🚀 SWITCHING TO RAPID POLLING (1 second intervals)")
      setIsRapidPolling(true)
      setCurrentPollInterval(POLL_INTERVAL_RAPID)
      
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
      pollingIntervalRef.current = setInterval(() => {
        pollForResponse()
      }, POLL_INTERVAL_RAPID)
    }
  }

  const pollForResponse = async () => {
    if (pollAttempts >= MAX_POLL_ATTEMPTS) {
      console.error("[polling] Max poll attempts reached")
      stopPolling()
      setMessages((prev) => [
        ...prev.filter((msg) => msg.type !== "typing"),
        {
          id: `${Date.now()}`,
          type: "system",
          content: "This is taking longer than expected. Your request is still processing and you'll get a response soon.",
          timestamp: new Date(),
        },
      ])
      return
    }

    setPollAttempts(prev => prev + 1)

    try {
      console.log(`[polling] Checking for response... (attempt ${pollAttempts}/${MAX_POLL_ATTEMPTS}, interval: ${currentPollInterval}ms)`)
      const response = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "poll",
          toPhone: normalizeWhatsApp(toPhone),
        }),
      })

      const result = await response.json()
      console.log("[polling] Poll result:", result)

      // Handle rapid polling for soft skills
      if (result.rapidPolling && !isRapidPolling) {
        startRapidPolling()
      }

      // Handle waiting for API call (soft skills flow)
      if (result.waitingForApiCall) {
        setWaitingForApiCall(true)
        setSecondsUntilApiCall(result.secondsUntilApiCall || 0)
        console.log(`[polling] Waiting for API call in ${result.secondsUntilApiCall}s`)
        
        // Start rapid polling when we're close to API call time
        if (result.secondsUntilApiCall <= 5 && !isRapidPolling) {
          startRapidPolling()
        }
      } else {
        setWaitingForApiCall(false)
        setSecondsUntilApiCall(0)
      }

      if (!response.ok) {
        stopPolling()
        setMessages((prev) => [
          ...prev.filter((msg) => msg.type !== "typing"),
          {
            id: `${Date.now()}`,
            type: "system",
            content: result?.message || "Connection issue. Please try again.",
            timestamp: new Date(),
          },
        ])
        return
      }

      if (result.status === "timeout") {
        console.log("[polling] Backend reported polling timeout")
        stopPolling()
        setMessages((prev) => [
          ...prev.filter((msg) => msg.type !== "typing"),
          {
            id: `${Date.now()}`,
            type: "system",
            content: result.message || "Session expired. Please send your message again.",
            timestamp: new Date(),
          },
        ])
        return
      }

      if (result.status === "empty") {
        console.log("[polling] Empty message received:", result.message)
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
      } else if (result.status === "processing") {
        console.log("[polling] Processing webhook...", result.webhookElapsed)
        
        if (result.webhookElapsed > 65 && !isRapidPolling) {
          startRapidPolling()
        }
        
        setMessages((prev) => {
          const withoutTyping = prev.filter((msg) => msg.type !== "typing")
          return [
            ...withoutTyping,
            {
              id: `typing-${Date.now()}`,
              type: "typing",
              content: result.message || "Processing your request...",
              timestamp: new Date(),
            },
          ]
        })
      } else if (result.status === "completed") {
        console.log("[polling] Completed! Final message:", result.message)
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
      } else if (result.status === "waiting") {
        console.log("[polling] Still waiting...", result.elapsedSeconds)
        
        if (result.elapsedSeconds > 65 && !isRapidPolling) {
          startRapidPolling()
        }

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
      } else if (result.status === "none") {
        console.log("[polling] No active conversation")
        stopPolling()
      }
    } catch (error) {
      console.error("[polling] Error:", error)
      if (pollAttempts >= MAX_POLL_ATTEMPTS - 10) {
        console.log("[polling] Final attempts, continuing...")
      }
    }
  }

  const startPolling = (isSoftSkills = false) => {
    console.log(`[polling] Starting polling for ${isSoftSkills ? 'soft skills' : 'normal'} flow`)
    setIsPolling(true)
    setIsLoading(true)
    setIsRapidPolling(false)
    setPollAttempts(0)
    setCurrentPollInterval(POLL_INTERVAL_NORMAL)

    const initialMessage = isSoftSkills 
      ? "Starting soft skills analysis... (This may take about 1-2 minutes)" 
      : "Processing your request..."

    setMessages((prev) => [
      ...prev,
      {
        id: `typing-${Date.now()}`,
        type: "typing",
        content: initialMessage,
        timestamp: new Date(),
      },
    ])

    pollForResponse()

    pollingIntervalRef.current = setInterval(() => {
      pollForResponse()
    }, POLL_INTERVAL_NORMAL)
  }

  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [])

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return

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

    const isSoftSkills = shouldDelayForSoftSkills([...messages, userMessage])

    try {
      const response = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          message: messageToSend,
          toPhone: normalizeWhatsApp(toPhone),
          isSoftSkillsQuestion: isSoftSkills,
        }),
      })

      const result = await response.json()
      console.log("[send] API response:", result)

      if (response.ok && result.isSoftSkillsResponse) {
        console.log("[send] Starting soft skills polling flow")
        startPolling(true)
      } else if (response.ok) {
        setIsLoading(false)
        const systemMessage: Message = {
          id: `${Date.now()}`,
          type: "api",
          content: result.message || "Message sent",
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, systemMessage])
      } else {
        setIsLoading(false)
        const errorMessage: Message = {
          id: `${Date.now()}`,
          type: "system",
          content: result.error || "Failed to send message",
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, errorMessage])
      }
    } catch (error) {
      console.error("Error calling API:", error)
      setIsLoading(false)
      const errorMessage: Message = {
        id: Date.now().toString(),
        type: "system",
        content: "Network error. Please try again.",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    }
  }

  const handleParseJSON = async () => {
    console.log("[v0] Parse JSON button clicked")
    console.log("[v0] Messages length:", messages.length)

    if (messages.length === 0) {
      console.log("[v0] No messages to parse, returning early")
      return
    }

    setIsParsing(true)
    console.log("[v0] Starting parse process")

    try {
      const chatHistory = messages.map((msg) => `${msg.type}: ${msg.content}`).join("\n")
      console.log("[v0] Chat history prepared:", chatHistory.substring(0, 200) + "...")

      const response = await fetch("/api/parse-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatHistory }),
      })

      console.log("[v0] API response status:", response.status)
      const result = await response.json()
      console.log("[v0] API response result:", result)

      if (response.ok) {
        setParsedResume(result.parsedResume)
        setShowParsedJSON(true)
        console.log("[v0] Resume parsed successfully")
      } else {
        throw new Error(result.error || "Failed to parse resume")
      }
    } catch (error) {
      console.error("[v0] Error parsing JSON:", error)
      const errorMessage: Message = {
        id: Date.now().toString(),
        type: "system",
        content: `Parse Error: ${error instanceof Error ? error.message : "Failed to parse resume"}`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsParsing(false)
      console.log("[v0] Parse process completed")
    }
  }

  const handleClearCache = async () => {
    try {
      const sessionId = toPhone.trim() ? normalizeWhatsApp(toPhone) : ""
      if (sessionId) {
        const response = await fetch("https://surikado.hellodexter.com/webhook/delete-chat-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            specversion: "1.0",
            type: "com.twilio.messaging.inbound-message.received",
            source:
              "/2010-04-01/Accounts/AC24c60aa1d6a19f352f19a63198bd4252/Messages/SM0784303f394b6086ce8fdcf707284eb9.json",
            id: "EZ279e45baa01be63f2aff062dbad97817",
            dataschema: "https://events-schemas.twilio.com/Messaging.InboundMessageV1/5",
            datacontenttype: "application/json",
            time: new Date().toISOString(),
            data: {
              numMedia: 0,
              timestamp: new Date().toISOString(),
              recipients: [],
              accountSid: "AC24c60aa1d6a19f352f19a63198bd4252",
              messagingServiceSid: "MG6bf385d0da89ad4660cc24875ebb1ec4",
              to: "whatsapp:+447418633913",
              numSegments: 1,
              messageSid: "SM0784303f394b6086ce8fdcf707284eb9",
              eventName: "com.twilio.messaging.inbound-message.received",
              body: "Clear chat history",
              database: "surikadodb",
              collection: "n8n_chat_histories",
              sessionId,
            },
          }),
        })

        if (!response.ok) {
          console.error("Failed to delete chat history from server")
        }
      }
    } catch (error) {
      console.error("Error calling delete chat history API:", error)
    }

    stopPolling()
    setMessages([])
    setParsedResume(null)
    setShowParsedJSON(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
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
              placeholder="Your WhatsApp number e.g. +123456789"
              className="w-60 bg-white/10 text-white placeholder:text-blue-100 border-white/20"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleParseJSON}
              disabled={isParsing || messages.length === 0}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20"
            >
              <FileText className="w-4 h-4 mr-1" />
              {isParsing ? "Parsing..." : "Parse JSON"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleClearCache}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Clear Cache
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 h-[calc(100vh-80px)]">
        <Card className="h-full p-4 shadow-lg">
          <div className="h-full flex flex-col">
            {/* Status indicator for soft skills waiting */}
            {waitingForApiCall && secondsUntilApiCall > 0 && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-blue-700 text-sm">
                    ⏳ Soft skills analysis starting in {secondsUntilApiCall} seconds...
                  </span>
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-4 mb-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                    <MessageCircle className="w-8 h-8 text-blue-600" />
                  </div>
                  <h2 className="text-xl font-semibold text-gray-800 mb-2">Welcome to Surikado!</h2>
                  <p className="text-gray-600">Start a conversation to find amazing job opportunities.</p>
                  <p className="text-gray-500 text-sm mt-2">Ask about soft skills for detailed analysis</p>
                </div>
              ) : (
                messages.map((message) => (
                  <div key={message.id} className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}>
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
                            <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                            <div
                              className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                              style={{ animationDelay: "0.1s" }}
                            ></div>
                            <div
                              className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                              style={{ animationDelay: "0.2s" }}
                            ></div>
                          </div>
                          <span className="text-sm">{message.content}</span>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                          <p className="text-xs opacity-70 mt-1">{message.timestamp.toLocaleTimeString()}</p>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2">
              <Input
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Type your message..."
                onKeyPress={(e) => e.key === "Enter" && !isLoading && handleSendMessage()}
                className="flex-1"
                disabled={isLoading}
              />
              <Button onClick={handleSendMessage} disabled={isLoading}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
