import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type StatBucket = {
  type: string
  total: number
  hit: number
  miss: number
  pending: number
  unknown: number
  hitRate: number
  matches: any[]
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('screening_matches')
      .select(
        `
        id,
        run_id,
        fixture_id,
        league,
        home,
        away,
        minute,
        score,
        favorite,
        odds,
        type,
        red_card,
        shots_favorite,
        shots_opponent,
        shots_diff,
        final_score,
        final_home_goals,
        final_away_goals,
        final_status,
        outcome,
        checked_at,
        created_at,
        favorite_rank,
        favorite_points,
        favorite_goals_for,
        favorite_goals_against,
        opponent_rank,
        opponent_points,
        opponent_goals_for,
        opponent_goals_against,
        favorite_form,
        opponent_form,
        live_odd
      `
      )
      .order('created_at', { ascending: false })

    if (error) throw error

    const buckets: Record<string, StatBucket> = {}

    for (const row of data || []) {
      const type = row.type || 'unknown'

      if (!buckets[type]) {
        buckets[type] = {
          type,
          total: 0,
          hit: 0,
          miss: 0,
          pending: 0,
          unknown: 0,
          hitRate: 0,
          matches: [],
        }
      }

      const outcome = row.outcome || 'pending'

      if (outcome === 'hit') {
        buckets[type].hit += 1
        buckets[type].total += 1
      } else if (outcome === 'miss') {
        buckets[type].miss += 1
        buckets[type].total += 1
      } else if (outcome === 'unknown') {
        buckets[type].unknown += 1
      } else {
        buckets[type].pending += 1
      }

      buckets[type].matches.push(row)
    }

    const stats = Object.values(buckets).map((bucket) => {
      const settled = bucket.hit + bucket.miss
      const hitRate =
        settled > 0 ? Number(((bucket.hit / settled) * 100).toFixed(1)) : 0

      return {
        ...bucket,
        total: settled,
        hitRate,
      }
    })

    stats.sort((a, b) => {
      if (b.hitRate !== a.hitRate) return b.hitRate - a.hitRate
      return b.total - a.total
    })

    return NextResponse.json({ stats })
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || 'stats error' },
      { status: 500 }
    )
  }
}
