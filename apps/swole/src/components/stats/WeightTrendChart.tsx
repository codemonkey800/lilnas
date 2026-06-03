'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { weightTrendDomain } from 'src/lib/stats'

type Point = { ts: number; weight: number }

type Props = {
  points: Point[]
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function WeightTrendChart({ points }: Props) {
  const domain = weightTrendDomain(points.map(p => p.weight))

  return (
    // `initialDimension` lets recharts paint at a sensible size on the first
    // render instead of rendering nothing until its ResizeObserver measures the
    // container — without it the chart flashes blank on first load/navigation.
    // The width is just a first-paint guess; ResponsiveContainer corrects it to
    // the measured width on mount.
    <ResponsiveContainer
      width="100%"
      height={280}
      initialDimension={{ width: 434, height: 280 }}
    >
      <LineChart
        data={points}
        margin={{ top: 12, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={formatTs}
          tick={{ fill: '#a3a3a3', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: '#404040' }}
        />
        <YAxis
          domain={domain}
          allowDecimals={false}
          tick={{ fill: '#a3a3a3', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={(v: number) => `${v}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#171717',
            border: '1px solid #404040',
            borderRadius: 8,
            color: '#fff',
          }}
          labelFormatter={label => formatTs(label as number)}
          formatter={value => [`${value ?? ''} lb`, 'Weight']}
        />
        <Line
          type="stepAfter"
          dataKey="weight"
          stroke="#f97316"
          strokeWidth={2}
          dot={{ fill: '#f97316', r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
