import { createElement, useEffect, useRef, useState } from 'react'
import { CLOSE_EVENT, OPEN_EVENT } from './workbench.js'

export function Entry() {
  const [active, setActive] = useState(false)
  const buttonRef = useRef(null)
  useEffect(() => {
    const open = () => setActive(true)
    const close = () => {
      setActive(false)
      buttonRef.current?.focus()
    }
    window.addEventListener(OPEN_EVENT, open)
    window.addEventListener(CLOSE_EVENT, close)
    return () => {
      window.removeEventListener(OPEN_EVENT, open)
      window.removeEventListener(CLOSE_EVENT, close)
    }
  }, [])
  return createElement(
    'button',
    {
      ref: buttonRef,
      className: 'ma-footer-entry',
      type: 'button',
      'data-active': active,
      title: active ? '收起多 Agent 协作验证' : '打开多 Agent 协作验证',
      onClick: () => window.dispatchEvent(new CustomEvent(active ? CLOSE_EVENT : OPEN_EVENT)),
    },
    createElement('span', { className: 'ma-footer-icon', 'aria-hidden': 'true' }, '✦'),
    createElement('span', { className: 'ma-footer-label' }, '多 Agent 验证'),
  )
}
