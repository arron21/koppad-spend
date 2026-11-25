import { useState } from 'react';
import { CATEGORY_LIST, PIKMIN_CATEGORIES, formatMoney } from '../types';
import type { PikminCategory, TrendPoint } from '../types';
import { PikminSproutIcon } from './PikminIcons';

interface PikminSpendChartProps {
  categories: Record<PikminCategory, { total: number; count: number }>;
  dayTotal: number;
  dailyTarget: number;
  trend: TrendPoint[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

export function PikminSpendChart({
  categories,
  dayTotal,
  dailyTarget,
  trend,
  selectedDate,
  onSelectDate,
}: PikminSpendChartProps) {
  const [chartMode, setChartMode] = useState<'total' | 'categories'>('total');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const width = 560;
  const height = 190;
  const padLeft = 44;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 30;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const maxDataVal = Math.max(
    dailyTarget * 1.15,
    ...trend.map((p) =>
      chartMode === 'total'
        ? p.total
        : Math.max(p.dining, p.shopping, p.groceries, p.bills, p.leisure)
    ),
    25
  );

  const getX = (idx: number) =>
    trend.length <= 1 ? padLeft + innerW / 2 : padLeft + (idx / (trend.length - 1)) * innerW;
  const getY = (val: number) => padTop + innerH - (val / maxDataVal) * innerH;

  const buildPath = (values: number[]) =>
    values
      .map((val, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx).toFixed(1)} ${getY(val).toFixed(1)}`)
      .join(' ');

  const totalPath = buildPath(trend.map((p) => p.total));
  const areaPath =
    trend.length > 0
      ? `${totalPath} L ${getX(trend.length - 1).toFixed(1)} ${(padTop + innerH).toFixed(1)} L ${getX(0).toFixed(1)} ${(padTop + innerH).toFixed(1)} Z`
      : '';

  const hovered = hoverIndex !== null ? trend[hoverIndex] : null;
  const targetY = getY(dailyTarget);

  return (
    <section className="k-panel" aria-label="Pikmin Category Breakdown and Trend">
      <div className="k-panel-header">
        <div>
          <h2 className="k-panel-title">Pikmin Squad Breakdown</h2>
          <div className="k-panel-meta">Today’s spending by Pikmin color & 14-day expedition graph</div>
        </div>

        <div className="chart-mode-toggle" role="tablist" aria-label="Chart display mode">
          <button
            type="button"
            className={`chart-mode-btn${chartMode === 'total' ? ' active' : ''}`}
            onClick={() => setChartMode('total')}
          >
            Total Spend
          </button>
          <button
            type="button"
            className={`chart-mode-btn${chartMode === 'categories' ? ' active' : ''}`}
            onClick={() => setChartMode('categories')}
          >
            By Pikmin Color
          </button>
        </div>
      </div>

      {/* 5 Pikmin Category Bars */}
      <div className="squad-bars">
        {CATEGORY_LIST.map((cat) => {
          const stat = categories[cat.id];
          const pct = dayTotal > 0 ? Math.min(100, (stat.total / dayTotal) * 100) : 0;
          return (
            <div key={cat.id} className="squad-row">
              <PikminSproutIcon category={cat.id} size={28} />
              <div className="squad-name">
                <strong>{cat.label}</strong>
                <span>
                  {cat.pikminName} · {stat.count} item{stat.count === 1 ? '' : 's'}
                </span>
              </div>
              <div className="squad-track">
                <div
                  className="squad-fill"
                  style={{ width: `${pct}%`, background: cat.color }}
                />
              </div>
              <div className="squad-amount" style={{ color: stat.total > 0 ? cat.color : 'var(--text-muted)' }}>
                {formatMoney(stat.total)}
              </div>
            </div>
          );
        })}
      </div>

      {/* 14-Day Pikmin Population-Style Spend Graph */}
      <div className="trend-svg-container">
        {hovered && (
          <div className="trend-tooltip">
            <div style={{ fontWeight: 800, color: 'var(--sunset-gold)' }}>
              {hovered.date} · {formatMoney(hovered.total)}
            </div>
            {chartMode === 'categories' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 3, fontSize: '0.7rem' }}>
                {CATEGORY_LIST.filter((c) => hovered[c.id] > 0).map((c) => (
                  <span key={c.id} style={{ color: c.color }}>
                    {c.label.split(' ')[0]}: {formatMoney(hovered[c.id])}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', height: 'auto', display: 'block' }}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="totalAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#53d8e2" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#53d8e2" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Horizontal Y-Axis Ticks */}
          {[0, 0.5, 1].map((step) => {
            const val = maxDataVal * step;
            const y = getY(val);
            return (
              <g key={step}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  stroke="rgba(164, 228, 236, 0.1)"
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 7}
                  y={y + 4}
                  textAnchor="end"
                  fill="#7097a5"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  ${Math.round(val)}
                </text>
              </g>
            );
          })}

          {/* Daily Ration Target Threshold Line */}
          {chartMode === 'total' && (
            <g>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={targetY}
                y2={targetY}
                stroke="#f7b34d"
                strokeWidth="1.4"
                strokeDasharray="5 4"
                strokeOpacity="0.82"
              />
              <text
                x={width - padRight}
                y={targetY - 5}
                textAnchor="end"
                fill="#ffd479"
                fontSize="9.5"
                fontWeight="700"
              >
                Daily Target {formatMoney(dailyTarget)}
              </text>
            </g>
          )}

          {/* Graph Traces */}
          {chartMode === 'total' ? (
            <>
              <path d={areaPath} fill="url(#totalAreaFill)" />
              <path
                d={totalPath}
                fill="none"
                stroke="#53d8e2"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : (
            CATEGORY_LIST.map((cat) => (
              <path
                key={cat.id}
                d={buildPath(trend.map((p) => p[cat.id]))}
                fill="none"
                stroke={PIKMIN_CATEGORIES[cat.id].color}
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity="0.9"
              />
            ))
          )}

          {/* Interactive Day Nodes & Labels */}
          {trend.map((point, idx) => {
            const x = getX(idx);
            const y = getY(point.total);
            const isSelected = point.date === selectedDate;
            const showLabel = idx % 2 === 0 || idx === trend.length - 1;
            const nodeColor =
              point.total > dailyTarget ? '#f87171' : point.total > 0 ? '#7ce063' : '#53d8e2';

            return (
              <g
                key={point.date}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoverIndex(idx)}
                onClick={() => onSelectDate(point.date)}
              >
                {/* Invisible hit column */}
                <rect
                  x={x - innerW / Math.max(2, trend.length * 2)}
                  y={padTop}
                  width={innerW / Math.max(1, trend.length)}
                  height={innerH + padBottom}
                  fill="transparent"
                />
                {chartMode === 'total' && (
                  <circle
                    cx={x}
                    cy={y}
                    r={isSelected ? 5.8 : hoverIndex === idx ? 5 : 3.4}
                    fill={isSelected ? '#ffd479' : nodeColor}
                    stroke="#06141d"
                    strokeWidth="1.8"
                  />
                )}
                {showLabel && (
                  <text
                    x={x}
                    y={height - 8}
                    textAnchor="middle"
                    fill={isSelected ? '#ffd479' : '#7097a5'}
                    fontSize="10"
                    fontWeight={isSelected ? '700' : '600'}
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {point.dayLabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
