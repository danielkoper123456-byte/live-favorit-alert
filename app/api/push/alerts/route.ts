import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { redis } from '@/lib/redis'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

const SENT_SET = 'push:sent_alerts'
const SUBSCRIPTIONS_SET = 'push:subscriptions'

function buildKey(match: any) {
  return `${match.fixtureId}-${match.type}`
}

export async function POST(req: NextRequest) {
  try {
    // 🔹 pobierz aktualne alerty
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SITE_URL}/api/import`,
      { cache: 'no-store' }
    )

    const data = await res.json()
    const matches = data?.matches || []

    if (!matches.length) {
      return NextResponse.json({ ok: true, message: 'Brak alertów' })
    }

    // 🔹 znajdź nowe (nie wysłane)
    const newMatches: any[] = []

    for (const m of matches) {
      const key = buildKey(m)
      const exists = await redis.sismember(SENT_SET, key)

      if (!exists) {
        newMatches.push(m)
        await redis.sadd(SENT_SET, key)
      }
    }

    if (!newMatches.length) {
      return NextResponse.json({ ok: true, message: 'Brak nowych alertów' })
    }

    // 🔹 pobierz subskrypcje
    const endpoints = await redis.smembers<string[]>(SUBSCRIPTIONS_SET)

    if (!endpoints || endpoints.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'Brak subskrypcji',
      })
    }

    // 🔹 przygotuj payload
    const payload = JSON.stringify({
      title: 'Nowe alerty!',
      body: `${newMatches.length} nowych meczów`,
      url: process.env.NEXT_PUBLIC_SITE_URL,
    })

    // 🔹 wysyłka push
    const results = await Promise.all(
      endpoints.map(async (endpoint) => {
        const sub = await redis.get<any>(`push:endpoint:${endpoint}`)
        if (!sub) return null

        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            } as any,
            payload
          )

          return { ok: true }
        } catch (err: any) {
          return { ok: false, error: err?.message }
        }
      })
    )

    return NextResponse.json({
      ok: true,
      sent: newMatches.length,
      results,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Push alert failed' },
      { status: 500 }
    )
  }
}