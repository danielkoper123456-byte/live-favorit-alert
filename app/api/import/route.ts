import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const API_BASE = 'https://v3.football.api-sports.io'
const MAX_ODDS_REQUESTS = 100
const CACHE_TTL_MS = 20 * 1000

const WAIT = (ms: number) => new Promise((res) => setTimeout(res, ms))
const globalAny = globalThis as any

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null

type MatchType =
  | 'fav_losing_15'
  | 'fav_not_winning_15_60'
  | 'fav_not_winning_22_red'
  | 'fav_18_not_winning_shots_7'

type AppMatch = {
  fixtureId: number
  leagueId: number | null
  season: number | null
  homeTeamId: number | null
  awayTeamId: number | null
  league: string
  home: string
  away: string
  minute: number
  score: string
  favorite: string
  odds: number
  redCard: string | null
  type: MatchType
  shotsFavorite?: number | null
  shotsOpponent?: number | null
  shotsDiff?: number | null
  favoriteRank?: number | null
  favoritePoints?: number | null
  favoriteGoalsFor?: number | null
  favoriteGoalsAgainst?: number | null
  opponentRank?: number | null
  opponentPoints?: number | null
  opponentGoalsFor?: number | null
  opponentGoalsAgainst?: number | null
  favoriteForm?: string | null
  opponentForm?: string | null
  liveOdd?: number | null
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
  runId?: string | null
}

type CachePayload = {
  matches: AppMatch[]
  debug: DebugInfo
}

type Candidate = {
  id: number
  leagueId: number | null
  season: number | null
  homeTeamId: number | null
  awayTeamId: number | null
  league: string
  home: string
  away: string
  minute: number
  score: string
  homeGoals: number
  awayGoals: number
  redCard: string | null
  priority: number
}

type StandingInfo = {
  rank: number | null
  points: number | null
  goalsFor: number | null
  goalsAgainst: number | null
  form: string | null
}

