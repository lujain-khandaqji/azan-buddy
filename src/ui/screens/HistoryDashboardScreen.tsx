import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { PRAYER_NAMES, PrayerName } from '../../domain/services/prayerTimesService';
import { PrayerLogStatus } from '../../domain/services/prayerLogService';
import { CalendarDay, DayPrayerStatus, PrayerFilter, StatusBreakdown } from '../../domain/services/historyDashboardService';
import { useHistoryDashboard } from '../hooks/useHistoryDashboard';

// Exact colors specified for this dashboard's status dots/badges.
const STATUS_COLORS: Record<PrayerLogStatus, string> = {
  on_time: '#10b981',
  late: '#f59e0b',
  qada: '#ea580c',
  missed: '#ef4444',
  not_yet: '#9ca3af',
};

const STATUS_LABELS: Record<PrayerLogStatus, string> = {
  on_time: 'On time',
  late: 'Late',
  qada: 'Qada',
  missed: 'Missed',
  not_yet: 'Not yet',
};

const FILTERS: PrayerFilter[] = ['All', ...PRAYER_NAMES];

function parseDateISO(dateISO: string): Date {
  const [year, month, day] = dateISO.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatShortDate(dateISO: string): string {
  return parseDateISO(dateISO).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDayNumber(dateISO: string): string {
  return String(parseDateISO(dateISO).getDate());
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDelta(deltaMinutes: number | null): string {
  if (deltaMinutes === null) return '—';
  return deltaMinutes >= 0 ? `+${deltaMinutes} min` : `${deltaMinutes} min`;
}

function formatStatSentence(label: string, stats: StatusBreakdown): string {
  return `${label}: ${stats.onTime}/${stats.total} on time, ${stats.late} late, ${stats.qada} qada, ${stats.missed} missed`;
}

function StatusDot({ status }: { status: PrayerLogStatus | undefined }) {
  return <View style={[styles.dot, { backgroundColor: STATUS_COLORS[status ?? 'not_yet'] }]} />;
}

function CalendarCell({ day }: { day: CalendarDay }) {
  return (
    <View style={styles.calendarCell}>
      <Text style={styles.calendarCellDay}>{formatDayNumber(day.dateISO)}</Text>
      <View style={styles.calendarCellDots}>
        {PRAYER_NAMES.map((name) => (
          <StatusDot key={name} status={day.statuses[name]} />
        ))}
      </View>
    </View>
  );
}

function HistoryRow({ entry }: { entry: DayPrayerStatus }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <View style={styles.rowTitleLine}>
          <View style={[styles.rowDot, { backgroundColor: STATUS_COLORS[entry.status] }]} />
          <Text style={styles.rowPrayer}>{entry.prayerName}</Text>
          <Text style={styles.rowDate}>{formatShortDate(entry.dateISO)}</Text>
        </View>
        <Text style={styles.rowMeta}>
          Azan {formatTime(entry.azanTime)} · Confirmed {entry.confirmedAt ? formatTime(entry.confirmedAt) : '—'} ·{' '}
          {formatDelta(entry.deltaMinutes)}
        </Text>
      </View>
      <Text style={[styles.rowStatus, { color: STATUS_COLORS[entry.status] }]}>{STATUS_LABELS[entry.status]}</Text>
    </View>
  );
}

export default function HistoryDashboardScreen() {
  const { loading, error, filter, setFilter, calendarDays, filteredEntries, weeklyStats, monthlyStats } =
    useHistoryDashboard();

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.statusText}>Loading history…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Couldn't load history: {error}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="never"
      data={filteredEntries}
      keyExtractor={(entry) => `${entry.dateISO}-${entry.prayerName}`}
      renderItem={({ item }) => <HistoryRow entry={item} />}
      ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
      ListEmptyComponent={<Text style={styles.emptyText}>No history for this filter yet.</Text>}
      ListHeaderComponent={
        <View>
          <Text style={styles.title}>History</Text>
          <Text style={styles.subtitle}>Last 30 days</Text>

          <View style={styles.pillRow}>
            {FILTERS.map((f) => (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[styles.pill, filter === f && styles.pillSelected]}
              >
                <Text style={[styles.pillText, filter === f && styles.pillTextSelected]}>{f}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.statsCard}>
            <Text style={styles.statsSentence}>{formatStatSentence('This week', weeklyStats)}</Text>
            <View style={styles.statsDivider} />
            <Text style={styles.statsSentence}>{formatStatSentence('This month', monthlyStats)}</Text>
          </View>

          <Text style={styles.sectionLabel}>Calendar</Text>
          <View style={styles.calendarGrid}>
            {calendarDays.map((day) => (
              <CalendarCell key={day.dateISO} day={day} />
            ))}
          </View>

          <Text style={styles.sectionLabel}>Log</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { paddingTop: 64, paddingHorizontal: 20, paddingBottom: 40 },
  centered: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  statusText: { marginTop: 12, fontSize: 16, color: '#555' },
  errorText: { fontSize: 16, color: '#b00020', textAlign: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  subtitle: { fontSize: 14, color: '#777', marginTop: 2, marginBottom: 20 },
  sectionLabel: { fontSize: 14, fontWeight: '600', color: '#777', marginTop: 24, marginBottom: 10 },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingVertical: 7, paddingHorizontal: 13 },
  pillSelected: { backgroundColor: '#0f766e', borderColor: '#0f766e' },
  pillText: { fontSize: 13, color: '#333', fontWeight: '500' },
  pillTextSelected: { color: '#fff' },

  statsCard: {
    marginTop: 20,
    backgroundColor: '#f0fdfa',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ccfbf1',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  statsSentence: { fontSize: 14, color: '#134e4a', lineHeight: 20 },
  statsDivider: { height: 1, backgroundColor: '#ccfbf1', marginVertical: 10 },

  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  calendarCell: {
    width: 46,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#eee',
  },
  calendarCellDay: { fontSize: 12, fontWeight: '600', color: '#555', marginBottom: 6 },
  calendarCellDots: { flexDirection: 'row', gap: 2, flexWrap: 'wrap', justifyContent: 'center', width: 30 },
  dot: { width: 6, height: 6, borderRadius: 3, margin: 1 },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  rowLeft: { flex: 1, paddingRight: 12 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowDot: { width: 8, height: 8, borderRadius: 4 },
  rowPrayer: { fontSize: 15, fontWeight: '600', color: '#333' },
  rowDate: { fontSize: 13, color: '#999' },
  rowMeta: { fontSize: 12, color: '#888', marginTop: 3 },
  rowStatus: { fontSize: 13, fontWeight: '700' },
  rowSeparator: { height: 1, backgroundColor: '#eee' },

  emptyText: { color: '#777', fontSize: 14, marginTop: 12, textAlign: 'center' },
});
