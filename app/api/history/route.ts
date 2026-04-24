import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null

export async function GET() {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: 'Brak SUPABASE_URL albo SUPABASE_SERVICE_ROLE_KEY' },
        { status: 500 }
      )
    }

    const { data: runs, error: runsError } = await supabase
      .from('screening_runs')
      .select('id, created_at, source, live_count, checked_count, results_count')
      .order('created_at', { ascending: false })
      .limit(30)

    if (runsError) {
      throw runsError
    }

    const runIds = (runs || []).map((r) => r.id)

    let matches: any[] = []

    if (runIds.length > 0) {
      const { data: matchRows, error: matchesError } = await supabase
        .from('screening_matches')
        .select(
          'id, run_id, fixture_id, league, home, away, minute, score, favorite, odds, type, red_card, shots_favorite, shots_opponent, shots_diff, created_at'
        )
        .in('run_id', runIds)
        .order('created_at', { ascending: false })

      if (matchesError) {
        throw matchesError
      }

      matches = matchRows || []
    }

    const runsWithMatches = (runs || []).map((run) => ({
      ...run,
      matches: matches.filter((m) => m.run_id === run.id),
    }))

    return NextResponse.json({
      runs: runsWithMatches,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Nie udało się pobrać historii' },
      { status: 500 }
    )
  }
}