"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { MessageCircle, Send, Trash2, FileText, ChevronDown, ChevronUp } from "lucide-react"

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

    try {
      const response = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageToSend }),
      })

      const result = await response.json()

      if (result.success || result.fallback) {
        const systemMessage: Message = {
          id: (Date.now() + 1).toString(),
          type: "api",
          content: result.message || result.response || "API response received successfully",
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, systemMessage])
      } else if (response.ok) {
        const systemMessage: Message = {
          id: (Date.now() + 1).toString(),
          type: "api",
          content: JSON.stringify(result, null, 2),
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, systemMessage])
      } else {
        throw new Error(result.error || "API call failed")
      }
    } catch (error) {
      console.error("Error calling API:", error)
      const errorMessage: Message = {
        id: (Date.now() + 2).toString(),
        type: "system",
        content: `Error: ${error instanceof Error ? error.message : "Failed to call API"}`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
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
            sessionId: "whatsapp:+923346250250",
          },
        }),
      })

      if (!response.ok) {
        console.error("Failed to delete chat history from server")
      }
    } catch (error) {
      console.error("Error calling delete chat history API:", error)
    }

    setMessages([])
    setParsedResume(null)
    setShowParsedJSON(false)
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
          <div className="flex gap-2">
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
        {/* JSON toggle display section at the top */}
        {parsedResume && (
          <Card className="mb-4 shadow-lg">
            <div className="p-4">
              <Button
                variant="ghost"
                onClick={() => setShowParsedJSON(!showParsedJSON)}
                className="w-full flex items-center justify-between text-left p-0 h-auto"
              >
                <span className="font-semibold text-blue-600">Parsed Resume JSON</span>
                {showParsedJSON ? (
                  <ChevronUp className="w-4 h-4 text-blue-600" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-blue-600" />
                )}
              </Button>
              {showParsedJSON && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <pre className="text-sm text-gray-800 whitespace-pre-wrap overflow-x-auto">
                    {JSON.stringify(parsedResume, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Chat Window */}
        <Card className="h-full p-4 shadow-lg">
          <div className="h-full flex flex-col">
            {/* Messages */}
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
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      <p className="text-sm">{message.content}</p>
                      <p className="text-xs opacity-70 mt-1">{message.timestamp.toLocaleTimeString()}</p>
                    </div>
                  </div>
                ))
              )}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-800 px-4 py-2 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      ></div>
                      <div
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      ></div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <Input
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Type your message..."
                onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                className="flex-1"
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
