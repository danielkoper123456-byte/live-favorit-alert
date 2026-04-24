import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const API_BASE = 'https://v3.football.api-sports.io'
const WAIT = (ms: number) => new Promise((res) => setTimeout(res, ms))

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function apiFetch(path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'x-apisports-key': process.env.API_FOOTBALL_KEY || '',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }

  return res.json()
}

function decideOutcome(match: any, homeGoals: number, awayGoals: number) {
  const favorite = match.favorite
  const home = match.home
  const away = match.away

  const favoriteIsHome = favorite === home
  const favoriteGoals = favoriteIsHome ? homeGoals : awayGoals
  const opponentGoals = favoriteIsHome ? awayGoals : homeGoals

  if (match.type === 'fav_losing_15') {
    return favoriteGoals >= opponentGoals ? 'hit' : 'miss'
  }

  if (match.type === 'fav_not_winning_15_60') {
    return favoriteGoals > opponentGoals ? 'hit' : 'miss'
  }

  if (match.type === 'fav_not_winning_22_red') {
    return favoriteGoals > opponentGoals ? 'hit' : 'miss'
  }

  if (match.type === 'fav_15_shots_7') {
    return favoriteGoals > opponentGoals ? 'hit' : 'miss'
  }

  return 'unknown'
}

export async function GET() {
  try {
    const { data: pendingMatches, error } = await supabase
      .from('screening_matches')
      .select('*')
      .eq('outcome', 'pending')
      .limit(50)

    if (error) throw error

    const updated: any[] = []
    const skipped: any[] = []

    for (const match of pendingMatches || []) {
      await WAIT(250)

      const data = await apiFetch(`/fixtures?id=${match.fixture_id}`)
      const fixture = data?.response?.[0]

      if (!fixture) {
        skipped.push({
          id: match.id,
          reason: 'fixture_not_found',
        })
        continue
      }

      const status = String(fixture?.fixture?.status?.short || '').toUpperCase()

      const finishedStatuses = ['FT', 'AET', 'PEN']
      const homeGoals = Number(fixture?.goals?.home ?? 0)
      const awayGoals = Number(fixture?.goals?.away ?? 0)

      if (!finishedStatuses.includes(status)) {
        skipped.push({
          id: match.id,
          fixture_id: match.fixture_id,
          status,
          reason: 'not_finished',
        })
        continue
      }

      const outcome = decideOutcome(match, homeGoals, awayGoals)

      const finalScore = `${homeGoals}:${awayGoals}`

      const { error: updateError } = await supabase
        .from('screening_matches')
        .update({
          final_score: finalScore,
          final_home_goals: homeGoals,
          final_away_goals: awayGoals,
          final_status: status,
          outcome,
          checked_at: new Date().toISOString(),
        })
        .eq('id', match.id)

      if (updateError) {
        skipped.push({
          id: match.id,
          reason: updateError.message,
        })
        continue
      }

      updated.push({
        id: match.id,
        fixture_id: match.fixture_id,
        home: match.home,
        away: match.away,
        type: match.type,
        initial_score: match.score,
        final_score: finalScore,
        outcome,
      })
    }

    return NextResponse.json({
      checked: pendingMatches?.length || 0,
      updated: updated.length,
      skipped: skipped.length,
      updatedRows: updated,
      skippedRows: skipped,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Nie udało się sprawdzić wyników' },
      { status: 500 }
    )
  }
}