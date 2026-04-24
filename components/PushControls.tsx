'use client'

import { useEffect, useState } from 'react'
import { urlBase64ToUint8Array } from '@/lib/urlBase64ToUint8Array'

export default function PushControls() {
  const [supported, setSupported] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const init = async () => {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      ) {
        setSupported(false)
        return
      }

      setSupported(true)

      const registration = await navigator.serviceWorker.register('/sw.js')
      const sub = await registration.pushManager.getSubscription()
      setSubscribed(!!sub)
    }

    init().catch(() => {
      setSupported(false)
    })
  }, [])

  const subscribe = async () => {
    try {
      setBusy(true)
      setMessage('')

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setMessage(`Powiadomienia nie zostały zaakceptowane. permission=${permission}`)
        return
      }

      const registration = await navigator.serviceWorker.register('/sw.js')
      let subscription = await registration.pushManager.getSubscription()

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
          ),
        })
      }

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Nie udało się zapisać subskrypcji')
      }

      setSubscribed(true)
      setMessage('Powiadomienia push są włączone.')
    } catch (e: any) {
      setMessage(e?.message || 'Błąd subskrypcji')
    } finally {
      setBusy(false)
    }
  }

  const unsubscribe = async () => {
    try {
      setBusy(true)
      setMessage('')

      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()

      if (subscription) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })

        await subscription.unsubscribe()
      }

      setSubscribed(false)
      setMessage('Powiadomienia push zostały wyłączone.')
    } catch (e: any) {
      setMessage(e?.message || 'Błąd wyłączenia push')
    } finally {
      setBusy(false)
    }
  }

  const sendTest = async () => {
    try {
      setBusy(true)
      setMessage('')

      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Nie udało się wysłać testu')
      }

      setMessage('Wysłano test push.')
    } catch (e: any) {
      setMessage(e?.message || 'Błąd test push')
    } finally {
      setBusy(false)
    }
  }

  const sendAlerts = async () => {
    try {
      setBusy(true)
      setMessage('')

      const res = await fetch('/api/push/alerts', {
        method: 'POST',
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Nie udało się wysłać alertów')
      }

      setMessage(`Wysłano alerty: ${data.sent ?? 0}`)
    } catch (e: any) {
      setMessage(e?.message || 'Błąd wysyłki alertów')
    } finally {
      setBusy(false)
    }
  }

  if (!supported) {
    return (
      <div className="text-sm text-red-600">
        Ta przeglądarka nie obsługuje push.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {!subscribed ? (
          <button
            onClick={subscribe}
            disabled={busy}
            className="bg-black text-white px-6 py-3 rounded-xl font-semibold disabled:opacity-50"
          >
            Włącz push na telefon
          </button>
        ) : (
          <button
            onClick={unsubscribe}
            disabled={busy}
            className="bg-white border px-6 py-3 rounded-xl font-semibold disabled:opacity-50"
          >
            Wyłącz push
          </button>
        )}

        <button
          onClick={sendTest}
          disabled={busy || !subscribed}
          className="bg-white border px-6 py-3 rounded-xl font-semibold disabled:opacity-50"
        >
          Wyślij test push
        </button>

        <button
          onClick={sendAlerts}
          disabled={busy || !subscribed}
          className="bg-white border px-6 py-3 rounded-xl font-semibold disabled:opacity-50"
        >
          Wyślij alerty (realne)
        </button>
      </div>

      {message && <div className="text-sm text-gray-600">{message}</div>}
    </div>
  )
}