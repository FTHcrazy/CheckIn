import { useState, useEffect, useRef } from 'react'
import './index.scss'

interface NotifData {
  title: string
  body: string
  color: string
}

export default function NotifPage() {
  const [data, setData] = useState<NotifData | null>(null)
  const [visible, setVisible] = useState(false)
  const renderedRef = useRef(false)

  useEffect(() => {
    // 通知主进程 React 已挂载就绪
    window.electronAPI?.send('notif-ready', null)
    console.log('[NotifPage] 已就绪')

    // 监听主进程发来的通知数据
    window.electronAPI?.receive('notif-show', (notifData: unknown) => {
      const d = notifData as NotifData
      renderedRef.current = false
      setData(d)
      console.log('[NotifPage] 收到通知:', d)
    })
  }, [])

  // 数据更新后，等 DOM 渲染完成再通知主进程显示窗口
  useEffect(() => {
    if (data && !renderedRef.current) {
      renderedRef.current = true
      // 等两帧确保 DOM 渲染完毕
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true)
          window.electronAPI?.send('notif-rendered', null)
          console.log('[NotifPage] 渲染完毕，通知主进程显示窗口')
        })
      })
    }
  }, [data])

  const handleClose = () => {
    setVisible(false)
    // 退场动画结束后通知主进程隐藏窗口
    setTimeout(() => {
      window.electronAPI?.send('notif-hide', null)
    }, 300)
  }

  return (
    <div className="notif-page">
      {data && (
        <div
          className={`notif-toast ${visible ? 'show' : ''}`}
          style={{ borderLeftColor: data.color }}
          onClick={handleClose}
        >
          <div className="notif-title">{data.title}</div>
          <div className="notif-body">{data.body}</div>
          <div className="notif-hint">点击关闭</div>
        </div>
      )}
    </div>
  )
}
