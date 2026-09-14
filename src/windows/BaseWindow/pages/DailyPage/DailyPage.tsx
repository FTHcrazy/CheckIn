import {
  Button, Modal, Form, Input, TimePicker, Select, Popconfirm, Typography, Space, Tooltip,
} from 'antd'
import {
  LeftOutlined, RightOutlined, PlusOutlined, DeleteOutlined, EditOutlined, ClockCircleOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { Solar, Lunar } from 'lunar-typescript'
import Page from '@/shared/components/Page'
import { timeToMinutes, ACTIVITY_COLORS } from '@/shared/services/daily'
import type { Activity } from '@/shared/services/daily'
import { useDailyPage } from './hooks/useDailyPage'
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

/** 时间带上活动块的位置计算 */
function getActivityStyle(a: Activity): { top: string; height: string } {
  const startMins = timeToMinutes(a.startTime)
  const endMins = timeToMinutes(a.endTime)
  const top = (startMins / 30) * 28 + 1 // 每槽28px高
  const height = Math.max(((endMins - startMins) / 30) * 28, 26)
  return { top: `${top}px`, height: `${height}px` }
}

export default function DailyPage() {
  const {
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
  } = useDailyPage()

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
