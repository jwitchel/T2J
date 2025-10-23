'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import useSWR from 'swr';
import ReactECharts from 'echarts-for-react';

// Raw action counts from API (all possible actions)
interface RawActionCounts {
  [key: string]: number;
}

// Aggregated action counts for display
interface ActionCounts {
  drafted: number;
  spam: number;
  moved: number;
  noAction: number;
}

interface ActionsSummaryData {
  periods: {
    last15min: RawActionCounts;
    lastHour: RawActionCounts;
    last24Hours: RawActionCounts;
    last30Days: RawActionCounts;
  };
}

const fetcher = async (url: string) => {
  const res = await fetch(url, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Failed to fetch actions summary');
  }
  return res.json();
};

// Aggregate raw actions into display categories
function aggregateActions(raw: RawActionCounts): ActionCounts {
  const result: ActionCounts = {
    drafted: 0,
    spam: 0,
    moved: 0,
    noAction: 0
  };

  Object.entries(raw).forEach(([action, count]) => {
    // Draft actions (reply, forward, etc.)
    if (action === 'reply' || action === 'reply-all' || action === 'forward' || action === 'forward-with-comment') {
      result.drafted += count;
    }
    // Spam
    else if (action === 'silent-spam') {
      result.spam += count;
    }
    // Moved (FYI, Large List, Unsubscribe)
    else if (action === 'silent-fyi-only' || action === 'silent-large-list' || action === 'silent-unsubscribe') {
      result.moved += count;
    }
    // Legacy draft_created - we can't distinguish these in aggregate, so count as drafted
    else if (action === 'draft_created') {
      result.drafted += count;
    }
    // Everything else is No Action
    else {
      result.noAction += count;
    }
  });

  return result;
}

