import { NextResponse } from 'next/server'

const API_BASE = 'https://v3.football.api-sports.io'
const MAX_ODDS_REQUESTS = 14
const CACHE_TTL_MS = 20 * 1000

const WAIT = (ms: number) => new Promise((res) => setTimeout(res, ms))

type MatchType =
  | 'fav_losing_15'
  | 'fav_not_winning_15_60'
  | 'fav_not_winning_22_red'

type AppMatch = {
  fixtureId: number
  league: string
  home: string
  away: string
  minute: number
  score: string
  favorite: string
  odds: number
  redCard: string | null
  type: MatchType
}

type DebugInfo = {
  live: number
  checked: number
  results: number
  rawFixtures: number
  cached: boolean
  cacheAgeSec: number
  generatedAt: string
  totalCandidates: number
  batchStart: number
  batchEnd: number
  version: string
}

type CachePayload = {
  matches: AppMatch[]
  debug: DebugInfo
}

declare global {
  // eslint-disable-next-line no-var
  var importCache:
    | {
        timestamp: number
        payload: CachePayload
      }
    | undefined

  // eslint-disable-next-line no-var
  var oddsScanState:
    | {
        cursor: number
      }
    | undefined
}

async function apiFetch(path: string, retries = 2): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'x-apisports-key': process.env.API_FOOTBALL_KEY || '',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text()

    if (res.status === 429 && retries > 0) {
      await WAIT(1200)
      return apiFetch(path, retries - 1)
    }

    throw new Error(`API ${res.status}: ${text}`)
  }

  return res.json()
}

function parseScore(fixture: any) {
  const homeGoals = Number(fixture?.goals?.home ?? 0)
  const awayGoals = Number(fixture?.goals?.away ?? 0)

  return {
    homeGoals,
    awayGoals,
    score: `${homeGoals}:${awayGoals}`,
  }
}

function getMinute(fixture: any) {
  return Number(fixture?.fixture?.status?.elapsed ?? 0)
}

function getStatusShort(fixture: any) {
  return String(fixture?.fixture?.status?.short ?? '').toUpperCase()
}

function isReallyLive(fixture: any) {
  const short = getStatusShort(fixture)
  const minute = getMinute(fixture)

  const liveStatuses = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'INT', 'LIVE']
  const endedStatuses = ['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'WO']

  if (liveStatuses.includes(short)) return true
  if (minute > 0 && !endedStatuses.includes(short)) return true

  return false
}

function extractRedCard(item: any, home: string, away: string) {
  const events = item?.events || item?.fixture?.events || []
  if (!Array.isArray(events)) return null

  const red = events.find((e: any) =>
    String(e?.detail || '').toLowerCase().includes('red')
  )

  if (!red) return null

  const team = red?.team?.name || null

  if (!team) return 'Tak'
  if (team === home) return home
  if (team === away) return away

  return team
}

function get1X2Odds(odds: any) {
  const response = odds?.response || []
  if (!response.length) return null

  const bookmakers = response[0]?.bookmakers || []
  if (!bookmakers.length) return null

  const bets = bookmakers[0]?.bets || []
  if (!bets.length) return null

  const matchWinner = bets.find((b: any) => {
    const name = String(b?.name || '').toLowerCase()
    return name.includes('match winner') || name === '1x2'
  })

  if (!matchWinner) return null

  const values = matchWinner?.values || []
  if (!Array.isArray(values) || !values.length) return null

  let homeOdd: number | null = null
  let awayOdd: number | null = null

  for (const v of values) {
    const val = String(v?.value || '').toLowerCase()

    if (val === 'home' || val === '1') {
      homeOdd = Number(v?.odd)
    }

    if (val === 'away' || val === '2') {
      awayOdd = Number(v?.odd)
    }
  }

  if (homeOdd == null || awayOdd == null) return null

  return { homeOdd, awayOdd }
}

function extractFavoriteWithMax(
  odds: any,
  home: string,
  away: string,
  maxOdd: number
) {
  const parsed = get1X2Odds(odds)
  if (!parsed) return null

  const { homeOdd, awayOdd } = parsed

  if (homeOdd <= awayOdd && homeOdd <= maxOdd) {
    return { team: home, odd: homeOdd }
  }

  if (awayOdd < homeOdd && awayOdd <= maxOdd) {
    return { team: away, odd: awayOdd }
  }

  return null
}

function dedupeMatches(matches: AppMatch[]) {
  const map = new Map<string, AppMatch>()

  for (const match of matches) {
    const key = `${match.fixtureId}-${match.type}`
    if (!map.has(key)) {
      map.set(key, match)
    }
  }

  return Array.from(map.values()).sort((a, b) => b.minute - a.minute)
}

function buildCachedResponse(
  matches: AppMatch[],
  live: number,
  checked: number,
  rawFixtures: number,
  cached: boolean,
  cacheAgeSec: number,
  totalCandidates: number,
  batchStart: number,
  batchEnd: number
): CachePayload {
  return {
    matches,
    debug: {
      live,
      checked,
      results: matches.length,
      rawFixtures,
      cached,
      cacheAgeSec,
      generatedAt: new Date().toISOString(),
      totalCandidates,
      batchStart,
      batchEnd,
      version: 'batch-v2',
    },
  }
}