type ShotsInfo = {
  homeShots: number
  awayShots: number
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

function extractRedCard(item: any, home: string, away: string): string | null {
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

  return String(team)
}

function get1X2Odds(odds: any): { homeOdd: number; awayOdd: number } | null {
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
): { team: string; odd: number } | null {
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

async function getShots(fixtureId: number): Promise<ShotsInfo | null> {
  globalAny.shotsCache = globalAny.shotsCache || {}

  if (globalAny.shotsCache[fixtureId]) {
    return globalAny.shotsCache[fixtureId] as ShotsInfo
  }

  try {
    const data = await apiFetch(`/fixtures/statistics?fixture=${fixtureId}`)
    const stats = data?.response

    if (!Array.isArray(stats) || stats.length < 2) return null

    const getVal = (arr: any[], name: string) => {
      const found = arr.find((s) => s.type === name)
      const raw = found?.value

      if (raw === null || raw === undefined) return 0
      if (typeof raw === 'number') return raw

      const parsed = Number(String(raw).replace('%', '').trim())
      return Number.isFinite(parsed) ? parsed : 0
    }

    const home = stats[0]
    const away = stats[1]

    const homeShots =
      getVal(home.statistics || [], 'Shots on Goal') +
      getVal(home.statistics || [], 'Shots off Goal')

    const awayShots =
      getVal(away.statistics || [], 'Shots on Goal') +
      getVal(away.statistics || [], 'Shots off Goal')

    const result = {
      homeShots,
      awayShots,
    }

    globalAny.shotsCache[fixtureId] = result
    return result
  } catch {
    return null
  }
}

function parseStandingRow(row: any): StandingInfo {
  return {
    rank: row?.rank ?? null,
    points: row?.points ?? null,
    goalsFor: row?.all?.goals?.for ?? null,
    goalsAgainst: row?.all?.goals?.against ?? null,
    form: row?.form ?? null,
  }
}

async function getStandingsMap(leagueId: number | null, season: number | null) {
  if (!leagueId || !season) return null

  const cacheKey = `${leagueId}-${season}`
  globalAny.standingsCache = globalAny.standingsCache || {}

  if (globalAny.standingsCache[cacheKey]) {
    return globalAny.standingsCache[cacheKey] as Map<number, StandingInfo>
  }

  try {
    const data = await apiFetch(`/standings?league=${leagueId}&season=${season}`)
    const standingsGroups = data?.response?.[0]?.league?.standings || []

    const map = new Map<number, StandingInfo>()

    for (const group of standingsGroups) {
      if (!Array.isArray(group)) continue

      for (const row of group) {
        const teamId = Number(row?.team?.id)
        if (!teamId) continue
        map.set(teamId, parseStandingRow(row))
      }
    }

    globalAny.standingsCache[cacheKey] = map
    return map
  } catch {
    return null
  }
}

async function getLiveOddForFavorite(
  fixtureId: number,
  favoriteIsHome: boolean
): Promise<number | null> {
  try {
    const data = await apiFetch(`/odds/live?fixture=${fixtureId}`)
    const response = data?.response || []

    if (!Array.isArray(response) || response.length === 0) return null

    const bets = response[0]?.bets || []
    if (!Array.isArray(bets) || bets.length === 0) return null

    const winnerBet = bets.find((b: any) => {
      const name = String(b?.name || '').toLowerCase()
      return (
        name.includes('match winner') ||
        name.includes('winner') ||
        name.includes('1x2')
      )
    })

    if (!winnerBet) return null

    const values = winnerBet?.values || []
    if (!Array.isArray(values)) return null

    for (const v of values) {
      const value = String(v?.value || '').toLowerCase()
      const odd = Number(v?.odd)

      if (!Number.isFinite(odd)) continue

      if (favoriteIsHome && (value === 'home' || value === '1')) {
        return odd
      }

      if (!favoriteIsHome && (value === 'away' || value === '2')) {
        return odd
      }
    }

    return null
  } catch {
    return null
  }
}

async function enrichMatch(match: AppMatch): Promise<AppMatch> {
  const favoriteIsHome = match.favorite === match.home

  const favoriteTeamId = favoriteIsHome ? match.homeTeamId : match.awayTeamId
  const opponentTeamId = favoriteIsHome ? match.awayTeamId : match.homeTeamId

  let favoriteStanding: StandingInfo | null = null
  let opponentStanding: StandingInfo | null = null

  const standingsMap = await getStandingsMap(match.leagueId, match.season)

  if (standingsMap) {
    if (favoriteTeamId) {
      favoriteStanding = standingsMap.get(favoriteTeamId) || null
    }

    if (opponentTeamId) {
      opponentStanding = standingsMap.get(opponentTeamId) || null
    }
  }

  const liveOdd = await getLiveOddForFavorite(match.fixtureId, favoriteIsHome)

  return {
    ...match,
    favoriteRank: favoriteStanding?.rank ?? null,
    favoritePoints: favoriteStanding?.points ?? null,
    favoriteGoalsFor: favoriteStanding?.goalsFor ?? null,
    favoriteGoalsAgainst: favoriteStanding?.goalsAgainst ?? null,
    opponentRank: opponentStanding?.rank ?? null,
    opponentPoints: opponentStanding?.points ?? null,
    opponentGoalsFor: opponentStanding?.goalsFor ?? null,
    opponentGoalsAgainst: opponentStanding?.goalsAgainst ?? null,
    favoriteForm: favoriteStanding?.form ?? null,
    opponentForm: opponentStanding?.form ?? null,
    liveOdd,
  }
}

async function enrichMatches(matches: AppMatch[]) {
  const enriched: AppMatch[] = []

  for (const match of matches) {
    await WAIT(200)
    enriched.push(await enrichMatch(match))
  }

  return enriched
}

async function addShotsToMatch(match: AppMatch): Promise<AppMatch> {
  const shots = await getShots(match.fixtureId)

  if (!shots) {
    return {
      ...match,
      shotsFavorite: match.shotsFavorite ?? null,
      shotsOpponent: match.shotsOpponent ?? null,
      shotsDiff: match.shotsDiff ?? null,
    }
  }

  const favoriteIsHome = match.favorite === match.home
  const favShots = favoriteIsHome ? shots.homeShots : shots.awayShots
  const oppShots = favoriteIsHome ? shots.awayShots : shots.homeShots
  const diff = favShots - oppShots

  return {
    ...match,
    shotsFavorite: favShots,
    shotsOpponent: oppShots,
    shotsDiff: diff,
  }
}

async function addShotsToAllMatches(matches: AppMatch[]) {
  const result: AppMatch[] = []

  for (const match of matches) {
    await WAIT(150)
    result.push(await addShotsToMatch(match))
  }

  return result
}

function dedupeMatches(matches: AppMatch[]): AppMatch[] {
  // Jeden mecz może spełnić kilka warunków.
  // Zostawiamy tylko najmocniejszą kategorię dla danego fixtureId.
  const priority: Record<string, number> = {
    fav_18_not_winning_shots_7: 4,
    fav_15_shots_7: 4,
    fav_not_winning_22_red: 3,
    fav_losing_15: 2,
    fav_not_winning_15_60: 1,
  }

  const map = new Map<number, AppMatch>()

  for (const match of matches) {
    const existing = map.get(match.fixtureId)

    if (!existing) {
      map.set(match.fixtureId, match)
      continue
    }

    const currentPriority = priority[match.type] ?? 0
    const existingPriority = priority[existing.type] ?? 0

    if (currentPriority > existingPriority) {
      map.set(match.fixtureId, match)
    }
  }

  return Array.from(map.values()).sort(
    (a: AppMatch, b: AppMatch) => b.minute - a.minute
  )
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
  batchEnd: number,
  runId: string | null
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
      version: 'full-screening-context-shots-18-not-winning-v1',
      runId,
    },
  }
}