export function ActionsSummaryChart() {
  const { data, error, isLoading } = useSWR<ActionsSummaryData>(
    `${process.env.NEXT_PUBLIC_API_URL}/api/dashboard/actions-summary`,
    fetcher,
    {
      refreshInterval: 30000, // Auto-refresh every 30 seconds
      revalidateOnFocus: true,
    }
  );

  if (error) {
    return (
      <Card className="gap-3 py-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-red-500">Failed to load actions summary</div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <Card className="gap-3 py-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] flex items-center justify-center">
            <div className="text-muted-foreground">Loading chart...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Aggregate raw actions into display categories
  const periods = ['Last 15 Min', 'Last Hour', 'Last 24 Hours', 'Last 30 Days'];
  const { last15min, lastHour, last24Hours, last30Days } = data.periods;

  // Aggregate each period's actions
  const agg15min = aggregateActions(last15min);
  const aggHour = aggregateActions(lastHour);
  const agg24h = aggregateActions(last24Hours);
  const agg30d = aggregateActions(last30Days);

  // Calculate totals for each period
  const totals = [
    agg15min.drafted + agg15min.spam + agg15min.moved + agg15min.noAction,
    aggHour.drafted + aggHour.spam + aggHour.moved + aggHour.noAction,
    agg24h.drafted + agg24h.spam + agg24h.moved + agg24h.noAction,
    agg30d.drafted + agg30d.spam + agg30d.moved + agg30d.noAction,
  ];

  // Convert to percentages for 100% stacked bar (all columns same height)
  const draftedData = [
    totals[0] > 0 ? (agg15min.drafted / totals[0]) * 100 : 0,
    totals[1] > 0 ? (aggHour.drafted / totals[1]) * 100 : 0,
    totals[2] > 0 ? (agg24h.drafted / totals[2]) * 100 : 0,
    totals[3] > 0 ? (agg30d.drafted / totals[3]) * 100 : 0,
  ];
  const spamData = [
    totals[0] > 0 ? (agg15min.spam / totals[0]) * 100 : 0,
    totals[1] > 0 ? (aggHour.spam / totals[1]) * 100 : 0,
    totals[2] > 0 ? (agg24h.spam / totals[2]) * 100 : 0,
    totals[3] > 0 ? (agg30d.spam / totals[3]) * 100 : 0,
  ];
  const movedData = [
    totals[0] > 0 ? (agg15min.moved / totals[0]) * 100 : 0,
    totals[1] > 0 ? (aggHour.moved / totals[1]) * 100 : 0,
    totals[2] > 0 ? (agg24h.moved / totals[2]) * 100 : 0,
    totals[3] > 0 ? (agg30d.moved / totals[3]) * 100 : 0,
  ];
  const noActionData = [
    totals[0] > 0 ? (agg15min.noAction / totals[0]) * 100 : 0,
    totals[1] > 0 ? (aggHour.noAction / totals[1]) * 100 : 0,
    totals[2] > 0 ? (agg24h.noAction / totals[2]) * 100 : 0,
    totals[3] > 0 ? (agg30d.noAction / totals[3]) * 100 : 0,
  ];

  // Store actual counts for display
  const actualCounts = {
    drafted: [agg15min.drafted, aggHour.drafted, agg24h.drafted, agg30d.drafted],
    spam: [agg15min.spam, aggHour.spam, agg24h.spam, agg30d.spam],
    moved: [agg15min.moved, aggHour.moved, agg24h.moved, agg30d.moved],
    noAction: [agg15min.noAction, aggHour.noAction, agg24h.noAction, agg30d.noAction],
  };

  const option = {
    tooltip: { show: false },
    grid: {
      left: '3%',
      right: '3%',
      bottom: '15%',
      top: '10%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: periods,
      axisLabel: {
        interval: 0, // Show all labels
        rotate: 0,   // Keep horizontal
        fontSize: 11,
      },
    },
    yAxis: {
      type: 'value',
      max: 100,
      show: false,
    },
    barWidth: '85%',
    barCategoryGap: '0%',
    series: [
      {
        name: 'Drafted',
        type: 'bar',
        stack: 'total',
        data: draftedData,
        itemStyle: {
          color: '#3b82f6', // blue-500
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 20,
            shadowOffsetX: 0,
            shadowOffsetY: 5,
            shadowColor: 'rgba(0, 0, 0, 0.3)',
          },
        },
        label: {
          show: true,
          position: 'insideTop',
          formatter: (params: { dataIndex: number }) => {
            const count = actualCounts.drafted[params.dataIndex];
            const pct = draftedData[params.dataIndex] as number;
            // Hide label if segment is too small (<8%) or count is 0
            return (count > 0 && pct >= 8) ? `${count} Drafted` : '';
          },
          color: '#fff',
          fontWeight: 600,
          fontSize: 11,
        },
      },
      {
        name: 'Spam',
        type: 'bar',
        stack: 'total',
        data: spamData,
        itemStyle: {
          color: '#ef4444', // red-500
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 20,
            shadowOffsetX: 0,
            shadowOffsetY: 5,
            shadowColor: 'rgba(0, 0, 0, 0.3)',
          },
        },
        label: {
          show: true,
          position: 'inside',
          formatter: (params: { dataIndex: number }) => {
            const count = actualCounts.spam[params.dataIndex];
            const pct = spamData[params.dataIndex] as number;
            // Hide label if segment is too small (<8%) or count is 0
            return (count > 0 && pct >= 8) ? `${count} Spam` : '';
          },
          color: '#fff',
          fontWeight: 600,
          fontSize: 11,
        },
      },
      {
        name: 'Moved',
        type: 'bar',
        stack: 'total',
        data: movedData,
        itemStyle: {
          color: '#22c55e', // green-500
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 20,
            shadowOffsetX: 0,
            shadowOffsetY: 5,
            shadowColor: 'rgba(0, 0, 0, 0.3)',
          },
        },
        label: {
          show: true,
          position: 'insideTop',
          formatter: (params: { dataIndex: number }) => {
            const count = actualCounts.moved[params.dataIndex];
            const pct = movedData[params.dataIndex] as number;
            // Hide label if segment is too small (<8%) or count is 0
            return (count > 0 && pct >= 8) ? `${count} Moved` : '';
          },
          color: '#fff',
          fontWeight: 600,
          fontSize: 11,
        },
      },
      {
        name: 'No Action',
        type: 'bar',
        stack: 'total',
        data: noActionData,
        itemStyle: {
          color: '#6b7280', // gray-500
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 20,
            shadowOffsetX: 0,
            shadowOffsetY: 5,
            shadowColor: 'rgba(0, 0, 0, 0.3)',
          },
        },
        label: {
          show: true,
          position: 'insideTop',
          formatter: (params: { dataIndex: number }) => {
            const count = actualCounts.noAction[params.dataIndex];
            const pct = noActionData[params.dataIndex] as number;
            // Hide label if segment is too small (<8%) or count is 0
            return (count > 0 && pct >= 8) ? `${count} No Action` : '';
          },
          color: '#fff',
          fontWeight: 600,
          fontSize: 11,
        },
      },
      // Invisible series LAST to display totals at the very top of the full stacked column
      {
        name: 'Total',
        type: 'bar',
        stack: 'total',
        data: [0, 0, 0, 0],
        itemStyle: { color: 'transparent' },
        emphasis: { disabled: true },
        tooltip: { show: false },
        label: {
          show: true,
          position: 'top',
          formatter: (params: { dataIndex: number }) => `${totals[params.dataIndex]} Emails`,
          color: '#6b7280',
          fontWeight: 600,
          fontSize: 12,
        },
      },
    ],
  };

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ReactECharts option={option} style={{ height: '280px', width: '100%' }} />
      </CardContent>
    </Card>
  );
}
