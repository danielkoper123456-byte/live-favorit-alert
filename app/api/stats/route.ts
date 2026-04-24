import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('screening_matches')
      .select('type, outcome')

    if (error) throw error

    const stats: Record<
      string,
      { total: number; hit: number; miss: number }
    > = {}

    for (const row of data || []) {
      if (!row.type) continue

      if (!stats[row.type]) {
        stats[row.type] = {
          total: 0,
          hit: 0,
          miss: 0,
        }
      }

      if (row.outcome === 'hit') {
        stats[row.type].hit += 1
        stats[row.type].total += 1
      }

      if (row.outcome === 'miss') {
        stats[row.type].miss += 1
        stats[row.type].total += 1
      }
    }

    const result = Object.entries(stats).map(([type, val]) => {
      const hitRate =
        val.total > 0 ? ((val.hit / val.total) * 100).toFixed(1) : '0'

      return {
        type,
        total: val.total,
        hit: val.hit,
        miss: val.miss,
        hitRate: Number(hitRate),
      }
    })

    return NextResponse.json({ stats: result })
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || 'stats error' },
      { status: 500 }
    )
  }
}