import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
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

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))

    const title = body?.title || 'Live Favorit Alert'
    const message = body?.body || 'To jest testowe powiadomienie push.'
    const url = body?.url || process.env.NEXT_PUBLIC_SITE_URL || '/'

    const endpoints = await redis.smembers<string[]>(SUBSCRIPTIONS_SET_KEY)

    if (!endpoints || endpoints.length === 0) {
      return NextResponse.json(
        { error: 'Brak zapisanych subskrypcji' },
        { status: 400 }
      )
    }

    const payload = JSON.stringify({
      title,
      body: message,
      url,
    })

    const results = await Promise.all(
      endpoints.map(async (endpoint) => {
        const sub = await redis.get<PushSubscriptionRecord>(endpointKey(endpoint))

        if (!sub) {
          await redis.srem(SUBSCRIPTIONS_SET_KEY, endpoint)
          return {
            endpoint,
            ok: false,
            error: 'Brak rekordu subskrypcji',
          }
        }

        const subscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        }

        try {
          await webpush.sendNotification(subscription as any, payload)

          return {
            endpoint,
            ok: true,
          }
        } catch (err: any) {
          const statusCode = err?.statusCode

          if (statusCode === 404 || statusCode === 410) {
            await redis.del(endpointKey(endpoint))
            await redis.srem(SUBSCRIPTIONS_SET_KEY, endpoint)
          }

          return {
            endpoint,
            ok: false,
            error: err?.message || 'push failed',
          }
        }
      })
    )

    return NextResponse.json({
      ok: true,
      count: results.length,
      results,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Push test failed' },
      { status: 500 }
    )
  }
}