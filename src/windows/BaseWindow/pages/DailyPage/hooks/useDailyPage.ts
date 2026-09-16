import { useCallback, useEffect, useMemo, useState } from 'react'
import { Form } from 'antd'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import {
  getActivitiesByDate, getActiveDates, addActivity, updateActivity, deleteActivity,
  ACTIVITY_COLORS,
} from '@/shared/services/daily'
import type { Activity } from '@/shared/services/daily'

/** DailyPage 业务逻辑：日历/时间带派生数据、活动数据加载与增删改弹窗编排 */
export function useDailyPage() {
  const [currentMonth, setCurrentMonth] = useState(dayjs().startOf('month'))
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs())
  const [activities, setActivities] = useState<Activity[]>([])
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null)
  const [form] = Form.useForm()

  const selectedDateStr = selectedDate.format('YYYY-MM-DD')

  // 加载活动数据（用 useCallback 稳定引用，避免每次渲染都触发下面 effect 重新拉数据）
  const refreshData = useCallback(async () => {
    const [acts, dates] = await Promise.all([
      getActivitiesByDate(selectedDateStr),
      getActiveDates(
        currentMonth.startOf('month').subtract(7, 'day').format('YYYY-MM-DD'),
        currentMonth.endOf('month').add(7, 'day').format('YYYY-MM-DD'),
      ),
    ])
    setActivities(acts)
    setActiveDates(dates)
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
    setTimeout(() => {
      form.resetFields()
      form.setFieldsValue({
        startTime: startTime ? dayjs(`2000-01-01 ${startTime}`) : dayjs().startOf('hour'),
        endTime: startTime
          ? dayjs(`2000-01-01 ${startTime}`).add(1, 'hour')
          : dayjs().startOf('hour').add(1, 'hour'),
        color: ACTIVITY_COLORS[Math.floor(Math.random() * ACTIVITY_COLORS.length)],
      })
    }, 0)
  }

  // 打开编辑活动弹窗
  const openEditModal = (activity: Activity) => {
    setEditingActivity(activity)
    setModalOpen(true)
    setTimeout(() => {
      form.setFieldsValue({
        name: activity.name,
        startTime: dayjs(`2000-01-01 ${activity.startTime}`),
        endTime: dayjs(`2000-01-01 ${activity.endTime}`),
        color: activity.color || ACTIVITY_COLORS[0],
      })
    }, 0)
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
