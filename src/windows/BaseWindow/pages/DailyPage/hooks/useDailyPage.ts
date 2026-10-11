import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Form } from 'antd'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import {
  getActivitiesByDate, getActiveDates, addActivity, updateActivity, deleteActivity,
  ACTIVITY_COLORS,
} from '@/shared/services/daily'
import { getCheckinDates } from '@/shared/services/checkin'
import type { Activity } from '@/shared/services/daily'

/** DailyPage 业务逻辑：日历/时间带派生数据、活动数据加载与增删改弹窗编排 */
export function useDailyPage() {
  const [currentMonth, setCurrentMonth] = useState(dayjs().startOf('month'))
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs())
  const [activities, setActivities] = useState<Activity[]>([])
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set())
  /** 已打卡的业务日集合（YYYY-MM-DD），日历格子渲染小绿点 */
  const [checkinDates, setCheckinDates] = useState<Set<string>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null)
  const [form] = Form.useForm()

  /**
   * 请求序号 + 存活标记。
   *
   * 快速连点日历格子（A→B→C）或连续翻月时，先发出的请求不一定先返回；
   * 没有序号守卫，A 的响应会盖掉 C 的，表现为「右侧活动列表与顶部日期
   * 长期对不上，要刷新窗口才恢复」。
   */
  const reqSeqRef = useRef(0)
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // 弹窗表单的延迟设值：切走路由后不得再碰已卸载组件的 form
  const formTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (formTimerRef.current) clearTimeout(formTimerRef.current)
    },
    [],
  )
  /** 安排一次表单延迟设值，同一次打开只保留最后一个定时器 */
  const scheduleFormFill = useCallback((fill: () => void) => {
    if (formTimerRef.current) clearTimeout(formTimerRef.current)
    formTimerRef.current = setTimeout(() => {
      formTimerRef.current = null
      fill()
    }, 0)
  }, [])

  const selectedDateStr = selectedDate.format('YYYY-MM-DD')

  // 加载活动数据（用 useCallback 稳定引用，避免每次渲染都触发下面 effect 重新拉数据）
  const refreshData = useCallback(async () => {
    const seq = ++reqSeqRef.current
    const start = currentMonth.startOf('month').subtract(7, 'day').format('YYYY-MM-DD')
    const end = currentMonth.endOf('month').add(7, 'day').format('YYYY-MM-DD')
    const [acts, dates, checkins] = await Promise.all([
      getActivitiesByDate(selectedDateStr),
      getActiveDates(start, end),
      getCheckinDates(start, end),
    ])
    if (!aliveRef.current || seq !== reqSeqRef.current) return
    setActivities(acts)
    setActiveDates(dates)
    setCheckinDates(checkins)
  }, [currentMonth, selectedDateStr])

  useEffect(() => {
    void refreshData()
  }, [refreshData])

  // 日历网格数据
  const calendarDays = useMemo(() => {
    const startOfMonth = currentMonth.startOf('month')
    const endOfMonth = currentMonth.endOf('month')
    const startDay = startOfMonth.startOf('week') // 周日开始
    const endDay = endOfMonth.endOf('week')
    const days: Dayjs[] = []
    let cur = startDay
    while (cur.isBefore(endDay) || cur.isSame(endDay, 'day')) {
      days.push(cur)
      cur = cur.add(1, 'day')
    }
    return days
  }, [currentMonth])

  // 时间带数据（每30分钟一个槽位）
  const timeSlots = useMemo(() => {
    const slots: { time: string; label: string }[] = []
    for (let h = 0; h < 24; h++) {
      slots.push({ time: `${String(h).padStart(2, '0')}:00`, label: `${String(h).padStart(2, '0')}:00` })
      slots.push({ time: `${String(h).padStart(2, '0')}:30`, label: '' })
    }
    return slots
  }, [])

  // 打开添加活动弹窗
  const openAddModal = (startTime?: string) => {
    setEditingActivity(null)
    setModalOpen(true)
    // Form 在 Modal 打开后才渲染，需异步设值
    scheduleFormFill(() => {
      form.resetFields()
      form.setFieldsValue({
        startTime: startTime ? dayjs(`2000-01-01 ${startTime}`) : dayjs().startOf('hour'),
        endTime: startTime
          ? dayjs(`2000-01-01 ${startTime}`).add(1, 'hour')
          : dayjs().startOf('hour').add(1, 'hour'),
        color: ACTIVITY_COLORS[Math.floor(Math.random() * ACTIVITY_COLORS.length)],
      })
    })
  }

  // 打开编辑活动弹窗
  const openEditModal = (activity: Activity) => {
    setEditingActivity(activity)
    setModalOpen(true)
    scheduleFormFill(() => {
      form.setFieldsValue({
        name: activity.name,
        startTime: dayjs(`2000-01-01 ${activity.startTime}`),
        endTime: dayjs(`2000-01-01 ${activity.endTime}`),
        color: activity.color || ACTIVITY_COLORS[0],
      })
    })
  }

  // 保存活动
  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const startTime = values.startTime.format('HH:mm')
      const endTime = values.endTime.format('HH:mm')
      if (editingActivity) {
        await updateActivity(editingActivity.id, {
          name: values.name,
          startTime,
          endTime,
          color: values.color,
        })
      } else {
        await addActivity(selectedDateStr, startTime, endTime, values.name, values.color)
      }
      setModalOpen(false)
      await refreshData()
    } catch {
      // validation failed
    }
  }

  // 删除活动
  const handleDelete = async (id: string) => {
    await deleteActivity(id)
    await refreshData()
  }

  return {
    currentMonth,
    setCurrentMonth,
    selectedDate,
    setSelectedDate,
    activities,
    activeDates,
    checkinDates,
    modalOpen,
    setModalOpen,
    editingActivity,
    form,
    calendarDays,
    timeSlots,
    openAddModal,
    openEditModal,
    handleSave,
    handleDelete,
  }
}
