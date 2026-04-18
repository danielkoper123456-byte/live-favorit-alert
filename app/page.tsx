'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type MatchType =
  | 'fav_losing_15'
  | 'fav_not_winning_15_60'
  | 'fav_not_winning_22_red'

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
}

type DebugInfo = {
  live?: number
  checked?: number
  results?: number
  rawFixtures?: number
  cached?: boolean
  cacheAgeSec?: number
  generatedAt?: string
}

const AUTO_REFRESH_OPTIONS = [30, 60, 120, 300]

export default function Home() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastImport, setLastImport] = useState<string | null>(null)
  const [debug, setDebug] = useState<DebugInfo | null>(null)

  const [minMinute, setMinMinute] = useState('0')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshSeconds, setRefreshSeconds] = useState(60)
  const [browserAlerts, setBrowserAlerts] = useState(false)

  const [alertText, setAlertText] = useState('')
  const [newMatchesCount, setNewMatchesCount] = useState(0)

  const seenIdsRef = useRef<Set<string>>(new Set())
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null)

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

  const debugLive = debug?.live ?? 0
  const debugChecked = debug?.checked ?? 0
  const debugResults = debug?.results ?? 0

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
    if (permission === 'granted') {
      setBrowserAlerts(true)
    } else {
      setBrowserAlerts(false)
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

      const importedMatches: Match[] = data.matches || []
      setMatches(importedMatches)
      setDebug(data.debug || null)
      setLastImport(new Date().toLocaleTimeString())

      const currentIds = new Set(
        importedMatches.map((m) => `${m.fixtureId}-${m.type}`)
      )

      const previousIds = seenIdsRef.current
      const newlyAdded = importedMatches.filter(
        (m) => !previousIds.has(`${m.fixtureId}-${m.type}`)
      )

      if (previousIds.size > 0 && newlyAdded.length > 0) {
        const first = newlyAdded[0]
        const text = `Nowe typy: ${newlyAdded.length}. ${first.home} vs ${first.away}, ${first.minute}', kurs ${first.odds}.`

        showInlineAlert(text, newlyAdded.length)
        playBeep()
        showBrowserNotification('Nowe typy', text)
      }

      seenIdsRef.current = currentIds
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Błąd fetch')
      if (!silent) {
        setMatches([])
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
    setAlertText('')
    setNewMatchesCount(0)
    seenIdsRef.current = new Set()
  }

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
    }
  }, [])

  const MatchCard = ({
    match,
    variant,
  }: {
    match: Match
    variant: 'losing15' | 'notWinning1560' | 'notWinning22Red'
  }) => (
    <div className="bg-white border rounded-2xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-lg">
            {match.home} vs {match.away}
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
            Pokazuje 3 kategorie: faworyt do 1.50 przegrywa, faworyt do 1.50
            remisuje lub przegrywa po 60 minucie, oraz faworyt do 2.20
            remisuje lub przegrywa przy czerwonej kartce przeciwnika.
          </p>
        </div>

        <div className="bg-white border rounded-2xl p-4 shadow-sm mb-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <div className="text-sm text-gray-500">Sterowanie</div>
              <div className="text-sm mt-1">
                Import pobiera aktualne mecze z backendu. Auto refresh działa w
                wybranym interwale.
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
                  onClick={handleClear}
                  disabled={loading}
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

        {alertText && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl">
            <div className="font-semibold">Nowy alert</div>
            <div className="mt-1">{alertText}</div>
            <div className="text-sm mt-1">Nowe typy: {newMatchesCount}</div>
          </div>
        )}

        {debug && (
          <div className="bg-white border rounded-2xl p-4 shadow-sm mb-6">
            <div className="font-semibold mb-3">Debug importu</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-gray-500">Live</div>
                <div className="font-bold text-lg">{debugLive}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-gray-500">Odds checked</div>
                <div className="font-bold text-lg">{debugChecked}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-gray-500">Results</div>
                <div className="font-bold text-lg">{debugResults}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-gray-500">Cache</div>
                <div className="font-bold text-lg">
                  {debug.cached ? 'Tak' : 'Nie'}
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-gray-500">Wiek cache</div>
                <div className="font-bold text-lg">
                  {debug.cacheAgeSec ?? 0}s
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

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-10">
          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="text-sm text-gray-500">Faworyt do 1.50 przegrywa</div>
            <div className="text-2xl font-bold mt-1">{favLosing15.length}</div>
          </div>
          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="text-sm text-gray-500">
              Faworyt do 1.50 nie wygrywa po 60'
            </div>
            <div className="text-2xl font-bold mt-1">{favNotWinning1560.length}</div>
          </div>
          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="text-sm text-gray-500">
              Faworyt do 2.20 + czerwona kartka przeciwnika
            </div>
            <div className="text-2xl font-bold mt-1">{favNotWinning22Red.length}</div>
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

        <section>
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
      </div>
    </main>
  )
}