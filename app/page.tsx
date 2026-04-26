'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import PushControls from '@/components/PushControls'

type MatchType =
  | 'fav_losing_15'
  | 'fav_not_winning_15_60'
  | 'fav_not_winning_22_red'
  | 'fav_18_not_winning_shots_7'

type Match = {
  fixtureId?: number
  league: string
  home: string
  away: string
  minute: number
  score: string
  favorite: string
  odds: number
  redCard: string | null
  type: MatchType
  isNew?: boolean
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

type HistoryMatch = {
  id: string
  run_id: string
  fixture_id: number
  league: string
  home: string
  away: string
  minute: number
  score: string
  favorite: string
  odds: number
  type: MatchType
  red_card: string | null
  shots_favorite?: number | null
  shots_opponent?: number | null
  shots_diff?: number | null
  final_score?: string | null
  final_home_goals?: number | null
  final_away_goals?: number | null
  final_status?: string | null
  outcome?: 'pending' | 'hit' | 'miss' | 'unknown' | null
  checked_at?: string | null
  created_at: string
  favorite_rank?: number | null
  favorite_points?: number | null
  favorite_goals_for?: number | null
  favorite_goals_against?: number | null
  opponent_rank?: number | null
  opponent_points?: number | null
  opponent_goals_for?: number | null
  opponent_goals_against?: number | null
  favorite_form?: string | null
  opponent_form?: string | null
  live_odd?: number | null
}

type DebugInfo = {
  live?: number
  checked?: number
  results?: number
  rawFixtures?: number
  cached?: boolean
  cacheAgeSec?: number
  generatedAt?: string
  totalCandidates?: number
  batchStart?: number
  batchEnd?: number
  version?: string
}

type ResultsSummary = {
  checked: number
  updated: number
  skipped: number
  updatedRows?: any[]
  skippedRows?: any[]
}

type TypeStats = {
  type: MatchType | string
  total: number
  hit: number
  miss: number
  pending: number
  unknown: number
  hitRate: number
  matches: HistoryMatch[]
}

const AUTO_REFRESH_OPTIONS = [30, 60, 120, 300]

export default function Home() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(false)
  const [checkingResults, setCheckingResults] = useState(false)
  const [statsLoading, setStatsLoading] = useState(false)

  const [error, setError] = useState('')
  const [statsError, setStatsError] = useState('')
  const [lastImport, setLastImport] = useState<string | null>(null)
  const [debug, setDebug] = useState<DebugInfo | null>(null)
  const [resultsSummary, setResultsSummary] = useState<ResultsSummary | null>(null)

  const [stats, setStats] = useState<TypeStats[]>([])
  const [selectedStatsType, setSelectedStatsType] = useState<string | null>(null)

  const [minMinute, setMinMinute] = useState('0')
  const [maxMinute, setMaxMinute] = useState('75')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshSeconds, setRefreshSeconds] = useState(60)
  const [browserAlerts, setBrowserAlerts] = useState(false)

  const [alertText, setAlertText] = useState('')
  const [newMatchesCount, setNewMatchesCount] = useState(0)

  const seenIdsRef = useRef<Set<string>>(new Set())
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null)
  const newBadgeTimerRef = useRef<NodeJS.Timeout | null>(null)

  const numericMinMinute = Number(minMinute) || 0
  const numericMaxMinute = Number(maxMinute) || 90

  const filteredMatches = useMemo(() => {
    return matches
      .filter((m) => m.minute >= numericMinMinute && m.minute <= numericMaxMinute)
      .sort((a, b) => b.minute - a.minute)
  }, [matches, numericMinMinute, numericMaxMinute])

  const favLosing15 = filteredMatches.filter((m) => m.type === 'fav_losing_15')
  const favNotWinning1560 = filteredMatches.filter(
    (m) => m.type === 'fav_not_winning_15_60'
  )
  const favNotWinning22Red = filteredMatches.filter(
    (m) => m.type === 'fav_not_winning_22_red'
  )
  const favShots7 = filteredMatches.filter((m) => m.type === 'fav_18_not_winning_shots_7')

  const selectedStats = stats.find((s) => s.type === selectedStatsType) || null

  const formatDateTime = (value: string) => {
    try {
      return new Date(value).toLocaleString('pl-PL')
    } catch {
      return value
    }
  }

  const typeLabel = (type: MatchType | string) => {
    if (type === 'fav_losing_15') return 'Faworyt do 1.50 przegrywa'
    if (type === 'fav_not_winning_15_60')
      return "Faworyt do 1.50 nie wygrywa po 60'"
    if (type === 'fav_not_winning_22_red')
      return 'Faworyt do 2.20 + czerwona kartka przeciwnika'
    if (type === 'fav_18_not_winning_shots_7')
      return 'Faworyt ≤1.80 nie wygrywa + strzały ≥ 7'
    return String(type)
  }

  const getOpponentName = (home: string, away: string, favorite: string) => {
    return favorite === home ? away : home
  }

  const outcomeLabel = (outcome?: string | null) => {
    if (outcome === 'hit') return 'HIT ✅'
    if (outcome === 'miss') return 'MISS ❌'
    if (outcome === 'pending') return 'PENDING ⏳'
    if (outcome === 'unknown') return 'UNKNOWN'
    return 'PENDING ⏳'
  }

  const outcomeClass = (outcome?: string | null) => {
    if (outcome === 'hit') return 'text-green-700 bg-green-50 border-green-200'
    if (outcome === 'miss') return 'text-red-700 bg-red-50 border-red-200'
    if (outcome === 'unknown') return 'text-gray-700 bg-gray-50 border-gray-200'
    return 'text-yellow-700 bg-yellow-50 border-yellow-200'
  }

  const hitRateClass = (hitRate: number) => {
    if (hitRate >= 70) return 'text-green-700'
    if (hitRate >= 50) return 'text-yellow-700'
    return 'text-red-700'
  }

  const playBeep = () => {
    try {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext
      if (!AudioContextClass) return

      const ctx = new AudioContextClass()
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.value = 880
      gain.gain.value = 0.03

      oscillator.connect(gain)
      gain.connect(ctx.destination)

      oscillator.start()
      oscillator.stop(ctx.currentTime + 0.2)
    } catch {}
  }

  const showBrowserNotification = (title: string, body: string) => {
    if (!browserAlerts) return
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') return

    try {
      new Notification(title, { body })
    } catch {}
  }

  const showInlineAlert = (text: string, count: number) => {
    setAlertText(text)
    setNewMatchesCount(count)

    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
    }

    dismissTimerRef.current = setTimeout(() => {
      setAlertText('')
      setNewMatchesCount(0)
    }, 10000)
  }

  const requestNotificationPermission = async () => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) {
      setError('Ta przeglądarka nie obsługuje powiadomień.')
      return
    }

    const permission = await Notification.requestPermission()
    setBrowserAlerts(permission === 'granted')
  }

  const loadStats = async () => {
    try {
      setStatsLoading(true)
      setStatsError('')

      const res = await fetch('/api/stats', {
        cache: 'no-store',
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Nie udało się pobrać statystyk')
      }

      const nextStats: TypeStats[] = data.stats || []
      setStats(nextStats)

      if (!selectedStatsType && nextStats.length > 0) {
        setSelectedStatsType(String(nextStats[0].type))
      }
    } catch (err: any) {
      setStatsError(err.message || 'Błąd statystyk')
    } finally {
      setStatsLoading(false)
    }
  }

  const handleCheckResults = async () => {
    try {
      setCheckingResults(true)
      setError('')

      const res = await fetch('/api/results/check', {
        cache: 'no-store',
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Błąd sprawdzania wyników')
      }

      setResultsSummary(data)
      await loadStats()
    } catch (err: any) {
      setError(err.message || 'Błąd check results')
    } finally {
      setCheckingResults(false)
    }
  }

  const runImport = async (silent = false) => {
    if (loading) return

    try {
      setLoading(true)
      if (!silent) setError('')

      const res = await fetch('/api/import', {
        cache: 'no-store',
      })

      const text = await res.text()

      let data: any
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(text || 'Nie udało się odczytać odpowiedzi z backendu')
      }

      if (!res.ok) {
        throw new Error(data.error || 'Błąd importu')
      }

      const rawImportedMatches: Match[] = data.matches || []
      setDebug(data.debug || null)
      setLastImport(new Date().toLocaleTimeString())

      const previousIds = seenIdsRef.current
      const newlyAdded = rawImportedMatches.filter(
        (m) => !previousIds.has(`${m.fixtureId}-${m.type}`)
      )

      const currentIds = new Set<string>([
        ...Array.from(previousIds),
        ...rawImportedMatches.map((m) => `${m.fixtureId}-${m.type}`),
      ])

      const importedMatchesWithFlags: Match[] = rawImportedMatches.map((m) => ({
        ...m,
        isNew: newlyAdded.some(
          (n) => `${n.fixtureId}-${n.type}` === `${m.fixtureId}-${m.type}`
        ),
      }))

      setMatches((prev) => {
        const map = new Map<string, Match>()

        for (const m of prev) {
          map.set(`${m.fixtureId}-${m.type}`, m)
        }

        for (const m of importedMatchesWithFlags) {
          map.set(`${m.fixtureId}-${m.type}`, m)
        }

        return Array.from(map.values())
      })

      if (previousIds.size > 0 && newlyAdded.length > 0) {
        const first = newlyAdded[0]
        const text = `Nowe typy: ${newlyAdded.length}. ${first.home} vs ${first.away}, ${first.minute}', kurs ${first.odds}.`

        showInlineAlert(text, newlyAdded.length)
        playBeep()
        showBrowserNotification('Nowe typy', text)
      }

      seenIdsRef.current = currentIds

      if (newBadgeTimerRef.current) {
        clearTimeout(newBadgeTimerRef.current)
      }

      newBadgeTimerRef.current = setTimeout(() => {
        setMatches((prev) => prev.map((m) => ({ ...m, isNew: false })))
      }, 10000)

      await loadStats()
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Błąd fetch')
      if (!silent) {
        setDebug(null)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    await runImport(false)
  }

  const handleClear = () => {
    setMatches([])
    setError('')
    setLastImport(null)
    setDebug(null)
    setResultsSummary(null)
    setAlertText('')
    setNewMatchesCount(0)
    seenIdsRef.current = new Set()

    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
    }

    if (newBadgeTimerRef.current) {
      clearTimeout(newBadgeTimerRef.current)
    }
  }

  useEffect(() => {
    loadStats()
  }, [])

  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }

    intervalRef.current = setInterval(() => {
      runImport(true)
    }, refreshSeconds * 1000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [autoRefresh, refreshSeconds])

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current)
      }
      if (newBadgeTimerRef.current) {
        clearTimeout(newBadgeTimerRef.current)
      }
    }
  }, [])

  const ContextBlock = ({
    favorite,
    opponent,
    favoriteRank,
    favoritePoints,
    favoriteGoalsFor,
    favoriteGoalsAgainst,
    opponentRank,
    opponentPoints,
    opponentGoalsFor,
    opponentGoalsAgainst,
    favoriteForm,
    opponentForm,
    liveOdd,
  }: {
    favorite: string
    opponent: string
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
  }) => {
    const hasTable = favoriteRank || opponentRank
    const hasForm = favoriteForm || opponentForm
    const hasLiveOdd = liveOdd !== undefined && liveOdd !== null

    if (!hasTable && !hasForm && !hasLiveOdd) return null

    return (
      <div className="mt-2 border rounded-xl p-3 bg-gray-50">
        <div className="font-semibold text-sm mb-2">Kontekst meczu</div>

        {hasLiveOdd && (
          <div>
            Kurs live faworyta: <b>{liveOdd}</b>
          </div>
        )}

        {hasTable && (
          <div className="grid gap-1 mt-2">
            {favoriteRank && (
              <div>
                <b>{favorite}</b>: {favoriteRank}. miejsce, {favoritePoints ?? '-'} pkt,
                bramki {favoriteGoalsFor ?? '-'}:{favoriteGoalsAgainst ?? '-'}
              </div>
            )}

            {opponentRank && (
              <div>
                <b>{opponent}</b>: {opponentRank}. miejsce, {opponentPoints ?? '-'} pkt,
                bramki {opponentGoalsFor ?? '-'}:{opponentGoalsAgainst ?? '-'}
              </div>
            )}
          </div>
        )}

        {hasForm && (
          <div className="mt-2">
            Forma: <b>{favoriteForm ?? '-'}</b> vs <b>{opponentForm ?? '-'}</b>
          </div>
        )}
      </div>
    )
  }

  const MatchCard = ({
    match,
    variant,
  }: {
    match: Match
    variant: 'losing15' | 'notWinning1560' | 'notWinning22Red' | 'shots7'
  }) => {
    const opponent = getOpponentName(match.home, match.away, match.favorite)

    return (
      <div className="bg-white border rounded-2xl p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-semibold text-lg">
                {match.home} vs {match.away}
              </div>

              {match.isNew && (
                <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-1 rounded-full">
                  NOWY
                </span>
              )}
            </div>

            <div className="text-sm text-gray-500">{match.league}</div>
          </div>

          <div className="text-sm font-semibold bg-gray-100 px-3 py-1 rounded-full whitespace-nowrap">
            {match.minute}'
          </div>
        </div>

        <div className="mt-4 grid gap-2 text-sm">
          <div>
            Wynik: <b>{match.score}</b>
          </div>
          <div>
            Faworyt: <b>{match.favorite}</b> ({match.odds})
          </div>

          <ContextBlock
            favorite={match.favorite}
            opponent={opponent}
            favoriteRank={match.favoriteRank}
            favoritePoints={match.favoritePoints}
            favoriteGoalsFor={match.favoriteGoalsFor}
            favoriteGoalsAgainst={match.favoriteGoalsAgainst}
            opponentRank={match.opponentRank}
            opponentPoints={match.opponentPoints}
            opponentGoalsFor={match.opponentGoalsFor}
            opponentGoalsAgainst={match.opponentGoalsAgainst}
            favoriteForm={match.favoriteForm}
            opponentForm={match.opponentForm}
            liveOdd={match.liveOdd}
          />

          {variant === 'losing15' && (
            <div className="text-red-700 font-medium">
              Faworyt do 1.50 przegrywa
            </div>
          )}

          {variant === 'notWinning1560' && (
            <div className="text-yellow-700 font-medium">
              Faworyt do 1.50 remisuje lub przegrywa po 60 minucie
            </div>
          )}

          {variant === 'notWinning22Red' && (
            <div className="text-orange-700 font-medium">
              Faworyt do 2.20 remisuje lub przegrywa, a przeciwnik ma czerwoną kartkę
            </div>
          )}

          {variant === 'shots7' && (
            <div className="text-green-700 font-medium">
              Faworyt ≤1.80 nie wygrywa + strzały ≥ 7
            </div>
          )}

          {match.shotsDiff !== undefined && match.shotsDiff !== null && (
            <div>
              Strzały: <b>{match.shotsFavorite}</b> vs{' '}
              <b>{match.shotsOpponent}</b> (różnica: {match.shotsDiff})
            </div>
          )}

          {match.redCard && (
            <div className="text-red-700">
              Czerwona kartka: <b>{match.redCard}</b>
            </div>
          )}
        </div>
      </div>
    )
  }

  const HistoryMatchCard = ({ m }: { m: HistoryMatch }) => {
    const opponent = getOpponentName(m.home, m.away, m.favorite)

    return (
      <div className="border rounded-xl p-4 bg-white">
        <div className="flex justify-between gap-3">
          <div>
            <div className="font-semibold">
              {m.home} vs {m.away}
            </div>
            <div className="text-sm text-gray-500">{m.league}</div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="text-sm font-semibold bg-gray-100 px-3 py-1 rounded-full h-fit">
              {m.minute}'
            </div>
            <div
              className={`text-xs font-bold border px-2 py-1 rounded-full ${outcomeClass(
                m.outcome
              )}`}
            >
              {outcomeLabel(m.outcome)}
            </div>
          </div>
        </div>

        <div className="grid gap-1 mt-3 text-sm">
          <div>
            Wynik przy imporcie/live: <b>{m.score}</b>
          </div>
          {m.final_score ? (
            <div>
              Wynik końcowy: <b>{m.final_score}</b>
            </div>
          ) : (
            <div className="text-gray-500">Wynik końcowy: jeszcze brak</div>
          )}
          <div>
            Faworyt: <b>{m.favorite}</b> ({m.odds})
          </div>

          <ContextBlock
            favorite={m.favorite}
            opponent={opponent}
            favoriteRank={m.favorite_rank}
            favoritePoints={m.favorite_points}
            favoriteGoalsFor={m.favorite_goals_for}
            favoriteGoalsAgainst={m.favorite_goals_against}
            opponentRank={m.opponent_rank}
            opponentPoints={m.opponent_points}
            opponentGoalsFor={m.opponent_goals_for}
            opponentGoalsAgainst={m.opponent_goals_against}
            favoriteForm={m.favorite_form}
            opponentForm={m.opponent_form}
            liveOdd={m.live_odd}
          />

          <div className="font-medium">{typeLabel(m.type)}</div>
          {m.shots_diff !== undefined && m.shots_diff !== null && (
            <div>
              Strzały: <b>{m.shots_favorite}</b> vs <b>{m.shots_opponent}</b>{' '}
              (różnica: {m.shots_diff})
            </div>
          )}
          {m.red_card && (
            <div className="text-red-700">
              Czerwona kartka: <b>{m.red_card}</b>
            </div>
          )}
          <div className="text-xs text-gray-500 mt-1">
            Znaleziono: {formatDateTime(m.created_at)}
          </div>
          {m.checked_at && (
            <div className="text-xs text-gray-500">
              Sprawdzone: {formatDateTime(m.checked_at)}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Live Favorit Alert</h1>
          <p className="text-gray-600 mt-2">
            Pokazuje 4 kategorie: faworyt do 1.50 przegrywa, faworyt do 1.50
            remisuje lub przegrywa po 60 minucie, faworyt do 2.20 remisuje lub
            przegrywa przy czerwonej kartce przeciwnika oraz faworyt do 1.50 z
            kursem do 1.80, który remisuje lub przegrywa i ma przewagę strzałów minimum 7.
          </p>
        </div>

        <div className="bg-white border rounded-3xl p-5 shadow-sm mb-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <div className="text-sm text-gray-500">Panel sterowania</div>
              <h2 className="text-xl font-bold mt-1">Live screening</h2>
              <div className="text-sm text-gray-600 mt-1">
                Uruchamiasz import ręcznie, sprawdzasz wyniki i filtrujesz typy po minucie meczu.
              </div>
            </div>

            <div className="text-right">
              <div className="text-xs text-gray-500">Ostatni import</div>
              <div className="font-bold text-lg">
                {lastImport || 'brak'}
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1 bg-gray-50 rounded-2xl p-4">
              <div className="font-semibold mb-3">Zakres minut typów</div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Minuta od
                  </label>
                  <select
                    value={minMinute}
                    onChange={(e) => setMinMinute(e.target.value)}
                    className="w-full border rounded-xl px-3 py-2 bg-white"
                  >
                    <option value="0">0</option>
                    <option value="15">15</option>
                    <option value="30">30</option>
                    <option value="45">45</option>
                    <option value="60">60</option>
                    <option value="70">70</option>
                    <option value="75">75</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Minuta do
                  </label>
                  <select
                    value={maxMinute}
                    onChange={(e) => setMaxMinute(e.target.value)}
                    className="w-full border rounded-xl px-3 py-2 bg-white"
                  >
                    <option value="45">45</option>
                    <option value="60">60</option>
                    <option value="70">70</option>
                    <option value="75">75</option>
                    <option value="80">80</option>
                    <option value="85">85</option>
                    <option value="90">90</option>
                    <option value="120">120</option>
                  </select>
                </div>
              </div>

              <div className="text-xs text-gray-500 mt-3">
                Aktualnie pokazujesz typy od <b>{numericMinMinute}'</b> do <b>{numericMaxMinute}'</b>.
              </div>
            </div>

            <div className="lg:col-span-2 bg-gray-50 rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="font-semibold">Akcje</div>
                  <div className="text-xs text-gray-500">
                    Import i sprawdzanie wyników uruchamiasz ręcznie.
                  </div>
                </div>

                <div className="text-xs">
                  Powiadomienia:{' '}
                  <b className={browserAlerts ? 'text-green-700' : 'text-red-700'}>
                    {browserAlerts ? 'ON' : 'OFF'}
                  </b>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button
                  onClick={handleImport}
                  disabled={loading}
                  className="bg-black text-white px-5 py-3 rounded-xl font-semibold shadow-sm hover:scale-[1.02] transition disabled:opacity-50"
                >
                  {loading ? 'Importowanie...' : 'Import'}
                </button>

                <button
                  onClick={handleCheckResults}
                  disabled={checkingResults}
                  className="bg-white border px-5 py-3 rounded-xl font-semibold hover:bg-gray-100 transition disabled:opacity-50"
                >
                  {checkingResults ? 'Sprawdzanie...' : 'Sprawdź wyniki'}
                </button>

                <button
                  onClick={requestNotificationPermission}
                  className="bg-white border px-5 py-3 rounded-xl font-semibold hover:bg-gray-100 transition"
                >
                  {browserAlerts ? 'Powiadomienia ON' : 'Włącz powiadomienia'}
                </button>

                <button
                  onClick={handleClear}
                  disabled={loading || checkingResults}
                  className="bg-white border px-5 py-3 rounded-xl font-semibold hover:bg-gray-100 transition disabled:opacity-50"
                >
                  Wyczyść
                </button>
              </div>

              {debug && (
                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>Progress importu</span>
                    <span>
                      {debug.checked ?? 0} / {debug.live ?? 0} meczów
                    </span>
                  </div>

                  <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-black h-2 rounded-full"
                      style={{
                        width: `${
                          debug.live && debug.live > 0
                            ? Math.min(100, Math.round(((debug.checked ?? 0) / debug.live) * 100))
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div style={{ color: 'red', fontWeight: 'bold' }}>TEST PUSH</div>
          <PushControls />
        </div>

        {alertText && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl">
            <div className="font-semibold">Nowy alert</div>
            <div className="mt-1">{alertText}</div>
            <div className="text-sm mt-1">Nowe typy: {newMatchesCount}</div>
          </div>
        )}

        {resultsSummary && (
          <div className="mb-6 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-xl">
            <div className="font-semibold">Wyniki sprawdzone</div>
            <div className="text-sm mt-1">
              Sprawdzono: {resultsSummary.checked} | Zaktualizowano:{' '}
              {resultsSummary.updated} | Pominięto: {resultsSummary.skipped}
            </div>
          </div>
        )}

        {statsError && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">
            {statsError}
          </div>
        )}

        {debug && (
          <div className="bg-white border rounded-2xl p-4 shadow-sm mb-6">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="font-semibold">Podsumowanie importu</div>
                <div className="text-sm text-gray-500">
                  Prosty wynik ostatniego screeningu.
                </div>
              </div>
              {lastImport && (
                <div className="text-sm text-gray-500">
                  Ostatni import: {lastImport}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-gray-500">Mecze live</div>
                <div className="font-bold text-2xl">{debug.live ?? 0}</div>
              </div>

              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-gray-500">Przeanalizowane mecze</div>
                <div className="font-bold text-2xl">{debug.checked ?? 0}</div>
              </div>

              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-gray-500">Znalezione typy</div>
                <div className="font-bold text-2xl">{debug.results ?? 0}</div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl break-words">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-10">
          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="text-sm text-gray-500">Faworyt do 1.50 przegrywa</div>
            <div className="text-2xl font-bold mt-1">{favLosing15.length}</div>
          </div>
          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="text-sm text-gray-500">
              Faworyt do 1.50 nie wygrywa po 60'
            </div>
            <div className="text-2xl font-bold mt-1">
              {favNotWinning1560.length}
            </div>
          </div>
          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="text-sm text-gray-500">
              Faworyt do 2.20 + czerwona kartka przeciwnika
            </div>
            <div className="text-2xl font-bold mt-1">
              {favNotWinning22Red.length}
            </div>
          </div>
          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="text-sm text-gray-500">
              Faworyt ≤1.80 nie wygrywa + strzały ≥ 7
            </div>
            <div className="text-2xl font-bold mt-1">{favShots7.length}</div>
          </div>
          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="text-sm text-gray-500">Auto refresh</div>
            <div className="text-2xl font-bold mt-1">
              {autoRefresh ? `co ${refreshSeconds}s` : 'wyłączony'}
            </div>
          </div>
        </div>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">
            🔴 Faworyt do 1.50 przegrywa
          </h2>

          {favLosing15.length === 0 ? (
            <div className="bg-white border rounded-2xl p-4 text-gray-500">
              Brak danych
            </div>
          ) : (
            <div className="grid gap-4">
              {favLosing15.map((match, index) => (
                <MatchCard
                  key={`${match.fixtureId || index}-${match.type}`}
                  match={match}
                  variant="losing15"
                />
              ))}
            </div>
          )}
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">
            🟡 Faworyt do 1.50 remisuje lub przegrywa po 60 minucie
          </h2>

          {favNotWinning1560.length === 0 ? (
            <div className="bg-white border rounded-2xl p-4 text-gray-500">
              Brak danych
            </div>
          ) : (
            <div className="grid gap-4">
              {favNotWinning1560.map((match, index) => (
                <MatchCard
                  key={`${match.fixtureId || index}-${match.type}`}
                  match={match}
                  variant="notWinning1560"
                />
              ))}
            </div>
          )}
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">
            🟠 Faworyt do 2.20 remisuje lub przegrywa, a przeciwnik ma czerwoną kartkę
          </h2>

          {favNotWinning22Red.length === 0 ? (
            <div className="bg-white border rounded-2xl p-4 text-gray-500">
              Brak danych
            </div>
          ) : (
            <div className="grid gap-4">
              {favNotWinning22Red.map((match, index) => (
                <MatchCard
                  key={`${match.fixtureId || index}-${match.type}`}
                  match={match}
                  variant="notWinning22Red"
                />
              ))}
            </div>
          )}
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">
            🟢 Faworyt ≤1.80 nie wygrywa + strzały ≥ 7
          </h2>

          {favShots7.length === 0 ? (
            <div className="bg-white border rounded-2xl p-4 text-gray-500">
              Brak danych
            </div>
          ) : (
            <div className="grid gap-4">
              {favShots7.map((match, index) => (
                <MatchCard
                  key={`${match.fixtureId || index}-${match.type}`}
                  match={match}
                  variant="shots7"
                />
              ))}
            </div>
          )}
        </section>
<section className="mb-10 bg-white border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-2xl font-semibold">📊 Statystyki i historia kategorii</h2>
              <p className="text-sm text-gray-500 mt-1">
                Kliknij kategorię, żeby zobaczyć wszystkie historyczne mecze. Procent liczony tylko z HIT + MISS.
              </p>
            </div>

            <button
              onClick={loadStats}
              disabled={statsLoading}
              className="bg-white border px-4 py-2 rounded-xl font-semibold hover:bg-gray-50 disabled:opacity-50"
            >
              {statsLoading ? 'Ładowanie...' : 'Odśwież'}
            </button>
          </div>

          {stats.length === 0 ? (
            <div className="text-sm text-gray-500">
              Brak danych. Najpierw uruchom import albo sprawdź wyniki po zakończeniu meczów.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
              {stats.map((s) => (
                <button
                  key={s.type}
                  onClick={() => setSelectedStatsType(String(s.type))}
                  className={`text-left border rounded-xl p-4 hover:bg-gray-50 ${
                    selectedStatsType === s.type ? 'border-black bg-gray-50' : ''
                  }`}
                >
                  <div className="font-semibold">{typeLabel(s.type)}</div>

                  <div className="grid grid-cols-4 gap-2 mt-3 text-sm">
                    <div className="bg-gray-50 rounded-lg p-2">
                      <div className="text-gray-500">Total</div>
                      <div className="font-bold">{s.total}</div>
                    </div>
                    <div className="bg-green-50 rounded-lg p-2">
                      <div className="text-gray-500">Hit</div>
                      <div className="font-bold text-green-700">{s.hit}</div>
                    </div>
                    <div className="bg-red-50 rounded-lg p-2">
                      <div className="text-gray-500">Miss</div>
                      <div className="font-bold text-red-700">{s.miss}</div>
                    </div>
                    <div className="bg-yellow-50 rounded-lg p-2">
                      <div className="text-gray-500">Pend.</div>
                      <div className="font-bold text-yellow-700">{s.pending}</div>
                    </div>
                  </div>

                  <div className="mt-3 text-sm">
                    Skuteczność:{' '}
                    <b className={hitRateClass(s.hitRate)}>{s.hitRate}%</b>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedStats && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-xl font-semibold">
                    Historia: {typeLabel(selectedStats.type)}
                  </h3>
                  <p className="text-sm text-gray-500">
                    Wszystkie mecze tej kategorii, najnowsze na górze.
                  </p>
                </div>
                <div className="text-sm text-gray-500">
                  Rekordy: {selectedStats.matches.length}
                </div>
              </div>

              {selectedStats.matches.length === 0 ? (
                <div className="border rounded-xl p-4 text-gray-500">
                  Brak meczów w tej kategorii.
                </div>
              ) : (
                <div className="grid gap-3">
                  {selectedStats.matches.map((m) => (
                    <HistoryMatchCard key={m.id} m={m} />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        
      </div>
    </main>
  )
}
