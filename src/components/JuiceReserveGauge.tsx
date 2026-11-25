import { formatMoney } from '../types';

interface JuiceReserveGaugeProps {
  displayedDaySpent: number;
  dailyTarget: number;
  monthlyBudget: number;
  monthSpentBeforeToday: number;
  daysLeftInMonth: number;
  rationStatus: 'abundant' | 'healthy' | 'caution' | 'critical';
  isTallying: boolean;
}

export function JuiceReserveGauge({
  displayedDaySpent,
  dailyTarget,
  monthlyBudget,
  monthSpentBeforeToday,
  daysLeftInMonth,
  rationStatus,
  isTallying,
}: JuiceReserveGaugeProps) {
  const effectiveMonthSpent = monthSpentBeforeToday + displayedDaySpent;
  const remainingDollars = Math.max(0, monthlyBudget - effectiveMonthSpent);
  const rationsDays = dailyTarget > 0 ? remainingDollars / dailyTarget : 0;

  // Render 10 Koppai juice bottles representing up to 10 days of rations (or scaled proportionally)
  const bottleCount = 10;
  const maxDaysRepresented = Math.max(10, Math.ceil(monthlyBudget / Math.max(1, dailyTarget) / 3) * 3);
  const daysPerBottle = maxDaysRepresented / bottleCount;

  const dailyPct = dailyTarget > 0 ? Math.min(100, (displayedDaySpent / dailyTarget) * 100) : 0;
  const isOverDaily = displayedDaySpent > dailyTarget;

  const liquidColor =
    rationStatus === 'critical'
      ? '#f87171'
      : rationStatus === 'caution'
        ? '#f7b34d'
        : rationStatus === 'abundant'
          ? '#7ce063'
          : '#53d8e2';

  const statusLabel: Record<typeof rationStatus, string> = {
    abundant: 'Rations Abundant',
    healthy: 'Rations Steady',
    caution: 'High Drain Today',
    critical: 'Low Rations Alert',
  };

  return (
    <section className="k-panel juice-gauge-stack" aria-label="Budget Juice Reserve">
      <div className="k-panel-header" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="k-panel-title">Budget Juice Reserve</h2>
          <div className="k-panel-meta">
            {isTallying
              ? 'Juicing today’s purchases against monthly rations...'
              : `${daysLeftInMonth} day${daysLeftInMonth === 1 ? '' : 's'} left in this month`}
          </div>
        </div>
        <span className={`status-badge ${rationStatus}`}>{statusLabel[rationStatus]}</span>
      </div>

      {/* Animated Koppai Glass Juice Bottles Shelf */}
      <div className="juice-bottles-shelf">
        {Array.from({ length: bottleCount }).map((_, idx) => {
          const bottleMin = idx * daysPerBottle;
          const fillRatio = Math.max(0, Math.min(1, (rationsDays - bottleMin) / daysPerBottle));
          const innerHeight = 46;
          const liquidH = fillRatio * innerHeight;
          const liquidY = 66 - liquidH;
          const clipId = `bottleClip-${idx}`;

          return (
            <div key={idx} className="juice-bottle-wrap" title={`Bottle ${idx + 1}: ${Math.round(fillRatio * 100)}% full`}>
              <svg className="juice-bottle-svg" viewBox="0 0 44 76" aria-hidden="true">
                <defs>
                  <clipPath id={clipId}>
                    <rect x="8" y="20" width="28" height="46" rx="10" />
                  </clipPath>
                </defs>
                {/* Cork / Cap */}
                <rect x="15" y="4" width="14" height="6" rx="2.5" fill="#d9a05b" />
                <rect x="13" y="10" width="18" height="6" rx="2" fill="rgba(196, 240, 248, 0.28)" stroke="rgba(196, 240, 248, 0.45)" strokeWidth="1" />
                {/* Glass Body */}
                <rect
                  x="7"
                  y="18"
                  width="30"
                  height="50"
                  rx="11"
                  fill="rgba(10, 34, 48, 0.65)"
                  stroke="rgba(182, 238, 248, 0.36)"
                  strokeWidth="1.5"
                />
                {/* Animated Juice Fill */}
                <g clipPath={`url(#${clipId})`}>
                  <rect
                    className="juice-liquid-rect"
                    x="8"
                    y={liquidY}
                    width="28"
                    height={liquidH + 2}
                    fill={liquidColor}
                    fillOpacity={fillRatio > 0 ? 0.88 : 0}
                  />
                  {fillRatio > 0.08 && (
                    <>
                      <ellipse
                        cx="22"
                        cy={liquidY + 1}
                        rx="14"
                        ry="2.6"
                        fill="#ffffff"
                        fillOpacity="0.32"
                      />
                      <circle className="juice-bubble" cx="15" cy={Math.min(62, liquidY + 16)} r="1.6" fill="#fff" fillOpacity="0.6" />
                      <circle className="juice-bubble b2" cx="27" cy={Math.min(63, liquidY + 22)} r="1.3" fill="#fff" fillOpacity="0.55" />
                      <circle className="juice-bubble b3" cx="21" cy={Math.min(61, liquidY + 12)} r="1.1" fill="#fff" fillOpacity="0.5" />
                    </>
                  )}
                </g>
                {/* Glass Specular Highlight */}
                <path
                  d="M12 24V58"
                  stroke="#ffffff"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeOpacity="0.26"
                />
              </svg>
              <span className="bottle-day-label">
                {Math.round((idx + 1) * daysPerBottle)}d
              </span>
            </div>
          );
        })}
      </div>

      {/* Daily Ration Meter */}
      <div className="daily-meter-block">
        <div className="daily-meter-labels">
          <span>Today’s Ration Burn</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: isOverDaily ? 'var(--ration-coral)' : 'var(--text-primary)' }}>
            {formatMoney(displayedDaySpent)} / {formatMoney(dailyTarget)}
          </span>
        </div>
        <div className="daily-meter-track">
          <div
            className="daily-meter-fill"
            style={{
              width: `${dailyPct}%`,
              background: isOverDaily
                ? 'linear-gradient(90deg, #f7b34d, #f87171)'
                : 'linear-gradient(90deg, #53d8e2, #7ce063)',
            }}
          />
        </div>
      </div>

      {/* Key Ration Metrics */}
      <div className="rations-stat-row">
        <div className="ration-tile">
          <div className="ration-tile-label">Juice Supply Left</div>
          <div className="ration-tile-val" style={{ color: liquidColor }}>
            {rationsDays.toFixed(1)} Days
          </div>
          <div className="ration-tile-sub">
            {formatMoney(remainingDollars)} of {formatMoney(monthlyBudget)}
          </div>
        </div>

        <div className="ration-tile">
          <div className="ration-tile-label">Month Spent</div>
          <div className="ration-tile-val">{formatMoney(effectiveMonthSpent)}</div>
          <div className="ration-tile-sub">
            {Math.round((effectiveMonthSpent / Math.max(1, monthlyBudget)) * 100)}% of monthly hold
          </div>
        </div>
      </div>
    </section>
  );
}