async function createScreeningRun(source: 'manual' | 'cron') {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('screening_runs')
    .insert({
      source,
      live_count: 0,
      checked_count: 0,
      results_count: 0,
    })
    .select('id')
    .single()

  if (error) {
    console.error('createScreeningRun error:', error)
    return null
  }

  return data?.id || null
}

async function updateScreeningRun(
  runId: string | null,
  values: {
    live_count?: number
    checked_count?: number
    results_count?: number
  }
) {
  if (!supabase || !runId) return

  const { error } = await supabase
    .from('screening_runs')
    .update(values)
    .eq('id', runId)

  if (error) {
    console.error('updateScreeningRun error:', error)
  }
}

async function saveScreeningMatches(runId: string | null, matches: AppMatch[]) {
  if (!supabase || !runId || matches.length === 0) {
    return {
      inserted: 0,
      skippedDuplicates: 0,
    }
  }

  const { data: existing, error: fetchError } = await supabase
    .from('screening_matches')
    .select('fixture_id, type')
    .eq('outcome', 'pending')

  if (fetchError) {
    console.error('fetch existing pending matches error:', fetchError)

    return {
      inserted: 0,
      skippedDuplicates: 0,
    }
  }

  const existingSet = new Set(
    (existing || []).map((e) => `${e.fixture_id}-${e.type}`)
  )

  const newMatches = matches.filter(
    (m) => !existingSet.has(`${m.fixtureId}-${m.type}`)
  )

  if (newMatches.length === 0) {
    return {
      inserted: 0,
      skippedDuplicates: matches.length,
    }
  }

  const rows = newMatches.map((m) => ({
    run_id: runId,
    fixture_id: m.fixtureId,
    league: m.league,
    home: m.home,
    away: m.away,
    minute: m.minute,
    score: m.score,
    favorite: m.favorite,
    odds: m.odds,
    type: m.type,
    red_card: m.redCard,
    shots_favorite: m.shotsFavorite ?? null,
    shots_opponent: m.shotsOpponent ?? null,
    shots_diff: m.shotsDiff ?? null,
    favorite_rank: m.favoriteRank ?? null,
    favorite_points: m.favoritePoints ?? null,
    favorite_goals_for: m.favoriteGoalsFor ?? null,
    favorite_goals_against: m.favoriteGoalsAgainst ?? null,
    opponent_rank: m.opponentRank ?? null,
    opponent_points: m.opponentPoints ?? null,
    opponent_goals_for: m.opponentGoalsFor ?? null,
    opponent_goals_against: m.opponentGoalsAgainst ?? null,
    favorite_form: m.favoriteForm ?? null,
    opponent_form: m.opponentForm ?? null,
    live_odd: m.liveOdd ?? null,
  }))

  const { error } = await supabase.from('screening_matches').insert(rows)

  if (error) {
    console.error('saveScreeningMatches error:', error)

    return {
      inserted: 0,
      skippedDuplicates: matches.length - newMatches.length,
    }
  }

  return {
    inserted: rows.length,
    skippedDuplicates: matches.length - newMatches.length,
  }
}

function buildBaseMatch(
  c: Candidate,
  favorite: { team: string; odd: number },
  type: MatchType
): AppMatch {
  return {
    fixtureId: c.id,
    leagueId: c.leagueId,
    season: c.season,
    homeTeamId: c.homeTeamId,
    awayTeamId: c.awayTeamId,
    league: c.league,
    home: c.home,
    away: c.away,
    minute: c.minute,
    score: c.score,
    favorite: favorite.team,
    odds: favorite.odd,
    redCard: c.redCard,
    type,
    shotsFavorite: null,
    shotsOpponent: null,
    shotsDiff: null,
    favoriteRank: null,
    favoritePoints: null,
    favoriteGoalsFor: null,
    favoriteGoalsAgainst: null,
    opponentRank: null,
    opponentPoints: null,
    opponentGoalsFor: null,
    opponentGoalsAgainst: null,
    favoriteForm: null,
    opponentForm: null,
    liveOdd: null,
  }
}

