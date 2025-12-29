'use client';

import { Box, Paper, Typography, Skeleton, Alert } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useSWR from 'swr';
import ReactECharts from 'echarts-for-react';
import { EmailActionType } from '../../../../../server/src/types/email-action-tracking';
import { useChartColors, useEChartsTheme } from '@/hooks/use-echarts-theme';

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

// Aggregate raw actions into display categories
function aggregateActions(raw: RawActionCounts): ActionCounts {
  const result: ActionCounts = {
    drafted: 0,
    spam: 0,
    moved: 0,
    noAction: 0,
  };

  Object.entries(raw).forEach(([action, count]) => {
    if (EmailActionType.isDraftAction(action)) {
      result.drafted += count;
    } else if (EmailActionType.isSpamAction(action)) {
      result.spam += count;
    } else if (EmailActionType.isMovedAction(action)) {
      result.moved += count;
    } else {
      result.noAction += count;
    }
  });

  return result;
}

export function ActionsSummaryChart() {
  const theme = useTheme();
  const chartColors = useChartColors();
  const echartsTheme = useEChartsTheme();

  // Theme-aware chart colors
  const CHART_COLORS = {
    drafted: chartColors[0],  // primary (blue)
    spam: chartColors[1],     // error (red)
    moved: chartColors[2],    // success (green)
    noAction: chartColors[3], // grey
    label: theme.palette.text.secondary,
  };

  const { data, error, isLoading } = useSWR<ActionsSummaryData>(
    '/api/dashboard/actions-summary',
    {
      refreshInterval: 30000,
      revalidateOnFocus: true,
    }
  );

  if (error) {
    return (
      <Box>
        <Typography variant="sectionHeader" gutterBottom>
          Recent Activity
        </Typography>
        <Paper sx={{ p: 3 }}>
          <Alert severity="error">Failed to load actions summary</Alert>
        </Paper>
      </Box>
    );
  }

  if (isLoading || !data) {
    return (
      <Box>
        <Typography variant="sectionHeader" gutterBottom>
          Recent Activity
        </Typography>
        <Paper sx={{ p: 3 }}>
          <Skeleton variant="rectangular" height={280} />
        </Paper>
      </Box>
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
    tooltip: {
      show: true,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: echartsTheme.tooltip.backgroundColor,
      borderColor: echartsTheme.tooltip.borderColor,
      textStyle: echartsTheme.tooltip.textStyle,
      formatter: (params: { seriesName: string; value: number; dataIndex: number }[]) => {
        const idx = params[0]?.dataIndex ?? 0;
        const total = totals[idx];
        return `<strong>${periods[idx]}</strong><br/>
          Drafted: ${actualCounts.drafted[idx]}<br/>
          Spam: ${actualCounts.spam[idx]}<br/>
          Moved: ${actualCounts.moved[idx]}<br/>
          No Action: ${actualCounts.noAction[idx]}<br/>
          <strong>Total: ${total}</strong>`;
      },
    },
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
        interval: 0,
        rotate: 0,
        fontSize: 11,
        color: echartsTheme.textStyle.color,
        fontFamily: echartsTheme.textStyle.fontFamily,
      },
      axisLine: echartsTheme.axisLine,
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
        itemStyle: { color: CHART_COLORS.drafted },
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
            const pct = draftedData[params.dataIndex];
            return count > 0 && pct >= 8 ? `${count} Drafted` : '';
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
        itemStyle: { color: CHART_COLORS.spam },
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
            const pct = spamData[params.dataIndex];
            return count > 0 && pct >= 8 ? `${count} Spam` : '';
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
        itemStyle: { color: CHART_COLORS.moved },
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
            const pct = movedData[params.dataIndex];
            return count > 0 && pct >= 8 ? `${count} Moved` : '';
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
        itemStyle: { color: CHART_COLORS.noAction },
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
          position: 'top',
          formatter: (params: { dataIndex: number }) => `${totals[params.dataIndex]} Emails`,
          color: CHART_COLORS.label,
          fontWeight: 600,
          fontSize: 12,
        },
      },
    ],
  };

  return (
    <Box>
      <Typography variant="sectionHeader" gutterBottom>
        Recent Activity
      </Typography>
      <Paper sx={{ p: 2 }}>
        <ReactECharts option={option} style={{ height: '280px', width: '100%' }} />
      </Paper>
    </Box>
  );
}
