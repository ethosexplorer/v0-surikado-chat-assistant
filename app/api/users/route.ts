import { type NextRequest, NextResponse } from "next/server"

// In-memory storage for demo purposes (replace with database in production)
const users: Array<{ id: number; username: string; email: string }> = []
let nextId = 1

export async function GET() {
  try {
    return NextResponse.json(users)
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()

    if (!data.username || !data.email) {
      return NextResponse.json({ error: "Username and email are required" }, { status: 400 })
    }

    const newUser = {
      id: nextId++,
      username: data.username,
      email: data.email,
    }

    users.push(newUser)
    return NextResponse.json(newUser, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 })
  }
}