export async function GET() {
  try {
    const now = Date.now()

    const existingCache = globalAny.importCache as
      | { timestamp: number; payload: CachePayload }
      | undefined

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

    const runId = await createScreeningRun('manual')

    const live = await apiFetch('/fixtures?live=all')
    const rawFixtures = Array.isArray(live?.response) ? live.response : []
    const fixtures = rawFixtures.filter((f: any) => isReallyLive(f))

    await updateScreeningRun(runId, {
      live_count: fixtures.length,
    })

    const mappedCandidates = fixtures.map((f: any): Candidate | null => {
      const fixtureId = Number(f?.fixture?.id)
      if (!fixtureId) return null

      const { homeGoals, awayGoals, score } = parseScore(f)
      const minute = getMinute(f)
      const home = String(f?.teams?.home?.name || 'Home')
      const away = String(f?.teams?.away?.name || 'Away')
      const redCard = extractRedCard(f, home, away)

      let priority = 0
      if (homeGoals !== awayGoals) priority += 3
      if (minute >= 60) priority += 3
      if (redCard) priority += 4
      if (minute >= 75) priority += 2
      if (minute >= 15 && homeGoals !== awayGoals) priority += 1

      return {
        id: fixtureId,
        leagueId: Number(f?.league?.id) || null,
        season: Number(f?.league?.season) || null,
        homeTeamId: Number(f?.teams?.home?.id) || null,
        awayTeamId: Number(f?.teams?.away?.id) || null,
        league: String(f?.league?.name || 'Nieznana liga'),
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

    const candidates: Candidate[] = mappedCandidates
      .filter((c: Candidate | null): c is Candidate => c !== null)
      .sort((a: Candidate, b: Candidate) => {
        if (b.priority !== a.priority) return b.priority - a.priority
        return b.minute - a.minute
      })

    const oddsCandidates = candidates.slice(0, MAX_ODDS_REQUESTS)
    const batchStart = oddsCandidates.length > 0 ? 1 : 0
    const batchEnd = oddsCandidates.length

    await updateScreeningRun(runId, {
      checked_count: oddsCandidates.length,
    })

    const matches: AppMatch[] = []

    for (const c of oddsCandidates) {
      await WAIT(250)

      let odds: any = null

      try {
        odds = await apiFetch(`/odds?fixture=${c.id}`)
      } catch {
        odds = null
      }

      if (!odds) continue

      const fav15 = extractFavoriteWithMax(odds, c.home, c.away, 1.5)
      const fav18 = extractFavoriteWithMax(odds, c.home, c.away, 1.8)
      const fav22 = extractFavoriteWithMax(odds, c.home, c.away, 2.2)

      let shots: ShotsInfo | null = null

      if (fav15 || fav18 || fav22) {
        await WAIT(150)
        shots = await getShots(c.id)
      }

      if (fav15) {
        const favoriteIsHome = fav15.team === c.home
        const favoriteGoals = favoriteIsHome ? c.homeGoals : c.awayGoals
        const opponentGoals = favoriteIsHome ? c.awayGoals : c.homeGoals

        const losing = favoriteGoals < opponentGoals
        const drawingOrLosingAfter60 =
          c.minute >= 60 && favoriteGoals <= opponentGoals

        if (losing) {
          matches.push(buildBaseMatch(c, fav15, 'fav_losing_15'))
        }

        if (drawingOrLosingAfter60) {
          matches.push(buildBaseMatch(c, fav15, 'fav_not_winning_15_60'))
        }
      }

      if (fav18 && shots) {
        const favoriteIsHome = fav18.team === c.home
        const favoriteGoals = favoriteIsHome ? c.homeGoals : c.awayGoals
        const opponentGoals = favoriteIsHome ? c.awayGoals : c.homeGoals
        const favoriteNotWinning = favoriteGoals <= opponentGoals

        const favShots = favoriteIsHome ? shots.homeShots : shots.awayShots
        const oppShots = favoriteIsHome ? shots.awayShots : shots.homeShots
        const diff = favShots - oppShots

        if (favoriteNotWinning && diff >= 7) {
          matches.push(buildBaseMatch(c, fav18, 'fav_18_not_winning_shots_7'))
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
          matches.push(buildBaseMatch(c, fav22, 'fav_not_winning_22_red'))
        }
      }
    }

    const finalMatches = dedupeMatches(matches)
    const withShots = await addShotsToAllMatches(finalMatches)
    const enrichedMatches = await enrichMatches(withShots)

    const saveResult = await saveScreeningMatches(runId, enrichedMatches)

    await updateScreeningRun(runId, {
      results_count: saveResult.inserted,
    })

    const payload = buildCachedResponse(
      enrichedMatches,
      fixtures.length,
      oddsCandidates.length,
      rawFixtures.length,
      false,
      0,
      candidates.length,
      batchStart,
      batchEnd,
      runId
    )

    payload.debug.results = enrichedMatches.length

    globalAny.importCache = {
      timestamp: now,
      payload,
    }

    return NextResponse.json({
      ...payload,
      save: saveResult,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Import failed' },
      { status: 500 }
    )
  }
}
