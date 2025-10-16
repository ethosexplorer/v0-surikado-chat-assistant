"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { MessageCircle, Send, Trash2, FileText, Clock } from "lucide-react"

interface Message {
  id: string
  type: "user" | "system" | "api"
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
  const [isWaiting, setIsWaiting] = useState(false)
  const [waitTimeRemaining, setWaitTimeRemaining] = useState(0)

  const normalizeWhatsApp = (raw: string) => {
    if (!raw) return ""
    let n = String(raw).trim()
    if (n.toLowerCase().startsWith("whatsapp:")) n = n.slice(9)
    n = n.replace(/[^+\d]/g, "")
    if (!n.startsWith("+")) n = `+${n}`
    return `whatsapp:${n}`
  }

  const isSoftSkillsMessage = (message: string): boolean => {
    const softSkillsKeywords = [
      "soft skill",
      "communication",
      "teamwork",
      "leadership",
      "problem solving",
      "time management",
      "adaptability",
      "critical thinking",
      "emotional intelligence",
      "interpersonal",
      "collaboration",
      "creativity",
      "work ethic",
    ]
    const lowerMessage = message.toLowerCase()
    return softSkillsKeywords.some(keyword => lowerMessage.includes(keyword))
  }

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
    
    // Check if message is about soft skills
    const isSoftSkills = isSoftSkillsMessage(messageToSend)
    
    if (isSoftSkills) {
      // Set waiting state and show countdown
      setIsWaiting(true)
      const waitTime = 1.20 * 60 * 1000 // 72,000 ms (1.20 minutes)
      setWaitTimeRemaining(waitTime)
      
      const waitMessage: Message = {
        id: `${Date.now()}-wait`,
        type: "system",
        content: `⏳ Processing soft skills analysis... This may take about ${Math.ceil(waitTime / 1000)} seconds.`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, waitMessage])
      
      // Update countdown every second
      const interval = setInterval(() => {
        setWaitTimeRemaining((prev) => {
          const newTime = prev - 1000
          if (newTime <= 0) {
            clearInterval(interval)
            return 0
          }
          return newTime
        })
      }, 1000)
      
      // Wait for 1.20 minutes, then call the API
      setTimeout(async () => {
        clearInterval(interval)
        setIsWaiting(false)
        setWaitTimeRemaining(0)
        setIsLoading(true)
        
        try {
          const response = await fetch("/api/send-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "send",
              message: messageToSend,
              toPhone: normalizeWhatsApp(toPhone),
            }),
          })

          const result = await response.json()
          console.log("[send] API response:", result)

          if (response.ok) {
            const apiMessage: Message = {
              id: `${Date.now()}`,
              type: "api",
              content: result.message || "Soft skills analysis completed successfully",
              timestamp: new Date(),
            }
            setMessages((prev) => [...prev, apiMessage])
          } else {
            const errorMessage: Message = {
              id: `${Date.now()}`,
              type: "system",
              content: result.error || "Failed to process message",
              timestamp: new Date(),
            }
            setMessages((prev) => [...prev, errorMessage])
          }
        } catch (error) {
          console.error("Error calling API:", error)
          const errorMessage: Message = {
            id: Date.now().toString(),
            type: "system",
            content: "Network error. Please try again.",
            timestamp: new Date(),
          }
          setMessages((prev) => [...prev, errorMessage])
        } finally {
          setIsLoading(false)
        }
      }, waitTime)
    } else {
      // For non-soft skills messages, call API immediately
      setIsLoading(true)
      
      try {
        const response = await fetch("/api/send-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send",
            message: messageToSend,
            toPhone: normalizeWhatsApp(toPhone),
          }),
        })

        const result = await response.json()
        console.log("[send] API response:", result)

        if (response.ok) {
          const apiMessage: Message = {
            id: `${Date.now()}`,
            type: "api",
            content: result.message || "Message processed successfully",
            timestamp: new Date(),
          }
          setMessages((prev) => [...prev, apiMessage])
        } else {
          const errorMessage: Message = {
            id: `${Date.now()}`,
            type: "system",
            content: result.error || "Failed to process message",
            timestamp: new Date(),
          }
          setMessages((prev) => [...prev, errorMessage])
        }
      } catch (error) {
        console.error("Error calling API:", error)
        const errorMessage: Message = {
          id: Date.now().toString(),
          type: "system",
          content: "Network error. Please try again.",
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, errorMessage])
      } finally {
        setIsLoading(false)
      }
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
        
        const successMessage: Message = {
          id: Date.now().toString(),
          type: "system",
          content: "Resume parsed successfully! Check the parsed data below.",
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, successMessage])
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

    setMessages([])
    setParsedResume(null)
    setShowParsedJSON(false)
    setIsWaiting(false)
    setWaitTimeRemaining(0)
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
            {/* Waiting Indicator */}
            {isWaiting && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3">
                <Clock className="w-5 h-5 text-amber-600 animate-pulse" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800">Processing soft skills analysis...</p>
                  <p className="text-xs text-amber-600">
                    Time remaining: {(waitTimeRemaining / 1000).toFixed(1)}s
                  </p>
                </div>
              </div>
            )}

            {/* Parsed JSON Display */}
            {showParsedJSON && parsedResume && (
              <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-semibold text-green-800">Parsed Resume Data</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowParsedJSON(false)}
                    className="text-green-700 border-green-300"
                  >
                    Close
                  </Button>
                </div>
                <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-60">
                  {JSON.stringify(parsedResume, null, 2)}
                </pre>
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
                            : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      <p className="text-xs opacity-70 mt-1">{message.timestamp.toLocaleTimeString()}</p>
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
                onKeyPress={(e) => e.key === "Enter" && !isLoading && !isWaiting && handleSendMessage()}
                className="flex-1"
                disabled={isLoading || isWaiting}
              />
              <Button onClick={handleSendMessage} disabled={isLoading || isWaiting}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
