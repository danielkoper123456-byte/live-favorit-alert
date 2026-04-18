import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'

type PushSubscriptionRecord = {
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string | null
  createdAt: string
  updatedAt: string
}

function endpointKey(endpoint: string) {
  return `push:endpoint:${endpoint}`
}

const SUBSCRIPTIONS_SET_KEY = 'push:subscriptions'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const endpoint = body?.endpoint
    const p256dh = body?.keys?.p256dh
    const auth = body?.keys?.auth
    const userAgent = req.headers.get('user-agent') || null

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { error: 'Niepełna subskrypcja push' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    const existing = await redis.get<PushSubscriptionRecord>(endpointKey(endpoint))

    const record: PushSubscriptionRecord = {
      endpoint,
      p256dh,
      auth,
      userAgent,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }

    await redis.set(endpointKey(endpoint), record)
    await redis.sadd(SUBSCRIPTIONS_SET_KEY, endpoint)

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Subscribe failed' },
      { status: 500 }
    )
  }
}