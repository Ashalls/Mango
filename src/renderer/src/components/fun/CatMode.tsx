import { useEffect } from 'react'

import meowSound from '../../../../../resources/sounds/meow.mp3'
import purrSound from '../../../../../resources/sounds/purr.mp3'
import hissSound from '../../../../../resources/sounds/hiss.mp3'

export function playPurr() {
  try {
    const audio = new Audio(purrSound)
    audio.volume = 0.3
    audio.play().catch(() => {})
  } catch {}
}

export function playHiss() {
  try {
    const audio = new Audio(hissSound)
    audio.volume = 0.3
    audio.play().catch(() => {})
  } catch {}
}

export function CatMode() {
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const audio = new Audio(meowSound)
        audio.volume = 0.4
        audio.play().catch(() => {})
      } catch {}
    }, 500)
    return () => clearTimeout(timer)
  }, [])

  return null
}
