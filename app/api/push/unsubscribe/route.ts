import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'

function endpointKey(endpoint: string) {
  return `push:endpoint:${endpoint}`
}

const SUBSCRIPTIONS_SET_KEY = 'push:subscriptions'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const endpoint = body?.endpoint

    if (!endpoint) {
      return NextResponse.json(
        { error: 'Brak endpoint' },
        { status: 400 }
      )
    }

    await redis.del(endpointKey(endpoint))
    await redis.srem(SUBSCRIPTIONS_SET_KEY, endpoint)

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Unsubscribe failed' },
      { status: 500 }
    )
  }
}