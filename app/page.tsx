'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import PushControls from '@/components/PushControls'

type MatchType =
  | 'fav_losing_15'
  | 'fav_not_winning_15_60'
  | 'fav_not_winning_22_red'
  | 'fav_15_shots_7'

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
}

type HistoryRun = {
  id: string
  created_at: string
  source: string
  live_count: number
  checked_count: number
  results_count: number
  matches: HistoryMatch[]
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
  hitRate: number
}

const AUTO_REFRESH_OPTIONS = [30, 60, 120, 300]

export default function Home() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [checkingResults, setCheckingResults] = useState(false)
  const [statsLoading, setStatsLoading] = useState(false)

  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [statsError, setStatsError] = useState('')
  const [lastImport, setLastImport] = useState<string | null>(null)
  const [debug, setDebug] = useState<DebugInfo | null>(null)
  const [resultsSummary, setResultsSummary] = useState<ResultsSummary | null>(null)

  const [stats, setStats] = useState<TypeStats[]>([])
  const [historyRuns, setHistoryRuns] = useState<HistoryRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const [minMinute, setMinMinute] = useState('0')
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

  const filteredMatches = useMemo(() => {
    return matches
      .filter((m) => m.minute >= numericMinMinute)
      .sort((a, b) => b.minute - a.minute)
  }, [matches, numericMinMinute])

  const favLosing15 = filteredMatches.filter((m) => m.type === 'fav_losing_15')
  const favNotWinning1560 = filteredMatches.filter(
    (m) => m.type === 'fav_not_winning_15_60'
  )
  const favNotWinning22Red = filteredMatches.filter(
    (m) => m.type === 'fav_not_winning_22_red'
  )
  const favShots7 = filteredMatches.filter((m) => m.type === 'fav_15_shots_7')

  const selectedRun = historyRuns.find((r) => r.id === selectedRunId) || null

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
    if (type === 'fav_15_shots_7')
      return 'Faworyt ≤1.50 + przewaga strzałów ≥ 7'
    return String(type)
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

  const loadHistory = async () => {
    try {
      setHistoryLoading(true)
      setHistoryError('')

      const res = await fetch('/api/history', {
        cache: 'no-store',
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Nie udało się pobrać historii')
      }

      const runs: HistoryRun[] = data.runs || []
      setHistoryRuns(runs)

      if (!selectedRunId && runs.length > 0) {
        setSelectedRunId(runs[0].id)
      }
    } catch (err: any) {
      setHistoryError(err.message || 'Błąd historii')
    } finally {
      setHistoryLoading(false)
    }
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
      await loadHistory()
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

      await loadHistory()
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
    loadHistory()
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

  const MatchCard = ({
    match,
    variant,
  }: {
    match: Match
    variant: 'losing15' | 'notWinning1560' | 'notWinning22Red' | 'shots7'
  }) => (
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
            Faworyt ≤1.50 + przewaga strzałów ≥ 7
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

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Live Favorit Alert</h1>
          <p className="text-gray-600 mt-2">
            Pokazuje 4 kategorie: faworyt do 1.50 przegrywa, faworyt do 1.50
            remisuje lub przegrywa po 60 minucie, faworyt do 2.20 remisuje lub
            przegrywa przy czerwonej kartce przeciwnika oraz faworyt do 1.50 z
            przewagą strzałów minimum 7.
          </p>
        </div>

        <div className="bg-white border rounded-2xl p-4 shadow-sm mb-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <div className="text-sm text-gray-500">Sterowanie</div>
              <div className="text-sm mt-1">
                Import pobiera aktualne mecze z backendu. Auto refresh możesz
                zostawić wyłączony i uruchamiać import ręcznie.
              </div>

              {lastImport && (
                <div className="text-sm text-gray-500 mt-2">
                  Ostatni import: {lastImport}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <div className="grid sm:grid-cols-2 gap-3">
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
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Auto refresh
                  </label>
                  <select
                    value={refreshSeconds}
                    onChange={(e) => setRefreshSeconds(Number(e.target.value))}
                    className="w-full border rounded-xl px-3 py-2 bg-white"
                    disabled={!autoRefresh}
                  >
                    {AUTO_REFRESH_OPTIONS.map((sec) => (
                      <option key={sec} value={sec}>
                        co {sec}s
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="h-4 w-4"
                />
                Włącz automatyczne odświeżanie
              </label>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleImport}
                  disabled={loading}
                  className="bg-black text-white px-6 py-3 rounded-xl font-semibold disabled:opacity-50"
                >
                  {loading ? 'Importowanie...' : 'Import'}
                </button>

                <button
                  onClick={handleCheckResults}
                  disabled={checkingResults}
                  className="bg-white border px-6 py-3 rounded-xl font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  {checkingResults ? 'Sprawdzanie...' : 'Sprawdź wyniki'}
                </button>

                <button
                  onClick={loadStats}
                  disabled={statsLoading}
                  className="bg-white border px-6 py-3 rounded-xl font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  {statsLoading ? 'Ładowanie...' : 'Statystyki'}
                </button>

                <button
                  onClick={handleClear}
                  disabled={loading || checkingResults}
                  className="bg-white border px-6 py-3 rounded-xl font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  Wyczyść
                </button>

                <button
                  onClick={requestNotificationPermission}
                  className="bg-white border px-6 py-3 rounded-xl font-semibold hover:bg-gray-50"
                >
                  {browserAlerts ? 'Powiadomienia włączone' : 'Włącz powiadomienia'}
                </button>
              </div>
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

        <section className="mb-6 bg-white border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-2xl font-semibold">📊 Skuteczność typów</h2>
              <p className="text-sm text-gray-500 mt-1">
                Liczone tylko z rozliczonych rekordów: HIT + MISS. Pending nie wchodzi do procentu.
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
              Brak rozliczonych danych. Kliknij „Sprawdź wyniki” po zakończeniu meczów.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
              {stats.map((s) => (
                <div key={s.type} className="border rounded-xl p-4">
                  <div className="font-semibold">{typeLabel(s.type)}</div>

                  <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
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
                  </div>

                  <div className="mt-3 text-sm">
                    Skuteczność:{' '}
                    <b className={hitRateClass(s.hitRate)}>{s.hitRate}%</b>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {debug && (
          <div className="bg-white border rounded-2xl p-4 shadow-sm mb-6">
            <div className="font-semibold mb-3">Debug importu</div>

            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-gray-500">Live</div>
                <div className="font-bold text-lg">{debug.live ?? 0}</div>
              </div>

              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-gray-500">Odds checked</div>
                <div className="font-bold text-lg">{debug.checked ?? 0}</div>
              </div>

              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-gray-500">Results</div>
                <div className="font-bold text-lg">{debug.results ?? 0}</div>
              </div>

              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-gray-500">Cache</div>
                <div className="font-bold text-lg">
                  {debug.cached ? 'Tak' : 'Nie'}
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-gray-500">Wiek cache</div>
                <div className="font-bold text-lg">{debug.cacheAgeSec ?? 0}s</div>
              </div>

              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-gray-500">Wszystkie mecze</div>
                <div className="font-bold text-lg">
                  {debug.totalCandidates ?? 0}
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 md:col-span-2">
                <div className="text-gray-500">Batch</div>
                <div className="font-bold text-lg">
                  {debug.batchStart ?? 0}-{debug.batchEnd ?? 0}
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 md:col-span-2">
                <div className="text-gray-500">Wersja</div>
                <div className="font-bold text-lg">
                  {debug.version ?? 'brak'}
                </div>
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
              Faworyt do 1.50 + strzały ≥ 7
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
            🟢 Faworyt ≤1.50 + przewaga strzałów ≥ 7
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

        <section className="mb-10">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-2xl font-semibold">📜 Historia importów</h2>
              <p className="text-sm text-gray-500 mt-1">
                Pokazuje zapisane screeningi z Supabase. To nie zużywa API-Football.
              </p>
            </div>

            <button
              onClick={loadHistory}
              disabled={historyLoading}
              className="bg-white border px-4 py-2 rounded-xl font-semibold hover:bg-gray-50 disabled:opacity-50"
            >
              {historyLoading ? 'Odświeżanie...' : 'Odśwież historię'}
            </button>
          </div>

          {historyError && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">
              {historyError}
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="bg-white border rounded-2xl p-4 shadow-sm lg:col-span-1">
              <div className="font-semibold mb-3">Importy</div>

              {historyRuns.length === 0 ? (
                <div className="text-sm text-gray-500">Brak historii</div>
              ) : (
                <div className="grid gap-2 max-h-[520px] overflow-auto pr-1">
                  {historyRuns.map((run) => (
                    <button
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                      className={`text-left border rounded-xl p-3 hover:bg-gray-50 ${
                        selectedRunId === run.id
                          ? 'border-black bg-gray-50'
                          : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="font-semibold text-sm">
                        {formatDateTime(run.created_at)}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Źródło: {run.source}
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                        <div>
                          <span className="text-gray-500">Live</span>
                          <div className="font-bold">{run.live_count}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Checked</span>
                          <div className="font-bold">{run.checked_count}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Typy</span>
                          <div className="font-bold">{run.results_count}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border rounded-2xl p-4 shadow-sm lg:col-span-2">
              <div className="font-semibold mb-3">Szczegóły importu</div>

              {!selectedRun ? (
                <div className="text-sm text-gray-500">
                  Wybierz import z listy.
                </div>
              ) : (
                <>
                  <div className="grid sm:grid-cols-4 gap-3 text-sm mb-4">
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="text-gray-500">Godzina</div>
                      <div className="font-bold">
                        {formatDateTime(selectedRun.created_at)}
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="text-gray-500">Live</div>
                      <div className="font-bold">{selectedRun.live_count}</div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="text-gray-500">Checked</div>
                      <div className="font-bold">{selectedRun.checked_count}</div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3">
                      <div className="text-gray-500">Typy</div>
                      <div className="font-bold">{selectedRun.results_count}</div>
                    </div>
                  </div>

                  {selectedRun.matches.length === 0 ? (
                    <div className="border rounded-xl p-4 text-gray-500">
                      W tym imporcie nie było typów.
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {selectedRun.matches.map((m) => (
                        <div key={m.id} className="border rounded-xl p-4">
                          <div className="flex justify-between gap-3">
                            <div>
                              <div className="font-semibold">
                                {m.home} vs {m.away}
                              </div>
                              <div className="text-sm text-gray-500">
                                {m.league}
                              </div>
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
                              Wynik przy imporcie: <b>{m.score}</b>
                            </div>
                            {m.final_score && (
                              <div>
                                Finalny wynik: <b>{m.final_score}</b>
                              </div>
                            )}
                            <div>
                              Faworyt: <b>{m.favorite}</b> ({m.odds})
                            </div>
                            <div className="font-medium">
                              {typeLabel(m.type)}
                            </div>
                            {m.shots_diff !== undefined &&
                              m.shots_diff !== null && (
                                <div>
                                  Strzały: <b>{m.shots_favorite}</b> vs{' '}
                                  <b>{m.shots_opponent}</b> (różnica:{' '}
                                  {m.shots_diff})
                                </div>
                              )}
                            {m.red_card && (
                              <div className="text-red-700">
                                Czerwona kartka: <b>{m.red_card}</b>
                              </div>
                            )}
                            {m.checked_at && (
                              <div className="text-xs text-gray-500 mt-1">
                                Sprawdzone: {formatDateTime(m.checked_at)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