function rotateBatch<T>(items: T[], start: number, size: number) {
  if (items.length === 0) {
    return {
      batch: [] as T[],
      nextCursor: 0,
      batchStart: 0,
      batchEnd: 0,
    }
  }

  const normalizedStart = start % items.length
  const batch: T[] = []

  for (let i = 0; i < Math.min(size, items.length); i++) {
    batch.push(items[(normalizedStart + i) % items.length])
  }

  const nextCursor = (normalizedStart + batch.length) % items.length
  const batchStart = normalizedStart + 1
  const batchEnd = normalizedStart + batch.length

  return { batch, nextCursor, batchStart, batchEnd }
}

export async function GET() {
  try {
    const now = Date.now()
    const existingCache = globalThis.importCache

    if (existingCache && now - existingCache.timestamp < CACHE_TTL_MS) {
      const ageSec = Math.floor((now - existingCache.timestamp) / 1000)

      return NextResponse.json({
        ...existingCache.payload,
        debug: {
          ...existingCache.payload.debug,
          cached: true,
          cacheAgeSec: ageSec,
        },
      })
    }

    const live = await apiFetch('/fixtures?live=all')
    const rawFixtures = live?.response || []
    const fixtures = rawFixtures.filter((f: any) => isReallyLive(f))

    const candidates = fixtures
      .map((f: any) => {
        const { homeGoals, awayGoals, score } = parseScore(f)

        const minute = getMinute(f)
        const home = f?.teams?.home?.name || 'Home'
        const away = f?.teams?.away?.name || 'Away'
        const redCard = extractRedCard(f, home, away)

        let priority = 0

        if (homeGoals !== awayGoals) priority += 3
        if (minute >= 60) priority += 3
        if (redCard) priority += 4
        if (minute >= 75) priority += 2
        if (minute >= 15 && homeGoals !== awayGoals) priority += 1

        return {
          id: f?.fixture?.id,
          league: f?.league?.name || 'Nieznana liga',
          home,
          away,
          minute,
          score,
          homeGoals,
          awayGoals,
          redCard,
          priority,
        }
      })
      .filter((c: any) => !!c.id)
      .sort((a: any, b: any) => {
        if (b.priority !== a.priority) return b.priority - a.priority
        return b.minute - a.minute
      })

    const currentCursor = globalThis.oddsScanState?.cursor || 0

    const { batch: oddsCandidates, nextCursor, batchStart, batchEnd } =
      rotateBatch(candidates, currentCursor, MAX_ODDS_REQUESTS)

    globalThis.oddsScanState = { cursor: nextCursor }

    const matches: AppMatch[] = []

    for (const c of oddsCandidates) {
      await WAIT(250)

      let odds = null
      try {
        odds = await apiFetch(`/odds?fixture=${c.id}`)
      } catch (e: any) {
        odds = null
      }

      if (!odds) continue

      const fav15 = extractFavoriteWithMax(odds, c.home, c.away, 1.5)
      const fav22 = extractFavoriteWithMax(odds, c.home, c.away, 2.2)

      if (fav15) {
        const favoriteIsHome = fav15.team === c.home
        const favoriteGoals = favoriteIsHome ? c.homeGoals : c.awayGoals
        const opponentGoals = favoriteIsHome ? c.awayGoals : c.homeGoals

        const losing = favoriteGoals < opponentGoals
        const drawingOrLosingAfter60 =
          c.minute >= 60 && favoriteGoals <= opponentGoals

        if (losing) {
          matches.push({
            fixtureId: c.id,
            league: c.league,
            home: c.home,
            away: c.away,
            minute: c.minute,
            score: c.score,
            favorite: fav15.team,
            odds: fav15.odd,
            redCard: c.redCard,
            type: 'fav_losing_15',
          })
        }

        if (drawingOrLosingAfter60) {
          matches.push({
            fixtureId: c.id,
            league: c.league,
            home: c.home,
            away: c.away,
            minute: c.minute,
            score: c.score,
            favorite: fav15.team,
            odds: fav15.odd,
            redCard: c.redCard,
            type: 'fav_not_winning_15_60',
          })
        }
      }

      if (fav22 && c.redCard) {
        const favoriteIsHome = fav22.team === c.home
        const favoriteGoals = favoriteIsHome ? c.homeGoals : c.awayGoals
        const opponentGoals = favoriteIsHome ? c.awayGoals : c.homeGoals

        const favoriteDrawingOrLosing = favoriteGoals <= opponentGoals
        const redOnOpponent =
          (favoriteIsHome && c.redCard === c.away) ||
          (!favoriteIsHome && c.redCard === c.home)

        if (favoriteDrawingOrLosing && redOnOpponent) {
          matches.push({
            fixtureId: c.id,
            league: c.league,
            home: c.home,
            away: c.away,
            minute: c.minute,
            score: c.score,
            favorite: fav22.team,
            odds: fav22.odd,
            redCard: c.redCard,
            type: 'fav_not_winning_22_red',
          })
        }
      }
    }

    const finalMatches = dedupeMatches(matches)

    const payload = buildCachedResponse(
      finalMatches,
      fixtures.length,
      oddsCandidates.length,
      rawFixtures.length,
      false,
      0,
      candidates.length,
      batchStart,
      batchEnd
    )

    globalThis.importCache = {
      timestamp: now,
      payload,
    }

    return NextResponse.json(payload)
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Import failed' },
      { status: 500 }
    )
  }
}