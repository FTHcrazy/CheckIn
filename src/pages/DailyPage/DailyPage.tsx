import { useState, useEffect, useMemo } from 'react'
import {
  Button, Modal, Form, Input, TimePicker, Select, Popconfirm, Typography, Space, Tooltip,
} from 'antd'
import {
  LeftOutlined, RightOutlined, PlusOutlined, DeleteOutlined, EditOutlined, ClockCircleOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { Solar, Lunar } from 'lunar-typescript'
import Page from '../../components/Page'
import {
  getActivitiesByDate, getActiveDates, addActivity, updateActivity, deleteActivity,
  timeToMinutes, ACTIVITY_COLORS,
} from '../../services/daily'
import type { Activity } from '../../services/daily'
import './index.scss'

const { Text } = Typography

/** 获取农历日期字符串 */
function getLunarStr(d: Dayjs): string {
  const lunar = Lunar.fromDate(d.toDate())
  const day = lunar.getDayInChinese()
  // 初一显示月份，其他显示日
  if (day === '初一') {
    return lunar.getMonthInChinese() + '月'
  }
  return day
}

/** 获取公历节日 */
function getSolarFestival(d: Dayjs): string | null {
  const solar = Solar.fromDate(d.toDate())
  const f = solar.getFestivals()
  return f.length > 0 ? f[0] : null
}

export default function DailyPage() {
  const [currentMonth, setCurrentMonth] = useState(dayjs().startOf('month'))
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs())
  const [activities, setActivities] = useState<Activity[]>([])
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null)
  const [form] = Form.useForm()

  const selectedDateStr = selectedDate.format('YYYY-MM-DD')

  // 加载活动数据
  const refreshData = async () => {
    const [acts, dates] = await Promise.all([
      getActivitiesByDate(selectedDateStr),
      getActiveDates(
        currentMonth.startOf('month').subtract(7, 'day').format('YYYY-MM-DD'),
        currentMonth.endOf('month').add(7, 'day').format('YYYY-MM-DD'),
      ),
    ])
    setActivities(acts)
    setActiveDates(dates)
  }

  useEffect(() => { refreshData() }, [selectedDateStr, currentMonth])

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

  // 时间带上活动块的位置计算
  const getActivityStyle = (a: Activity) => {
    const startMins = timeToMinutes(a.startTime)
    const endMins = timeToMinutes(a.endTime)
    const top = (startMins / 30) * 28 + 1 // 每槽28px高
    const height = Math.max(((endMins - startMins) / 30) * 28, 26)
    return { top: `${top}px`, height: `${height}px` }
  }

  const today = dayjs()

  return (
    <Page>
      <div className="daily-page">
        {/* 左侧日历 */}
        <div className="calendar-panel">
          <div className="calendar-header">
            <Button
              type="text"
              icon={<LeftOutlined />}
              onClick={() => setCurrentMonth(currentMonth.subtract(1, 'month'))}
            />
            <Text strong style={{ fontSize: 16 }}>
              {currentMonth.format('YYYY年M月')}
            </Text>
            <Button
              type="text"
              icon={<RightOutlined />}
              onClick={() => setCurrentMonth(currentMonth.add(1, 'month'))}
            />
            <Button size="small" onClick={() => { setCurrentMonth(dayjs().startOf('month')); setSelectedDate(dayjs()) }}>
              今天
            </Button>
          </div>
          <div className="calendar-weekdays">
            {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
              <div key={d} className="weekday">{d}</div>
            ))}
          </div>
          <div className="calendar-grid">
            {calendarDays.map((d, i) => {
              const dateStr = d.format('YYYY-MM-DD')
              const isCurrentMonth = d.month() === currentMonth.month()
              const isSelected = d.isSame(selectedDate, 'day')
              const isToday = d.isSame(today, 'day')
              const hasActivity = activeDates.has(dateStr)
              const festival = getSolarFestival(d)
              const lunarStr = festival || getLunarStr(d)

              return (
                <div
                  key={i}
                  className={`calendar-cell ${!isCurrentMonth ? 'other-month' : ''} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                  onClick={() => setSelectedDate(d)}
                >
                  <div className="cell-top">
                    <span className="solar-day">{d.date()}</span>
                    {hasActivity && <span className="activity-dot" />}
                  </div>
                  <div className="lunar-day">{lunarStr}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 右侧时间带 */}
        <div className="timeline-panel">
          <div className="timeline-header">
            <Space>
              <ClockCircleOutlined />
              <Text strong>{selectedDate.format('YYYY-MM-DD')}</Text>
              <Text type="secondary">{getLunarStr(selectedDate)}</Text>
            </Space>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => openAddModal()}
            >
              添加活动
            </Button>
          </div>

          {/* 活动列表 */}
          {activities.length > 0 && (
            <div className="activity-list">
              {activities.map((a) => (
                <div key={a.id} className="activity-item">
                  <span className="activity-color" style={{ backgroundColor: a.color }} />
                  <div className="activity-info">
                    <Text strong>{a.name}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{a.startTime} - {a.endTime}</Text>
                  </div>
                  <Space size={4}>
                    <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEditModal(a)} />
                    <Popconfirm title="删除此活动？" onConfirm={() => handleDelete(a.id)}>
                      <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                    </Popconfirm>
                  </Space>
                </div>
              ))}
            </div>
          )}

          {/* 竖向时间带 */}
          <div className="timeline-scroll">
            <div className="timeline-container">
              {/* 时间刻度 */}
              {timeSlots.map((slot, i) => (
                <div
                  key={i}
                  className={`time-slot ${slot.label ? 'has-label' : ''}`}
                  onClick={() => openAddModal(slot.time)}
                >
                  {slot.label && <span className="time-label">{slot.label}</span>}
                </div>
              ))}
              {/* 活动块 */}
              {activities.map((a) => {
                const style = getActivityStyle(a)
                return (
                  <div
                    key={a.id}
                    className="activity-block"
                    style={{ ...style, backgroundColor: a.color }}
                    onClick={(e) => { e.stopPropagation(); openEditModal(a) }}
                  >
                    <Tooltip title={`${a.startTime} - ${a.endTime}`}>
                      <span className="block-name">{a.name}</span>
                    </Tooltip>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* 添加/编辑活动弹窗 */}
        <Modal
          title={editingActivity ? '编辑活动' : '添加活动'}
          open={modalOpen}
          onOk={handleSave}
          onCancel={() => setModalOpen(false)}
          destroyOnHidden
        >
          <Form form={form} layout="vertical">
            <Form.Item name="name" label="活动名称" rules={[{ required: true, message: '请输入活动名称' }]}>
              <Input placeholder="例如：晨会、午餐、代码评审" />
            </Form.Item>
            <Form.Item name="startTime" label="开始时间" rules={[{ required: true }]}>
              <TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="endTime" label="结束时间" rules={[{ required: true }]}>
              <TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="color" label="颜色">
              <Select>
                {ACTIVITY_COLORS.map((c) => (
                  <Select.Option key={c} value={c}>
                    <span className="color-option" style={{ backgroundColor: c }} />
                    {c}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </Page>
  )
}
